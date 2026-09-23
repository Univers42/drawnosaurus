import type { FastifyInstance } from "fastify";
import { MAX_IMAGE_DATA_URL_LENGTH } from "@drawnosaurus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBoard, element, startTestApp, type TestApp } from "./support/harness.ts";

/**
 * Images carry their picture inline, as a `data:` URL on the element.
 *
 * Two things only a real database can say: that the picture survives the round trip —
 * the contract used to strip the field, so every image saved as an empty frame — and
 * what happens when inline pictures push a board past MongoDB's 16MB document ceiling.
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

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** The largest picture one element may carry. Base64 of nothing in particular. */
function largestPicture(): string {
  const header = "data:image/png;base64,";
  return header + "A".repeat(MAX_IMAGE_DATA_URL_LENGTH - header.length);
}

const patch = (slug: string, elements: unknown[]) =>
  app.inject({ method: "PATCH", url: `/v1/boards/${slug}/elements`, payload: { elements } });

describe("an image's picture", () => {
  it("comes back after a reload", async () => {
    const slug = await createBoard(app);

    const saved = await patch(slug, [element({ id: "img", type: "image", dataUrl: PNG })]);
    expect(saved.statusCode).toBe(200);

    const board = (await app.inject({ method: "GET", url: `/v1/boards/${slug}` })).json() as {
      scene: { elements: { id: string; dataUrl?: string }[] };
    };
    expect(board.scene.elements.find((el) => el.id === "img")?.dataUrl).toBe(PNG);
  });

  it("is refused when it is not a picture", async () => {
    const slug = await createBoard(app);

    const response = await patch(slug, [
      element({ id: "img", type: "image", dataUrl: "javascript:alert(1)" }),
    ]);

    expect(response.statusCode).toBe(400);
  });

  it("fits in one autosave at the largest size allowed", async () => {
    const slug = await createBoard(app);

    const response = await patch(slug, [
      element({ id: "big", type: "image", dataUrl: largestPicture() }),
    ]);

    expect(response.statusCode).toBe(200);
  });
});

describe("a board past MongoDB's 16MB document ceiling", () => {
  /**
   * Three of the largest pictures do not fit in one document. Each request is within the
   * body limit, so it is the database that refuses the third — and that used to reach the
   * client as a bare 500, which the autosaver retries forever without saying why.
   */
  it("is refused as too large, not as a server fault, and keeps what it had", async () => {
    const slug = await createBoard(app);
    const picture = largestPicture();

    for (const id of ["one", "two"]) {
      const response = await patch(slug, [element({ id, type: "image", dataUrl: picture })]);
      expect(response.statusCode, `setup: ${id} should fit`).toBe(200);
    }
    const third = await patch(slug, [element({ id: "three", type: "image", dataUrl: picture })]);

    expect(third.statusCode).toBe(413);
    expect((third.json() as { error: { code: string } }).error.code).toBe("board_too_large");

    const board = (await app.inject({ method: "GET", url: `/v1/boards/${slug}` })).json() as {
      scene: { elements: { id: string }[] };
    };
    expect(board.scene.elements.map((el) => el.id).sort()).toEqual(["one", "two"]);
  });
});
