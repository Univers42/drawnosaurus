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
import {
  pending,
  SCENE,
  staged,
  type Change,
  type Head,
  type Item,
  type Read,
  type StoreDb,
} from "./storeDb.ts";

/**
 * The online copy's HTTP surface. It stores sealed bytes and never opens them, and no request
 * carries more than one part, PART_BYTES, either way (Ruling 27):
 *
 *   GET  /store/v1/drawings/:id[/parts/:n]                the scene's part n (0), ETag "<rev>"
 *   PUT  /store/v1/drawings/:id                           a scene of one part, ETag "<rev>"
 *   PUT  /store/v1/drawings/:id/staged/:sid/parts/:n      part n of a larger scene, staged
 *   POST /store/v1/drawings/:id/staged/:sid               the staged scene made current, ETag
 *   GET  /store/v1/drawings/:id/pictures/:pid[/parts/:n]  a complete picture's part n (0)
 *   PUT  /store/v1/drawings/:id/pictures/:pid             a picture of one part
 *   PUT  /store/v1/drawings/:id/pictures/:pid/uploads/:uid/parts/:n
 *                                                         part n of a larger picture
 *
 * A part read answers `x-parts: <count>`: a reader takes part 0, then the others, and starts
 * again when a scene part's ETag is not part 0's. A write sends `authorization: Bearer <write
 * token>`; a scene, a staged part and a commit send `if-match: <rev>`, 0 to create; a staged
 * or uploaded part sends `x-parts: <count>`, 2 to MAX_PARTS. Numbers are plain decimals: no
 * sign, no leading zero, no exponent.
 *
 * An upload — a staged scene, or a picture of more than one part — sends its parts in order,
 * each but the last a whole PART_BYTES, under an id the browser picks (`:sid`, `:uid`); a
 * part sent again with the same bytes is a 204, with others a 409. A staged scene is for the
 * rev after the one its parts and its commit name. A picture upload's last part makes it the
 * picture, readable from then on and write-once: another upload of it is a 409 at its next
 * part. So a picture sealed again — with a fresh IV, so other bytes — goes up as a new
 * upload, and two browsers sending one picture cannot mix their parts.
 *
 * The cap, MAX_DRAWING_BYTES, counts the pictures, those still being sent included, beside
 * the scene — and beside a staged scene instead of the scene it will replace. Making a scene
 * current — a commit or a one-part write — deletes every staged scene of the drawing, since
 * each was staged on the rev just passed. Staged scenes idle for STAGED_IDLE_MS, and pictures
 * still being sent idle as long, are deleted by the drawing's next write. A drawing not
 * written for EXPIRY_MS reads as a 404 at once, and writes sweep it away.
 *
 * Errors are the API's envelope, `{ error: { code, message } }`:
 *
 * - 400 `bad_id`, `bad_part` (a part number), `bad_if_match`, `empty_body`, `bad_parts` (an
 *   x-parts out of range, or on a plain PUT; a part past it; a part but the last not whole);
 * - 401 no token; 403 a token whose hash is not the one the drawing's first write stored,
 *   answered before the body is read;
 * - 404 nothing stored there, a picture not all in yet, or a drawing a year unwritten;
 * - 405 a method the route has not;
 * - 409 `conflict`, a stale if-match, with the current rev as the ETag; `part_exists`, other
 *   bytes or another count where a part is stored, or a complete picture sent again;
 *   `part_out_of_order`; `staged_incomplete`, a commit whose upload is missing parts or was
 *   deleted;
 * - 413 `part_too_large`, a body over PART_BYTES; `drawing_too_large`; `too_many_pictures`;
 * - 428 a scene write, a staged part or a commit without if-match;
 * - 503 the database refused (a free quota spent), or other writes kept landing first.
 */

const ROUTE =
  /^\/store\/v1\/drawings\/([^/]+)(?:\/(pictures|staged)\/([^/]+)(?:\/uploads\/([^/]+))?)?(?:\/parts\/([^/]+))?$/;

// RFC 6750's b64token, 32 characters at least: a write token is derived from the drawing's
// secret, and a short one would be guessable.
const BEARER = /^Bearer ([\w.~+/-]{32,512}=*)$/;

/** A rev, bare or quoted as an ETag. */
const REV = /^(?:(0|[1-9]\d{0,14})|"(0|[1-9]\d{0,14})")$/;

/** A part number or a part count. */
const NUMBER = /^(?:0|[1-9]\d{0,5})$/;

/**
 * How often a write is decided again after another landed between its read and its own
 * write. Two, so a request makes at most two rounds of three reads and a batch of seven: 20
 * of the 50 queries D1 allows a free-plan invocation ("Queries per Worker invocation",
 * https://developers.cloudflare.com/d1/platform/limits/).
 */
