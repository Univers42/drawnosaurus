import { slugSchema } from "@drawnosaurus/contract";
import { EXPIRY_MS, MAX_DRAWING_BYTES, MAX_PICTURES, PART_BYTES, SWEEP_LIMIT } from "./limits.ts";
import { SCENE, type Head, type StoreDb } from "./storeDb.ts";

/**
 * The online copy's HTTP surface. It stores sealed bytes and never opens them:
 *
 *   GET /store/v1/drawings/:id                 200 the scene, ETag "<rev>" · 404
 *   PUT /store/v1/drawings/:id                 204, ETag "<rev>"
 *   GET /store/v1/drawings/:id/pictures/:pid   200 the picture · 404
 *   PUT /store/v1/drawings/:id/pictures/:pid   204
 *
 * A write sends `authorization: Bearer <write token>`; a scene write also sends
 * `if-match: <rev>`, 0 to create. Errors are the API's envelope, `{ error: { code, message } }`:
 *
 * - 400 an id or picture id the contract's `slugSchema` refuses, a bad if-match, no body;
 * - 401 no token; 403 a token whose hash is not the one the drawing's first write stored;
 * - 409 on a scene, a stale if-match, with the current rev as the ETag; on a picture, one
 *   already stored under that id with other bytes (the same bytes again are a 204);
 * - 413 a drawing past MAX_DRAWING_BYTES with its pictures, or past MAX_PICTURES;
 * - 428 a scene write without if-match;
 * - 503 the database refused (a free quota spent), or other writes kept landing first.
 */

const ROUTE = /^\/store\/v1\/drawings\/([^/]+)(?:\/pictures\/([^/]+))?$/;

// RFC 6750's b64token, 32 characters at least: a write token is derived from the drawing's
// secret, and a short one would be guessable.
const BEARER = /^Bearer ([\w.~+/-]{32,512}=*)$/;

const REV = /^(?:(\d{1,15})|"(\d{1,15})")$/;

/**
 * How often a write is decided again after another landed between its read and its own
 * write. Two, so a request makes at most two batches: D1 allows a free-plan invocation 50
 * queries ("Queries per Worker invocation", https://developers.cloudflare.com/d1/platform/limits/).
 */
const ATTEMPTS = 2;

const etag = (rev: number): string => `"${rev}"`;

