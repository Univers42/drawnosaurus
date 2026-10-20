import { slugSchema } from "@drawnosaurus/contract";
import { Buffer } from "node:buffer";
import {
  EXPIRY_MS,
  MAX_DRAWING_BYTES,
  MAX_PARTS,
  MAX_PICTURES,
  PART_BYTES,
  STAGED_IDLE_MS,
  SWEEP_LIMIT,
} from "./limits.ts";
import { SCENE, staged, type Change, type Head, type StoreDb } from "./storeDb.ts";

/**
 * The online copy's HTTP surface. It stores sealed bytes and never opens them, and no request
 * carries more than one part, PART_BYTES, either way (Ruling 27):
 *
 *   GET  /store/v1/drawings/:id[/parts/:n]                the scene's part n (0), ETag "<rev>"
 *   PUT  /store/v1/drawings/:id                           a scene of one part, ETag "<rev>"
 *   PUT  /store/v1/drawings/:id/staged/:sid/parts/:n      part n of a larger scene, staged
 *   POST /store/v1/drawings/:id/staged/:sid               the staged scene made current, ETag
 *   GET  /store/v1/drawings/:id/pictures/:pid[/parts/:n]  a picture's part n (0)
 *   PUT  /store/v1/drawings/:id/pictures/:pid[/parts/:n]  a picture's part n (0)
 *
 * A part read answers `x-parts: <count>`: a reader takes part 0, then the others, and starts
 * again when a scene part's ETag is not part 0's. A write sends `authorization: Bearer <write
 * token>`; a scene, a staged part and a commit send `if-match: <rev>`, 0 to create; a part
 * sends `x-parts: <count>`, which a picture of one part may leave out. An upload's parts go in
 * order, each but the last a whole PART_BYTES, and are write-once: the same bytes again are a
 * 204. A picture is readable once all its parts are in. `:sid` is an upload id the browser
 * picks; its staged scene is the one after the rev its parts and its commit name. Making a
 * scene current — a commit or a one-part write — deletes every staged upload of the drawing,
 * since each was staged on a rev that has just gone; staging idle for STAGED_IDLE_MS is
 * deleted by the drawing's next write.
 *
 * Errors are the API's envelope, `{ error: { code, message } }`:
 *
 * - 400 `bad_id`, `bad_if_match`, `empty_body`, `bad_parts` (an x-parts past 1–MAX_PARTS, or
 *   under 2 for a staged scene; a part past it; a part but the last not whole);
 * - 401 no token; 403 a token whose hash is not the one the drawing's first write stored;
 * - 404 nothing stored there, or a picture not all in yet; 405 a method the route has not;
 * - 409 `conflict`, a stale if-match, with the current rev as the ETag; `part_exists`, other
 *   bytes or another count where a part is stored; `part_out_of_order`; `staged_incomplete`,
 *   a commit whose upload is missing parts or was deleted;
 * - 413 `part_too_large`, a body over PART_BYTES; `drawing_too_large`, past
 *   MAX_DRAWING_BYTES with the pictures and the staged parts; `too_many_pictures`;
 * - 428 a scene write, a staged part or a commit without if-match;
 * - 503 the database refused (a free quota spent), or other writes kept landing first.
 */

const ROUTE =
  /^\/store\/v1\/drawings\/([^/]+)(?:\/(pictures|staged)\/([^/]+))?(?:\/parts\/(\d{1,6}))?$/;

// RFC 6750's b64token, 32 characters at least: a write token is derived from the drawing's
// secret, and a short one would be guessable.
const BEARER = /^Bearer ([\w.~+/-]{32,512}=*)$/;

const REV = /^(?:(\d{1,15})|"(\d{1,15})")$/;

const PARTS = /^\d{1,6}$/;

/**
 * How often a write is decided again after another landed between its read and its own
 * write. Two, so a request makes at most two rounds of three reads and a batch of six: 18 of
 * the 50 queries D1 allows a free-plan invocation ("Queries per Worker invocation",
 * https://developers.cloudflare.com/d1/platform/limits/).
 */