const ATTEMPTS = 2;

/** What a write is aimed at, once its route is read. */
type Target =
  | { kind: "scene" }
  | { kind: "staged"; sid: string; n: number }
  | { kind: "commit"; sid: string }
  | { kind: "picture"; pid: string }
  | { kind: "upload"; pid: string; uid: string; n: number };

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

const tooManyPictures = (): Response =>
  failure(413, "too_many_pictures", `a drawing's online copy holds ${MAX_PICTURES} pictures`);

const stagedIncomplete = (): Response =>
  failure(409, "staged_incomplete", "parts of this upload are missing; stage it again");

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

const expired = (found: Read, now: number): boolean => found.writtenAt < now - EXPIRY_MS;

async function getScene(db: StoreDb, id: string, n: number, now: number): Promise<Response> {
  const found = await db.read(id, SCENE, n);
  if (found === null || expired(found, now) || found.rev === 0 || found.part === null) {
    return failure(404, "not_found", "no copy of this drawing, or no such part, is stored");
  }
  return bytesResponse(found.part.bytes, {
    etag: etag(found.rev),
    "x-parts": String(found.part.total),
  });
}

async function getPicture(
  db: StoreDb,
  id: string,
  pid: string,
  n: number,
  now: number,
): Promise<Response> {
  const found = await db.read(id, pid, n);
  if (
    found === null ||
    expired(found, now) ||
    found.item === null ||
    found.item.parts !== found.item.total ||
    found.part === null
  ) {
    return failure(404, "not_found", "no such picture is stored, or not all of it yet");
  }
  return bytesResponse(found.part.bytes, { "x-parts": String(found.part.total) });
}

type Totals = Omit<Head, "proof" | "nonce">;

/** What a write leaves the head at, and does to the parts. */
interface Plan {
  next: Totals;
  changes: Change[];
}

const NOTHING: Totals = {
  rev: 0,
  bytes: 0,
  sceneBytes: 0,
  pictures: 0,
  stagedBytes: 0,
  stagedAt: 0,
  pendingBytes: 0,
  pendingAt: 0,
};

const DROP_STAGED: Change = { kind: "dropStaged" };
const DROP_PENDING: Change = { kind: "dropPending" };

/**
 * The head as this write finds it once the drawing's idle uploads are gone: staged scenes
 * with no part landed for STAGED_IDLE_MS, and pictures still being sent likewise, each kind
 * on its own clock. Every write deletes them, so they stop counting against the cap.
 */
function settle(head: Head | null, now: number): { was: Totals; idle: Change[] } {
  const was = head ?? NOTHING;
  const before = now - STAGED_IDLE_MS;
  const stagedIdle = was.stagedBytes > 0 && was.stagedAt < before;
  const pendingIdle = was.pendingBytes > 0 && was.pendingAt < before;
  const dropped = (stagedIdle ? was.stagedBytes : 0) + (pendingIdle ? was.pendingBytes : 0);
  return {
    was: {
      ...was,
      bytes: was.bytes - dropped,
      stagedBytes: stagedIdle ? 0 : was.stagedBytes,
      pendingBytes: pendingIdle ? 0 : was.pendingBytes,
    },
    idle: [...(stagedIdle ? [DROP_STAGED] : []), ...(pendingIdle ? [DROP_PENDING] : [])],
  };
}

/** The pictures the cap counts: the complete ones and those still being sent. */
const picturesOf = (was: Totals): number => was.bytes - was.sceneBytes - was.stagedBytes;

/**
 * Whether a picture's part fits: the pictures beside the larger of the scene and the staged
 * scenes, so that whichever is current after a commit still fits with them.
 */
const pictureFits = (was: Totals, size: number): boolean =>
  picturesOf(was) + size + Math.max(was.sceneBytes, was.stagedBytes) <= MAX_DRAWING_BYTES;

/**
 * A scene made current. It replaces the scene before it, and every staged scene goes: each
 * was staged on the rev this write moves past, so its commit could only be a 409.
 */
function publish(was: Totals, sceneBytes: number, changes: Change[]): Plan | Response {
  const bytes = picturesOf(was) + sceneBytes;
  if (bytes > MAX_DRAWING_BYTES) return tooLarge();
  return {
    next: { ...was, rev: was.rev + 1, bytes, sceneBytes, stagedBytes: 0, stagedAt: 0 },
    changes: was.stagedBytes > 0 ? [...changes, DROP_STAGED] : changes,
  };
}

/** A part sent again: the same bytes are a 204 that writes nothing, other bytes a 409. */
async function again(
  db: StoreDb,
  id: string,
  item: string,
  n: number,
  body: Uint8Array,
): Promise<Response> {
  const stored = await db.part(id, item, n);
  return stored !== null && sameBytes(stored.bytes, body)
    ? new Response(null, { status: 204 })
    : partExists();
}