const failure = (
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response => Response.json({ error: { code, message } }, { status, headers });

const tooLarge = (): Response =>
  failure(413, "drawing_too_large", "the drawing would exceed what its online copy can hold");

function join(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function split(bytes: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < bytes.byteLength; at += PART_BYTES) {
    parts.push(bytes.subarray(at, at + PART_BYTES));
  }
  return parts;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

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

const bytesResponse = (bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
  new Response(bytes, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

/** The body, or null as soon as it passes `limit`: never read further, whatever it claims. */
async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
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

async function getScene(db: StoreDb, id: string): Promise<Response> {
  const scene = await db.scene(id);
  if (scene === null || scene.rev === 0) {
    return failure(404, "not_found", "no copy of this drawing is stored");
  }
  return bytesResponse(join(scene.parts), { etag: etag(scene.rev) });
}

async function getPicture(db: StoreDb, id: string, pid: string): Promise<Response> {
  const parts = await db.picture(id, pid);
  return parts === null
    ? failure(404, "not_found", "no such picture is stored")
    : bytesResponse(join(parts));
}

/** What a write leaves the head at, or the answer when it may not land. */
type Decision = Omit<Head, "proof" | "nonce"> | Response;

function decideScene(head: Head | null, expected: number, body: Uint8Array): Decision {
  const rev = head?.rev ?? 0;
  if (rev !== expected) {
    return failure(409, "conflict", `the stored copy is at rev ${rev}`, { etag: etag(rev) });
  }
  // The scene being replaced no longer counts.
  const bytes = (head?.bytes ?? 0) - (head?.sceneBytes ?? 0) + body.byteLength;
  if (bytes > MAX_DRAWING_BYTES) return tooLarge();
  return { rev: rev + 1, bytes, sceneBytes: body.byteLength, pictures: head?.pictures ?? 0 };
}

async function decidePicture(
  db: StoreDb,
  head: Head | null,
  id: string,
  pid: string,
  body: Uint8Array,
): Promise<Decision> {
  const stored = await db.picture(id, pid);
  if (stored !== null) {
    return sameBytes(join(stored), body)
      ? new Response(null, { status: 204 })
      : failure(
          409,
          "picture_exists",
          "another picture is stored under this id; pictures are write-once",
        );
  }
  const pictures = (head?.pictures ?? 0) + 1;
  if (pictures > MAX_PICTURES) {
    return failure(
      413,
      "too_many_pictures",
      `a drawing's online copy holds ${MAX_PICTURES} pictures`,
    );
  }
  const bytes = (head?.bytes ?? 0) + body.byteLength;
  if (bytes > MAX_DRAWING_BYTES) return tooLarge();
  return { rev: head?.rev ?? 0, bytes, sceneBytes: head?.sceneBytes ?? 0, pictures };
}

async function put(
  request: Request,
  db: StoreDb,
  now: number,
  id: string,
  pid: string | undefined,
): Promise<Response> {
  const token = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token === undefined) {
    return failure(401, "unauthorized", "a write needs authorization: Bearer <write token>", {
      "www-authenticate": "Bearer",
    });
  }
  let expected = 0;
  if (pid === undefined) {
    const header = request.headers.get("if-match");
    if (header === null) {
      return failure(428, "precondition_required", "a scene write needs if-match: <rev>");
    }
    const match = REV.exec(header.trim());
    if (match === null) return failure(400, "bad_if_match", "if-match must be a rev, 0 to create");
    expected = Number(match[1] ?? match[2]);
  }
  const body = await readBody(request, MAX_DRAWING_BYTES);
  if (body === null) return tooLarge();
  if (body.byteLength === 0) return failure(400, "empty_body", "there is nothing to store");
  const proof = await sha256Hex(token);

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const head = await db.head(id);
    // The first write's token holds the drawing; checked before anything is said about it.
    if (head !== null && !sameProof(head.proof, proof)) {
      return failure(403, "forbidden", "this token cannot write this drawing");
    }
    const decision =
      pid === undefined
        ? decideScene(head, expected, body)
        : await decidePicture(db, head, id, pid, body);
    if (decision instanceof Response) return decision;
    const next: Head = { ...decision, proof: head?.proof ?? proof, nonce: crypto.randomUUID() };
    const landed = await db.write({
      id,
      seen: head?.nonce ?? null,
      head: next,
      writtenAt: now,
      item: pid ?? SCENE,
      parts: split(body),
      sweep: { before: now - EXPIRY_MS, limit: SWEEP_LIMIT },
    });
    if (landed) {
      return new Response(null, {
        status: 204,
        headers: pid === undefined ? { etag: etag(next.rev) } : {},
      });
    }
  }
  return failure(503, "busy", "other writes to this drawing kept landing first; try again");
}

/** Answers one request to `/store/*`. `now` is the clock, in milliseconds. */
export async function handle(request: Request, db: StoreDb, now = Date.now()): Promise<Response> {
  const route = ROUTE.exec(new URL(request.url).pathname);
  const id = route?.[1];
  if (id === undefined) return failure(404, "not_found", "no such route");
  const pid = route?.[2];
  for (const value of pid === undefined ? [id] : [id, pid]) {
    const checked = slugSchema.safeParse(value);
    if (!checked.success) {
      return failure(400, "bad_id", `an id ${checked.error.issues[0]?.message ?? "is invalid"}`);
    }
  }
  if (request.method !== "GET" && request.method !== "PUT") {
    return failure(405, "method_not_allowed", "only GET and PUT", { allow: "GET, PUT" });
  }
  try {
    if (request.method === "PUT") return await put(request, db, now, id, pid);
    return pid === undefined ? await getScene(db, id) : await getPicture(db, id, pid);
  } catch (error) {
    // D1 refuses every call once a daily quota or the database's size is spent: say so.
    console.error("store: the database call failed", error);
    return failure(503, "store_unavailable", "the online copy cannot be reached; try again later");
  }
}
