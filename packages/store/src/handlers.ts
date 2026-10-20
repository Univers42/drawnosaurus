import { EXPIRY_MS, MAX_DRAWING_BYTES, SWEEP_LIMIT } from "./limits.ts";
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
 * `if-match: <rev>`, 0 to create. Errors are the API's envelope, `{ error: { code, message } }`.
 */

const ROUTE = /^\/store\/v1\/drawings\/([^/]+)(?:\/pictures\/([^/]+))?$/;

// RFC 6750's b64token.
const BEARER = /^Bearer ([\w.~+/-]+=*)$/;

const REV = /^(?:(\d{1,15})|"(\d{1,15})")$/;

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
  if (pid === undefined) {
    const header = request.headers.get("if-match");
    if (header === null) {
      return failure(428, "precondition_required", "a scene write needs if-match: <rev>");
    }
    if (!REV.test(header.trim())) {
      return failure(400, "bad_if_match", "if-match must be a rev, 0 to create");
    }
  }
  const body = await readBody(request, MAX_DRAWING_BYTES);
  if (body === null) return tooLarge();
  if (body.byteLength === 0) return failure(400, "empty_body", "there is nothing to store");
  const proof = await sha256Hex(token);

  const head = await db.head(id);
  const next: Head = {
    rev: pid === undefined ? (head?.rev ?? 0) + 1 : (head?.rev ?? 0),
    proof: head?.proof ?? proof,
    nonce: crypto.randomUUID(),
    bytes: body.byteLength,
    sceneBytes: pid === undefined ? body.byteLength : (head?.sceneBytes ?? 0),
    pictures: (head?.pictures ?? 0) + (pid === undefined ? 0 : 1),
  };
  await db.write({
    id,
    seen: head?.nonce ?? null,
    head: next,
    writtenAt: now,
    item: pid ?? SCENE,
    parts: [body],
    sweep: { before: now - EXPIRY_MS, limit: SWEEP_LIMIT },
  });
  return new Response(null, {
    status: 204,
    headers: pid === undefined ? { etag: etag(next.rev) } : {},
  });
}

/** Answers one request to `/store/*`. `now` is the clock, in milliseconds. */
export async function handle(request: Request, db: StoreDb, now = Date.now()): Promise<Response> {
  const route = ROUTE.exec(new URL(request.url).pathname);
  const id = route?.[1];
  if (id === undefined) return failure(404, "not_found", "no such route");
  const pid = route?.[2];
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