/** The answer for a part an upload already has or cannot take yet; null when it is next. */
async function place(
  db: StoreDb,
  id: string,
  item: string,
  upload: Item | null,
  n: number,
  total: number,
  body: Uint8Array,
): Promise<Response | null> {
  if (upload !== null) {
    if (upload.total !== total) return partExists();
    if (n < upload.parts) return again(db, id, item, n, body);
  }
  const next = upload?.parts ?? 0;
  return n > next
    ? failure(409, "part_out_of_order", `an upload's parts go in order: part ${next} is next`)
    : null;
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
  const { was, idle } = settle(head, now);
  const onRev = target.kind === "scene" || target.kind === "staged" || target.kind === "commit";
  if (onRev && was.rev !== expected) return conflict(was.rev);
  const plan = await decideTarget(db, id, was, idle, target, body, total, now);
  return plan instanceof Response ? plan : { next: plan.next, changes: [...idle, ...plan.changes] };
}

async function decideTarget(
  db: StoreDb,
  id: string,
  was: Totals,
  idle: Change[],
  target: Target,
  body: Uint8Array<ArrayBuffer>,
  total: number,
  now: number,
): Promise<Plan | Response> {
  const size = body.byteLength;
  switch (target.kind) {
    case "scene":
      return publish(was, size, [
        { kind: "put", item: SCENE, n: 0, total: 1, bytes: body },
        { kind: "trim", item: SCENE, from: 1 },
      ]);
    case "commit": {
      // Idle, its parts are among those this very write would delete.
      if (idle.includes(DROP_STAGED)) return stagedIncomplete();
      const upload = await db.item(id, staged(target.sid));
      if (upload === null || upload.parts !== upload.total) return stagedIncomplete();
      return publish(was, upload.bytes, [
        { kind: "trim", item: SCENE, from: 0 },
        { kind: "rename", from: staged(target.sid), to: SCENE },
      ]);
    }
    case "staged": {
      const item = staged(target.sid);
      const upload = idle.includes(DROP_STAGED) ? null : await db.item(id, item);
      const placed = await place(db, id, item, upload, target.n, total, body);
      if (placed !== null) return placed;
      // Beside the pictures, and not beside the scene its commit replaces.
      if (picturesOf(was) + was.stagedBytes + size > MAX_DRAWING_BYTES) return tooLarge();
      return {
        next: {
          ...was,
          bytes: was.bytes + size,
          stagedBytes: was.stagedBytes + size,
          stagedAt: now,
        },
        changes: [{ kind: "put", item, n: target.n, total, bytes: body }],
      };
    }
    case "picture": {
      const stored = await db.item(id, target.pid);
      if (stored !== null) {
        return stored.total === 1 ? again(db, id, target.pid, 0, body) : partExists();
      }
      if (was.pictures + 1 > MAX_PICTURES) return tooManyPictures();
      if (!pictureFits(was, size)) return tooLarge();
      return {
        next: { ...was, bytes: was.bytes + size, pictures: was.pictures + 1 },
        changes: [{ kind: "put", item: target.pid, n: 0, total: 1, bytes: body }],
      };
    }
    case "upload": {
      // Complete, a picture is write-once: its own parts again are 204s, anything else a 409.
      const complete = await db.item(id, target.pid);
      if (complete !== null) {
        return complete.total === total && target.n < complete.parts
          ? again(db, id, target.pid, target.n, body)
          : partExists();
      }
      const item = pending(target.pid, target.uid);
      const upload = idle.includes(DROP_PENDING) ? null : await db.item(id, item);
      const placed = await place(db, id, item, upload, target.n, total, body);
      if (placed !== null) return placed;
      if (was.pictures + 1 > MAX_PICTURES) return tooManyPictures();
      if (!pictureFits(was, size)) return tooLarge();
      const put: Change = { kind: "put", item, n: target.n, total, bytes: body };
      if (target.n < total - 1) {
        return {
          next: {
            ...was,
            bytes: was.bytes + size,
            pendingBytes: was.pendingBytes + size,
            pendingAt: now,
          },
          changes: [put],
        };
      }
      // The last part: the upload becomes the picture, readable under its id from now on.
      return {
        next: {
          ...was,
          bytes: was.bytes + size,
          pictures: was.pictures + 1,
          pendingBytes: was.pendingBytes - (upload?.bytes ?? 0),
          pendingAt: now,
        },
        changes: [put, { kind: "rename", from: item, to: target.pid }],
      };
    }
  }
}

