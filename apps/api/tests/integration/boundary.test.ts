import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_ELEMENTS_PER_BOARD, MAX_PAGE_SIZE } from "@drawnosaurus/contract";
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

/** Everything here is untrusted input. The engine assumes well-formed scenes. */
describe("scene validation", () => {
  const patch = async (slug: string, payload: object) =>
    await app.inject({ method: "PATCH", url: `/v1/boards/${slug}/elements`, payload });

  it("rejects a non-finite coordinate", async () => {
    const slug = await createBoard(app);

    // JSON has no NaN literal, so this is how it actually arrives over the wire.
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/boards/${slug}/elements`,
      headers: { "content-type": "application/json" },
      payload: `{"elements":[${JSON.stringify(element()).replace('"x":0', '"x":1e999')}]}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("rejects an out-of-range opacity and an unknown element type", async () => {
    const slug = await createBoard(app);

    expect((await patch(slug, { elements: [element({ opacity: 240 })] })).statusCode).toBe(400);
    expect((await patch(slug, { elements: [{ ...element(), type: "hologram" }] })).statusCode).toBe(
      400,
    );
  });

  it("strips unknown keys rather than rejecting a newer engine's output", async () => {
    const slug = await createBoard(app);

    const response = await patch(slug, {
      elements: [{ ...element({ id: "a" }), futureField: "ignore me" }],
    });

    expect(response.statusCode).toBe(200);

    const board = await app.inject({ method: "GET", url: `/v1/boards/${slug}` });
    const [stored] = (board.json() as { scene: { elements: Record<string, unknown>[] } }).scene
      .elements;
    expect(stored).not.toHaveProperty("futureField");
  });

  it("caps the element count", async () => {
    const slug = await createBoard(app);
    const tooMany = Array.from({ length: MAX_ELEMENTS_PER_BOARD + 1 }, (_, i) =>
      element({ id: `el-${i}` }),
    );

    expect((await patch(slug, { elements: tooMany })).statusCode).toBe(400);
  });

  it("rejects a body past the limit before any handler runs", async () => {
    const slug = await createBoard(app);
    // One oversized string is enough; the point is that the guard is the body limit,
    // not the schema, so a malicious payload never gets parsed into elements.
    const huge = "x".repeat(9 * 1024 * 1024);

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/boards/${slug}/elements`,
      headers: { "content-type": "application/json" },
      payload: `{"elements":[],"note":"${huge}"}`,
    });

    expect(response.statusCode).toBe(413);
  });

  it("rejects malformed JSON with the standard envelope", async () => {
    const slug = await createBoard(app);

    const response = await app.inject({
      method: "PATCH",
      url: `/v1/boards/${slug}/elements`,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error.message");
  });

  it("requires a title on create", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/v1/boards", payload: { title: "  " } }))
        .statusCode,
    ).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/boards", payload: {} })).statusCode).toBe(
      400,
    );
  });
});

describe("pagination", () => {
  it("walks every board exactly once across pages", async () => {
    const owner = "pagination-owner";
    const titles = Array.from({ length: 7 }, (_, i) => `board-${i}`);
    for (const title of titles) {
      await app.inject({
        method: "POST",
        url: "/v1/boards",
        headers: { "x-owner-id": owner },
        payload: { title },
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const query = cursor === null ? "?limit=3" : `?limit=3&cursor=${encodeURIComponent(cursor)}`;
      const response = await app.inject({
        method: "GET",
        url: `/v1/boards${query}`,
        headers: { "x-owner-id": owner },
      });

      const page = response.json() as {
        boards: { title: string }[];
        nextCursor: string | null;
      };
      seen.push(...page.boards.map((board) => board.title));
      cursor = page.nextCursor;
    } while (cursor !== null);

    // No duplicates and nothing missed: the keyset cursor is exact even when several
    // boards share a millisecond.
    expect(seen.sort()).toEqual([...titles].sort());
  });

  it("never returns element arrays in a list", async () => {
    const slug = await createBoard(app, "with elements");
    await app.inject({
      method: "PATCH",
      url: `/v1/boards/${slug}/elements`,
      payload: { elements: [element()] },
    });

    const response = await app.inject({ method: "GET", url: "/v1/boards?limit=50" });
    const { boards } = response.json() as { boards: Record<string, unknown>[] };

    expect(boards.length).toBeGreaterThan(0);
    for (const board of boards) expect(board).not.toHaveProperty("scene");
  });

  it("refuses a page size above the ceiling", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/boards?limit=${MAX_PAGE_SIZE + 1}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a forged cursor instead of scanning", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/boards?cursor=abc" })).statusCode).toBe(
      400,
    );
  });
});

describe("health", () => {
  it("reports liveness and readiness", async () => {
    expect((await app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "GET", url: "/readyz" })).json()).toEqual({
      status: "ready",
    });
  });

  it("uses the one error envelope for an unknown route", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