const ATTEMPTS = 2;

/** What a write is aimed at, once its route is read. */
type Target =
  | { kind: "scene" }
  | { kind: "part"; item: string; n: number; staged: boolean }
  | { kind: "commit"; sid: string };

const etag = (rev: number): string => `"${rev}"`;

const failure = (
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response => Response.json({ error: { code, message } }, { status, headers });

const conflict = (rev: number): Response =>
  failure(409, "conflict", `the stored copy is at rev ${rev}`, { etag: etag(rev) });

const tooLarge = (): Response =>
  failure(413, "drawing_too_large", "the drawing would exceed what its online copy can hold");

const partExists = (): Response =>
  failure(409, "part_exists", "another part is stored at this place; parts are write-once");

function join(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** Node's native compare, not a loop in JavaScript over a part's MiB. */
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);

/**
 * Whether two proofs match, in time that does not depend on where they differ. Both are hex
 * SHA-256, 64 characters, so the length gives nothing away.
 */
function sameProof(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

const bytesResponse = (bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string>) =>
  new Response(bytes, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

/** The body, or null as soon as it passes `limit`: never read further, whatever it claims. */
async function readBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  for (let read = await reader?.read(); read && !read.done; read = await reader?.read()) {
    size += read.value.byteLength;
    if (size > limit) {
      await reader?.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  return join(chunks);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getScene(db: StoreDb, id: string, n: number): Promise<Response> {
  const scene = await db.scene(id, n);
  if (scene === null || scene.rev === 0 || scene.part === null) {
    return failure(404, "not_found", "no copy of this drawing, or no such part, is stored");
  }
  return bytesResponse(scene.part.bytes, {
    etag: etag(scene.rev),
    "x-parts": String(scene.part.total),
  });
}

async function getPicture(db: StoreDb, id: string, pid: string, n: number): Promise<Response> {
  const upload = await db.item(id, pid);
  const part = upload !== null && upload.parts === upload.total ? await db.part(id, pid, n) : null;
  return part === null
    ? failure(404, "not_found", "no such picture is stored, or not all of it yet")
    : bytesResponse(part.bytes, { "x-parts": String(part.total) });
}

/** What a write leaves the head at, and does to the parts. */
interface Plan {
  next: Omit<Head, "proof" | "nonce">;
  changes: Change[];
}

const NOTHING: Omit<Head, "proof" | "nonce"> = {
  rev: 0,
  bytes: 0,
  sceneBytes: 0,
  pictures: 0,
  stagedBytes: 0,
  stagedAt: 0,
};

const DROP_STAGED: Change = { kind: "dropStaged" };

/**
 * A scene made current. It replaces the scene before it, and every staged upload goes: each
 * was staged on the rev this write moves past, so its commit could only be a 409.
 */
function publish(was: Plan["next"], sceneBytes: number, changes: Change[]): Plan | Response {
  const bytes = was.bytes - was.sceneBytes - was.stagedBytes + sceneBytes;
  if (bytes > MAX_DRAWING_BYTES) return tooLarge();
  return {
    next: { ...was, rev: was.rev + 1, bytes, sceneBytes, stagedBytes: 0, stagedAt: 0 },
    changes: was.stagedBytes > 0 ? [...changes, DROP_STAGED] : changes,
  };
}

/** One part of a picture or of a staged scene, which counts against the cap as it lands. */
async function decidePart(
  db: StoreDb,
  id: string,
  was: Plan["next"],
  target: Extract<Target, { kind: "part" }>,
  total: number,
  body: Uint8Array<ArrayBuffer>,
  now: number,
): Promise<Plan | Response> {
  // Staging idle this long is abandoned: this write deletes it, the upload's own parts too.
  const abandoned = was.stagedBytes > 0 && was.stagedAt < now - STAGED_IDLE_MS;
  const upload = abandoned && target.staged ? null : await db.item(id, target.item);
  if (upload !== null) {
    if (upload.total !== total) return partExists();
    if (target.n < upload.parts) {
      const stored = await db.part(id, target.item, target.n);
      return stored !== null && sameBytes(stored.bytes, body)
        ? new Response(null, { status: 204 })
        : partExists();
    }
  }
  const next = upload?.parts ?? 0;
  if (target.n > next) {
    return failure(409, "part_out_of_order", `an upload's parts go in order: part ${next} is next`);
  }
  const pictures = was.pictures + (target.staged || upload !== null ? 0 : 1);
  if (pictures > MAX_PICTURES) {
    return failure(
      413,
      "too_many_pictures",
      `a drawing's online copy holds ${MAX_PICTURES} pictures`,
    );
  }
  const dropped = abandoned ? was.stagedBytes : 0;
  const bytes = was.bytes - dropped + body.byteLength;
  if (bytes > MAX_DRAWING_BYTES) return tooLarge();
  const put: Change = { kind: "put", item: target.item, n: target.n, total, bytes: body };
  return {
    next: {
      ...was,
      bytes,
      pictures,
      stagedBytes: was.stagedBytes - dropped + (target.staged ? body.byteLength : 0),
      stagedAt: target.staged ? now : abandoned ? 0 : was.stagedAt,
    },
    changes: abandoned ? [DROP_STAGED, put] : [put],
  };
}

async function decide(
  db: StoreDb,
  id: string,
  head: Head | null,
  target: Target,
  expected: number,
  body: Uint8Array<ArrayBuffer>,
  total: number,
  now: number,
): Promise<Plan | Response> {
  const was = head ?? NOTHING;
  // A picture is written on no rev: it is write-once, whatever the scene is at.
  if ((target.kind !== "part" || target.staged) && was.rev !== expected) return conflict(was.rev);
  switch (target.kind) {
    case "scene":
      return publish(was, body.byteLength, [
        { kind: "put", item: SCENE, n: 0, total: 1, bytes: body },
        { kind: "trim", item: SCENE, from: 1 },
      ]);
    case "commit": {
      const upload = await db.item(id, staged(target.sid));
      if (upload === null || upload.parts !== upload.total) {
        return failure(
          409,
          "staged_incomplete",
          "parts of this upload are missing; stage it again",
        );
      }
      return publish(was, upload.bytes, [
        { kind: "trim", item: SCENE, from: 0 },
        { kind: "rename", from: staged(target.sid), to: SCENE },
      ]);
    }
    case "part":
      return decidePart(db, id, was, target, total, body, now);
  }
}

/** Why a part's place and size are refused, or null when they are not. */
function badPart(n: number, total: number, size: number, staged: boolean): string | null {
  const least = staged ? 2 : 1;
  if (!(total >= least && total <= MAX_PARTS)) {
    return staged
      ? `x-parts must be from 2 to ${MAX_PARTS}: a scene of one part is a plain PUT`
      : `x-parts must be from 1 to ${MAX_PARTS}`;
  }
  if (n >= total) return `part ${n} is past the ${total} parts declared`;
  if (n < total - 1 && size !== PART_BYTES) return `every part but the last is ${PART_BYTES} bytes`;
  return null;
}

async function write(
  request: Request,
  db: StoreDb,
  now: number,
  id: string,
  target: Target,
): Promise<Response> {
  const token = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token === undefined) {
    return failure(401, "unauthorized", "a write needs authorization: Bearer <write token>", {
      "www-authenticate": "Bearer",
    });
  }
  let expected = 0;
  if (target.kind !== "part" || target.staged) {
    const header = request.headers.get("if-match");
    if (header === null) {
      return failure(428, "precondition_required", "this write needs if-match: <rev>, 0 to create");
    }
    const match = REV.exec(header.trim());
    if (match === null) return failure(400, "bad_if_match", "if-match must be a rev, 0 to create");
    expected = Number(match[1] ?? match[2]);
  }
  // A commit carries no part: what it publishes is staged already.
  let body = new Uint8Array(0);
  if (target.kind !== "commit") {
    const read = await readBody(request, PART_BYTES);
    if (read === null) {
      return failure(413, "part_too_large", `a request carries one part, ${PART_BYTES} bytes`);
    }
    if (read.byteLength === 0) return failure(400, "empty_body", "there is nothing to store");
    body = read;
  }
  let total = 1;
  if (target.kind === "part") {
    const declared = request.headers.get("x-parts") ?? (target.staged ? "" : "1");
    total = PARTS.test(declared) ? Number(declared) : 0;
    const problem = badPart(target.n, total, body.byteLength, target.staged);
    if (problem !== null) return failure(400, "bad_parts", problem);
  }
  const proof = await sha256Hex(token);

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const head = await db.head(id);
    // The first write's token holds the drawing; checked before anything is said about it.
    if (head !== null && !sameProof(head.proof, proof)) {
      return failure(403, "forbidden", "this token cannot write this drawing");
    }
    const plan = await decide(db, id, head, target, expected, body, total, now);
    if (plan instanceof Response) return plan;
    const next: Head = { ...plan.next, proof: head?.proof ?? proof, nonce: crypto.randomUUID() };
    const landed = await db.write({
      id,
      seen: head?.nonce ?? null,
      head: next,
      writtenAt: now,
      changes: plan.changes,
      sweep: { before: now - EXPIRY_MS, limit: SWEEP_LIMIT },
    });
    if (landed) {
      return new Response(null, {
        status: 204,
        headers: target.kind === "part" ? {} : { etag: etag(next.rev) },
      });
    }
  }
  return failure(503, "busy", "other writes to this drawing kept landing first; try again");
}

type Answer = () => Promise<Response>;

/**
 * The methods a route answers, each with its answer; any other is a 405. A Map, not an
 * object: a method is any token, and `constructor` is one.
 */
function routeMethods(
  request: Request,
  db: StoreDb,
  now: number,
  id: string,
  kind: string | undefined,
  sub: string | undefined,
  n: number | undefined,
): Map<string, Answer> {
  const writing =
    (target: Target): Answer =>
    () =>
      write(request, db, now, id, target);
  if (kind === "pictures" && sub !== undefined) {
    return new Map([
      ["GET", () => getPicture(db, id, sub, n ?? 0)],
      ["PUT", writing({ kind: "part", item: sub, n: n ?? 0, staged: false })],
    ]);
  }
  if (kind === "staged" && sub !== undefined) {
    return n === undefined
      ? new Map([["POST", writing({ kind: "commit", sid: sub })]])
      : new Map([["PUT", writing({ kind: "part", item: staged(sub), n, staged: true })]]);
  }
  return n === undefined
    ? new Map([
        ["GET", () => getScene(db, id, 0)],
        ["PUT", writing({ kind: "scene" })],
      ])
    : new Map([["GET", () => getScene(db, id, n)]]);
}

/** Answers one request to `/store/*`. `now` is the clock, in milliseconds. */
export async function handle(request: Request, db: StoreDb, now = Date.now()): Promise<Response> {
  const route = ROUTE.exec(new URL(request.url).pathname);
  const id = route?.[1];
  if (route === null || id === undefined) return failure(404, "not_found", "no such route");
  const [, , kind, sub, part] = route;
  for (const value of sub === undefined ? [id] : [id, sub]) {
    const checked = slugSchema.safeParse(value);
    if (!checked.success) {
      return failure(400, "bad_id", `an id ${checked.error.issues[0]?.message ?? "is invalid"}`);
    }
  }
  const n = part === undefined ? undefined : Number(part);
  const methods = routeMethods(request, db, now, id, kind, sub, n);
  const answer = methods.get(request.method);
  if (answer === undefined) {
    const allow = [...methods.keys()].join(", ");
    return failure(405, "method_not_allowed", `this route answers ${allow}`, { allow });
  }
  try {
    return await answer();
  } catch (error) {
    // D1 refuses every call once a daily quota or the database's size is spent: say so.
    console.error("store: the database call failed", error);
    return failure(503, "store_unavailable", "the online copy cannot be reached; try again later");
  }
}