const forbidden = (head: Head | null, proof: string): boolean =>
  head !== null && !sameProof(head.proof, proof);

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
  if (target.kind === "scene" || target.kind === "staged" || target.kind === "commit") {
    const header = request.headers.get("if-match");
    if (header === null) {
      return failure(428, "precondition_required", "this write needs if-match: <rev>, 0 to create");
    }
    const match = REV.exec(header.trim());
    if (match === null) {
      return failure(400, "bad_if_match", "if-match is a rev in plain decimal, 0 to create");
    }
    expected = Number(match[1] ?? match[2]);
  }
  let total = 1;
  const declared = request.headers.get("x-parts");
  if (target.kind === "staged" || target.kind === "upload") {
    total = declared !== null && NUMBER.test(declared) ? Number(declared) : 0;
    if (total < 2 || total > MAX_PARTS) {
      return failure(
        400,
        "bad_parts",
        `x-parts must be from 2 to ${MAX_PARTS}: one part is a plain PUT`,
      );
    }
    if (target.n >= total) {
      return failure(400, "bad_parts", `part ${target.n} is past the ${total} parts declared`);
    }
  } else if (declared !== null && declared !== "1") {
    return failure(400, "bad_parts", "a plain PUT holds one part; send more as an upload");
  }

  // The proof before the body: a stranger's request costs a head read, never its body.
  const proof = await sha256Hex(token);
  let head = await db.head(id);
  if (forbidden(head, proof)) {
    return failure(403, "forbidden", "this token cannot write this drawing");
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
  if (
    (target.kind === "staged" || target.kind === "upload") &&
    target.n < total - 1 &&
    body.byteLength !== PART_BYTES
  ) {
    return failure(400, "bad_parts", `every part but the last is ${PART_BYTES} bytes`);
  }

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      head = await db.head(id);
      if (forbidden(head, proof)) {
        return failure(403, "forbidden", "this token cannot write this drawing");
      }
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
      const rev = target.kind === "scene" || target.kind === "commit";
      return new Response(null, { status: 204, headers: rev ? { etag: etag(next.rev) } : {} });
    }
  }
  return failure(503, "busy", "other writes to this drawing kept landing first; try again");
}

type Answer = () => Promise<Response>;

interface Route {
  kind: string | undefined;
  sub: string | undefined;
  uid: string | undefined;
  n: number | undefined;
}

/**
 * The methods a route answers, each with its answer; any other is a 405, and null is no such
 * route. A Map, not an object: a method is any token, and `constructor` is one.
 */
function routeMethods(
  request: Request,
  db: StoreDb,
  now: number,
  id: string,
  { kind, sub, uid, n }: Route,
): Map<string, Answer> | null {
  const writing =
    (target: Target): Answer =>
    () =>
      write(request, db, now, id, target);
  if (kind === "pictures" && sub !== undefined) {
    if (uid !== undefined) {
      return n === undefined
        ? null
        : new Map([["PUT", writing({ kind: "upload", pid: sub, uid, n })]]);
    }
    return n === undefined
      ? new Map([
          ["GET", () => getPicture(db, id, sub, 0, now)],
          ["PUT", writing({ kind: "picture", pid: sub })],
        ])
      : new Map([["GET", () => getPicture(db, id, sub, n, now)]]);
  }
  if (kind === "staged" && sub !== undefined && uid === undefined) {
    return n === undefined
      ? new Map([["POST", writing({ kind: "commit", sid: sub })]])
      : new Map([["PUT", writing({ kind: "staged", sid: sub, n })]]);
  }
  if (kind !== undefined) return null;
  return n === undefined
    ? new Map([
        ["GET", () => getScene(db, id, 0, now)],
        ["PUT", writing({ kind: "scene" })],
      ])
    : new Map([["GET", () => getScene(db, id, n, now)]]);
}

/** Answers one request to `/store/*`. `now` is the clock, in milliseconds. */
export async function handle(request: Request, db: StoreDb, now = Date.now()): Promise<Response> {
  const route = ROUTE.exec(new URL(request.url).pathname);
  const id = route?.[1];
  if (route === null || id === undefined) return failure(404, "not_found", "no such route");
  const [, , kind, sub, uid, part] = route;
  for (const value of [id, sub, uid]) {
    const checked = value === undefined ? null : slugSchema.safeParse(value);
    if (checked && !checked.success) {
      return failure(400, "bad_id", `an id ${checked.error.issues[0]?.message ?? "is invalid"}`);
    }
  }
  if (part !== undefined && !NUMBER.test(part)) {
    return failure(400, "bad_part", "a part number is a plain decimal: 0, 1, 2…");
  }
  const n = part === undefined ? undefined : Number(part);
  const methods = routeMethods(request, db, now, id, { kind, sub, uid, n });
  if (methods === null) return failure(404, "not_found", "no such route");
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
