import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buffer } from "node:stream/consumers";
import { handle } from "./handlers.ts";
import { memoryStore } from "./memory.ts";
import type { StoreDb } from "./storeDb.ts";

/** The request headers the handlers read. Only these cross into the `Request`. */
const FORWARDED = ["authorization", "if-match", "content-length"] as const;

/**
 * The store for `vite dev` and the browser tests: the real handlers over the in-memory fake,
 * at the same `/store/*` the Pages Function answers in production, so the browser cannot tell
 * them apart. Mount it without a path — `server.middlewares.use(storeDevMiddleware())` —
 * since a mount path is cut from `req.url` and the handlers route on the whole of it.
 * Everything stored is lost when the server stops.
 */
export function storeDevMiddleware(db: StoreDb = memoryStore()) {
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void => {
    if (!req.url?.startsWith("/store/")) {
      next();
      return;
    }
    serve(req, res, db).catch(next);
  };
}

async function serve(req: IncomingMessage, res: ServerResponse, db: StoreDb): Promise<void> {
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = req.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const body = method === "GET" || method === "HEAD" ? null : await buffer(req);
  const request = new Request(new URL(req.url ?? "/", "http://localhost"), {
    method,
    headers,
    body,
  });
  const response = await handle(request, db);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
