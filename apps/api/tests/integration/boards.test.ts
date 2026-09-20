import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBoard, element, startTestApp, type TestApp } from "./support/harness.ts";

let harness: TestApp;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestApp();
  app = harness.app;
});

afterAll(async () => {
  await harness.close();
});

describe("board lifecycle", () => {
  it("creates, reads back, and exposes the rev as an ETag", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/boards",
      payload: { title: "Sprint plan" },
    });

    expect(created.statusCode).toBe(201);
    const summary = created.json() as { slug: string; rev: number };
    expect(created.headers.etag).toBe(`"${summary.rev}"`);
    expect(created.headers.location).toBe(`/v1/boards/${summary.slug}`);

    const fetched = await app.inject({ method: "GET", url: `/v1/boards/${summary.slug}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({
      title: "Sprint plan",
      elementCount: 0,
      bounds: null,
      scene: { type: "osidraw", version: 1, elements: [] },
    });
  });

  it("404s an unknown board and 400s a slug that could not exist", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/boards/aaaaaaaaaa" })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: "GET", url: "/v1/boards/NOT_A_SLUG" })).statusCode).toBe(
      400,
    );
  });

  it("soft-deletes so the board stops resolving", async () => {
    const slug = await createBoard(app);

    expect((await app.inject({ method: "DELETE", url: `/v1/boards/${slug}` })).statusCode).toBe(
      204,
    );
    expect((await app.inject({ method: "GET", url: `/v1/boards/${slug}` })).statusCode).toBe(404);
  });

  it("keeps boards private to their owner", async () => {
    const slug = await createBoard(app, "Mine");

    const asSomeoneElse = await app.inject({
      method: "GET",
      url: `/v1/boards/${slug}`,
      headers: { "x-owner-id": "someone-else" },
    });

    // Every repository query is scoped by ownerId, so another owner cannot even
    // learn the board exists.
    expect(asSomeoneElse.statusCode).toBe(404);
  });
});

describe("element reconciliation", () => {
  // Awaited inside: an un-awaited app.inject() is a chainable builder, not a response.
  const patch = async (slug: string, payload: object) =>
    await app.inject({ method: "PATCH", url: `/v1/boards/${slug}/elements`, payload });

  it("stores elements and denormalises count and bounds", async () => {
    const slug = await createBoard(app);

    const response = await patch(slug, {
      elements: [
        element({ id: "a", x: 0, y: 0, width: 10, height: 10 }),
        element({ id: "b", x: 100, y: 50, width: 20, height: 20 }),
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      elementCount: 2,
      applied: 2,
      rejected: 0,
      bounds: { minX: 0, minY: 0, maxX: 120, maxY: 70 },
    });
  });

  it("keeps the newer stamp and reports the stale write as rejected", async () => {
    const slug = await createBoard(app);
    await patch(slug, { elements: [element({ id: "a", version: 5, x: 500 })] });

    const stale = await patch(slug, { elements: [element({ id: "a", version: 2, x: 1 })] });

    expect(stale.json()).toMatchObject({ applied: 0, rejected: 1 });

    const board = await app.inject({ method: "GET", url: `/v1/boards/${slug}` });
    const elements = (board.json() as { scene: { elements: { x: number }[] } }).scene.elements;
    expect(elements[0]?.x).toBe(500);
  });

  it("converges no matter which order two writers arrive in", async () => {
    const [first, second] = [await createBoard(app), await createBoard(app)];

    const low = element({ id: "a", version: 2, x: 10 });
    const high = element({ id: "a", version: 7, x: 70 });

    await patch(first, { elements: [low] });
    await patch(first, { elements: [high] });

    await patch(second, { elements: [high] });
    await patch(second, { elements: [low] });

    const read = async (slug: string) =>
      (
        (await app.inject({ method: "GET", url: `/v1/boards/${slug}` })).json() as {
          scene: { elements: { x: number; version: number }[] };
        }
      ).scene.elements;

    expect(await read(second)).toEqual(await read(first));
    expect((await read(first))[0]).toMatchObject({ version: 7, x: 70 });
  });

  it("survives concurrent patches instead of losing one", async () => {
    const slug = await createBoard(app);

    // The rev guard means one of these loses its update and retries; both elements
    // must still be present afterwards.
    await Promise.all([
      patch(slug, { elements: [element({ id: "a" })] }),
      patch(slug, { elements: [element({ id: "b" })] }),
      patch(slug, { elements: [element({ id: "c" })] }),
    ]);

    const board = await app.inject({ method: "GET", url: `/v1/boards/${slug}` });
    const ids = (board.json() as { scene: { elements: { id: string }[] } }).scene.elements.map(
      (e) => e.id,
    );

    expect(new Set(ids)).toEqual(new Set(["a", "b", "c"]));
  });

  it("hides tombstoned elements but keeps them for the merge", async () => {
    const slug = await createBoard(app);
    await patch(slug, { elements: [element({ id: "a" }), element({ id: "b" })] });
    await patch(slug, { elements: [element({ id: "a", version: 2, isDeleted: true })] });

    const board = await app.inject({ method: "GET", url: `/v1/boards/${slug}` });
    const payload = board.json() as { elementCount: number; scene: { elements: { id: string }[] } };

    expect(payload.scene.elements.map((e) => e.id)).toEqual(["b"]);
    expect(payload.elementCount).toBe(1);

    // The tombstone is still stored, so a replay of the older element loses.
    const replay = await patch(slug, { elements: [element({ id: "a" })] });
    expect(replay.json()).toMatchObject({ rejected: 1 });
  });

  it("applies an explicit z-order, which no stamp could express", async () => {
    const slug = await createBoard(app);
    await patch(slug, {
      elements: [element({ id: "a" }), element({ id: "b" }), element({ id: "c" })],
    });

    await patch(slug, { elements: [], order: ["c", "a", "b"] });

    const board = await app.inject({ method: "GET", url: `/v1/boards/${slug}` });
    const ids = (board.json() as { scene: { elements: { id: string }[] } }).scene.elements.map(
      (e) => e.id,
    );

    expect(ids).toEqual(["c", "a", "b"]);
  });
});

describe("full replace", () => {
  it("requires If-Match, and 409s when the rev has moved on", async () => {
    const slug = await createBoard(app);
    const scene = { type: "osidraw", version: 1, elements: [element()] };

    const noPrecondition = await app.inject({
      method: "PUT",
      url: `/v1/boards/${slug}`,
      payload: scene,
    });
    expect(noPrecondition.statusCode).toBe(428);

    const stale = await app.inject({
      method: "PUT",
      url: `/v1/boards/${slug}`,
      headers: { "if-match": '"999"' },
      payload: scene,
    });
    expect(stale.statusCode).toBe(409);

    const current = await app.inject({ method: "GET", url: `/v1/boards/${slug}` });
    const ok = await app.inject({
      method: "PUT",
      url: `/v1/boards/${slug}`,
      headers: { "if-match": current.headers.etag as string },
      payload: { ...scene, title: "Renamed" },
    });

    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ title: "Renamed", elementCount: 1 });
  });

  it("accepts * for a caller that just wants to overwrite", async () => {
    const slug = await createBoard(app);

    const response = await app.inject({
      method: "PUT",
      url: `/v1/boards/${slug}`,
      headers: { "if-match": "*" },
      payload: { type: "osidraw", version: 1, elements: [] },
    });

    expect(response.statusCode).toBe(200);
  });
});
