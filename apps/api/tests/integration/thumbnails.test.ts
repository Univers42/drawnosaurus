import type { FastifyInstance } from "fastify";
import { MAX_THUMBNAIL_BYTES } from "@drawnosaurus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBoard, element, startTestApp, type TestApp } from "./support/harness.ts";

/**
 * A board's thumbnail is stored beside the board, and storing it must leave the board
 * alone: the gallery sorts on `updatedAt` and `If-Match` relies on `rev`.
 */

let harness: TestApp;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestApp();
  app = harness.app;
});

afterAll(async () => {
  await harness.close();
});

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (size = 64): Buffer =>
  Buffer.concat([SIGNATURE, Buffer.alloc(size - SIGNATURE.length, 7)]);

const put = async (slug: string, payload: Buffer, contentType = "image/png") =>
  await app.inject({
    method: "PUT",
    url: `/v1/boards/${slug}/thumbnail`,
    headers: { "content-type": contentType },
    payload,
  });

const get = async (slug: string, headers: Record<string, string> = {}) =>
  await app.inject({ method: "GET", url: `/v1/boards/${slug}/thumbnail`, headers });

const summary = async (slug: string) =>
  (await app.inject({ method: "GET", url: `/v1/boards/${slug}` })).json() as {
    rev: number;
    updatedAt: string;
    thumbnailAt: string | null;
  };

describe("PUT and GET /v1/boards/:slug/thumbnail", () => {
  it("returns the stored bytes with an ETag and nosniff", async () => {
    const slug = await createBoard(app);
    const bytes = png(300);

    const stored = await put(slug, bytes);
    expect(stored.statusCode).toBe(204);
    expect(stored.headers.etag).toMatch(/^"t-[0-9a-f]{16}"$/);

    const fetched = await get(slug);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers["content-type"]).toBe("image/png");
    expect(fetched.headers.etag).toBe(stored.headers.etag);
    expect(fetched.headers["x-content-type-options"]).toBe("nosniff");
    expect(fetched.headers["cache-control"]).toBe("private, no-cache");
    expect(fetched.rawPayload.equals(bytes)).toBe(true);
  });

  it("replaces the previous picture in place", async () => {
    const slug = await createBoard(app);
    await put(slug, png(100));
    const second = png(200);
    await put(slug, second);

    expect((await get(slug)).rawPayload.equals(second)).toBe(true);
  });

  it("answers 304 when If-None-Match names the ETag", async () => {
    const slug = await createBoard(app);
    const { headers } = await put(slug, png());

    const again = await get(slug, { "if-none-match": headers.etag as string });
    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);

    expect((await get(slug, { "if-none-match": '"t-other"' })).statusCode).toBe(200);
  });

  it("refuses a body that is not image/png with 415", async () => {
    const slug = await createBoard(app);
    expect((await put(slug, png(), "application/octet-stream")).statusCode).toBe(415);
  });

  it("refuses bytes that are not a PNG with 400 bad_thumbnail", async () => {
    const slug = await createBoard(app);
    const response = await put(slug, Buffer.from("<svg></svg>"));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "bad_thumbnail" } });
    expect((await get(slug)).statusCode).toBe(404);
  });

  it("accepts exactly the limit and refuses one byte more with 413", async () => {
    const slug = await createBoard(app);
    expect((await put(slug, png(MAX_THUMBNAIL_BYTES))).statusCode).toBe(204);
    expect((await put(slug, png(MAX_THUMBNAIL_BYTES + 1))).statusCode).toBe(413);
  });

  it("404s an unknown board, a foreign board and a deleted board", async () => {
    expect((await put("aaaaaaaaaa", png())).statusCode).toBe(404);
    expect((await get("aaaaaaaaaa")).statusCode).toBe(404);

    const mine = await createBoard(app);
    await put(mine, png());
    const foreign = await app.inject({
      method: "GET",
      url: `/v1/boards/${mine}/thumbnail`,
      headers: { "x-owner-id": "someone-else" },
    });
    expect(foreign.statusCode).toBe(404);

    await app.inject({ method: "DELETE", url: `/v1/boards/${mine}` });
    expect((await get(mine)).statusCode).toBe(404);
    expect((await put(mine, png())).statusCode).toBe(404);
  });

  it("404s a board that has no thumbnail yet", async () => {
    expect((await get(await createBoard(app))).statusCode).toBe(404);
  });
});

describe("thumbnailAt", () => {
  it("is null until a thumbnail is stored, then appears in the board and the list", async () => {
    const slug = await createBoard(app);
    expect((await summary(slug)).thumbnailAt).toBeNull();

    await put(slug, png());

    const board = await summary(slug);
    expect(board.thumbnailAt).toEqual(expect.any(String));
    const list = (await app.inject({ method: "GET", url: "/v1/boards?limit=100" })).json() as {
      boards: { slug: string; thumbnailAt: string | null }[];
    };
    expect(list.boards.find((row) => row.slug === slug)?.thumbnailAt).toBe(board.thumbnailAt);
  });
});

describe("a thumbnail is not an edit", () => {
  it("leaves rev, ETag, updatedAt and the list order alone, and an old If-Match still works", async () => {
    const older = await createBoard(app, "older");
    const newer = await createBoard(app, "newer");
    const before = await app.inject({ method: "GET", url: `/v1/boards/${older}` });
    const order = async () =>
      (
        (await app.inject({ method: "GET", url: "/v1/boards?limit=100" })).json() as {
          boards: { slug: string }[];
        }
      ).boards.map((row) => row.slug);
    const orderBefore = await order();
    expect(orderBefore.indexOf(newer)).toBeLessThan(orderBefore.indexOf(older));

    await put(older, png());

    const after = await app.inject({ method: "GET", url: `/v1/boards/${older}` });
    expect(after.headers.etag).toBe(before.headers.etag);
    expect((after.json() as { rev: number }).rev).toBe((before.json() as { rev: number }).rev);
    expect((after.json() as { updatedAt: string }).updatedAt).toBe(
      (before.json() as { updatedAt: string }).updatedAt,
    );
    expect(await order()).toEqual(orderBefore);

    const replaced = await app.inject({
      method: "PUT",
      url: `/v1/boards/${older}`,
      headers: { "if-match": before.headers.etag as string },
      payload: { type: "osidraw", version: 1, elements: [element()] },
    });
    expect(replaced.statusCode).toBe(200);
  });
});
