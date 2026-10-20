import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storeDevMiddleware } from "../src/devMiddleware.ts";
import { PART_BYTES } from "../src/limits.ts";

const auth = { authorization: `Bearer ${"writetoken".repeat(5)}` };

/** The middleware behind a real Node HTTP server, as `vite dev` mounts it; fetch is the browser. */
describe("storeDevMiddleware", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const middleware = storeDevMiddleware();
    server = createServer((req, res) =>
      middleware(req, res, (error) => {
        res.statusCode = error ? 500 : 404;
        res.setHeader("x-passed-to", "next");
        res.end();
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const store = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${base}/store/v1/drawings/drawing1${path}`, init);

  it("serves the store's routes at /store, over the in-memory fake", async () => {
    const put = await store("", {
      method: "PUT",
      headers: { ...auth, "if-match": "0" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(put.status).toBe(204);
    expect(put.headers.get("etag")).toBe('"1"');
    const got = await store("");
    expect(got.headers.get("etag")).toBe('"1"');
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([1, 2, 3]);

    // A staged scene: x-parts and if-match cross into the handlers, and a POST commits.
    const staged = { ...auth, "if-match": "1", "x-parts": "2" };
    const parts = [new Uint8Array(PART_BYTES).fill(7), new Uint8Array([5, 6])];
    for (const [n, body] of parts.entries()) {
      const response = await store(`/staged/upload01/parts/${n}`, {
        method: "PUT",
        headers: staged,
        body,
      });
      expect(response.status).toBe(204);
    }
    const commit = await store("/staged/upload01", {
      method: "POST",
      headers: { ...auth, "if-match": "1" },
    });
    expect(commit.status).toBe(204);
    expect(commit.headers.get("etag")).toBe('"2"');
    const last = await store("/parts/1");
    expect(last.headers.get("x-parts")).toBe("2");
    expect([...new Uint8Array(await last.arrayBuffer())]).toEqual([5, 6]);
    expect((await store("/parts/9")).headers.get("x-passed-to")).toBeNull();
  });

  it("passes anything outside /store/ to next()", async () => {
    for (const path of ["/", "/boards/x", "/store", "/storefront/v1"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.headers.get("x-passed-to"), path).toBe("next");
    }
  });
});
