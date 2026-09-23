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

describe("a deleted image", () => {
  /**
   * Three of the largest pictures do not fit in one board. Deleting one has to make room
   * for another: a tombstone that kept its picture never did, so a board that had once
   * held three photos refused the next one while showing none.
   */
  it("gives its room back", async () => {
    const slug = await createBoard(app);
    const picture = largestPicture();
    for (const id of ["one", "two"]) {
      expect(
        (await patch(slug, [element({ id, type: "image", dataUrl: picture })])).statusCode,
      ).toBe(200);
    }

    // The tombstone as a client might send it: picture and all.
    const deleted = await patch(slug, [
      element({ id: "one", type: "image", dataUrl: picture, isDeleted: true, version: 2 }),
    ]);
    expect(deleted.statusCode).toBe(200);
    const third = await patch(slug, [element({ id: "three", type: "image", dataUrl: picture })]);

    expect(third.statusCode).toBe(200);
  });
});

describe("a board with more pictures than one document could hold", () => {
  /**
   * A board is one MongoDB document, and pictures used to be kept inside it: its 16MB
   * ceiling was reached at two or three photos, and every save after that was refused.
   * They are kept beside the board now (`boards/pictures.ts`).
   */
  it("keeps every one of them", async () => {
    const slug = await createBoard(app);
    const picture = largestPicture();
    const ids = ["one", "two", "three", "four"];

    for (const [index, id] of ids.entries()) {
      // Four different pictures, so none is kept as a copy of another.
      const distinct = `${picture.slice(0, -1)}${"BCDE"[index]}`;
      const response = await patch(slug, [element({ id, type: "image", dataUrl: distinct })]);
      expect(response.statusCode, `${id} was refused`).toBe(200);
    }

    const board = (await app.inject({ method: "GET", url: `/v1/boards/${slug}` })).json() as {
      scene: { elements: { id: string; dataUrl?: string }[] };
    };
    expect(board.scene.elements.map((el) => el.id).sort()).toEqual([...ids].sort());
    for (const el of board.scene.elements) {
      expect(el.dataUrl?.length, `${el.id} came back without its picture`).toBe(picture.length);
    }
  });

  it("comes back whole from a full replace too", async () => {
    const slug = await createBoard(app);
    const response = await app.inject({
      method: "PUT",
      url: `/v1/boards/${slug}`,
      headers: { "if-match": "*" },
      payload: {
        type: "osidraw",
        version: 1,
        elements: [element({ id: "img", type: "image", dataUrl: PNG })],
      },
    });
    expect(response.statusCode).toBe(200);
    const put = response.json() as { scene: { elements: { dataUrl?: string }[] } };
    expect(put.scene.elements[0]?.dataUrl).toBe(PNG);
  });
});

describe("a board past MongoDB's 16MB document ceiling", () => {
  /**
   * Shapes and text are still kept inside the board. Each request is within the body
   * limit, so it is the database that refuses the third — and that used to reach the
   * client as a bare 500, which the autosaver retries forever without saying why.
   */
  it("is refused as too large, not as a server fault, and keeps what it had", async () => {
    const slug = await createBoard(app);
    const batch = (prefix: string) =>
      Array.from({ length: 700 }, (_, index) =>
        element({ id: `${prefix}${index}`, type: "text", text: "a".repeat(10_000) }),
      );

    for (const prefix of ["a", "b"]) {
      const response = await patch(slug, batch(prefix));
      expect(response.statusCode, `setup: ${prefix} should fit`).toBe(200);
    }
    const third = await patch(slug, batch("c"));

    expect(third.statusCode).toBe(413);
    expect((third.json() as { error: { code: string } }).error.code).toBe("board_too_large");

    const board = (await app.inject({ method: "GET", url: `/v1/boards/${slug}` })).json() as {
      scene: { elements: { id: string }[] };
    };
    expect(board.scene.elements).toHaveLength(1400);
  });
});

describe("a picture is sent once per image", () => {
  /**
   * A picture never changes once an image has one, so clients leave it off every later
   * edit of the image: a photo moved is a few hundred bytes rather than megabytes, each
   * time, from every client in the room. The server keeps the picture it has.
   */
  const board = async (slug: string, query = "") =>
    (
      (await app.inject({ method: "GET", url: `/v1/boards/${slug}${query}` })).json() as {
        scene: { elements: { id: string; x: number; dataUrl?: string; isDeleted: boolean }[] };
      }
    ).scene.elements;

  it("keeps the picture it has when an edit arrives without one", async () => {
    const slug = await createBoard(app);
    await patch(slug, [element({ id: "img", type: "image", dataUrl: PNG })]);

    const moved = await patch(slug, [element({ id: "img", type: "image", x: 500, version: 2 })]);

    expect(moved.statusCode).toBe(200);
    const [img] = await board(slug);
    expect(img?.x).toBe(500);
    expect(img?.dataUrl, "the move lost the picture").toBe(PNG);
  });

  it("takes the picture from a copy of the same edit that arrives after it", async () => {
    // The move reached the server first — from a client that had not seen the picture
    // yet — and the picture came with the same edit from the client that had.
    const slug = await createBoard(app);
    await patch(slug, [element({ id: "img", type: "image", version: 2 })]);
    expect((await board(slug))[0]?.dataUrl).toBeUndefined();

    await patch(slug, [element({ id: "img", type: "image", version: 2, dataUrl: PNG })]);

    expect((await board(slug))[0]?.dataUrl).toBe(PNG);
  });

  it("keeps none for a deleted image, and takes it back with an undo", async () => {
    const slug = await createBoard(app);
    await patch(slug, [element({ id: "img", type: "image", dataUrl: PNG })]);
    await patch(slug, [element({ id: "img", type: "image", version: 2, isDeleted: true })]);
    const [tombstone] = await board(slug, "?include=tombstones");
    expect(tombstone?.isDeleted).toBe(true);
    expect(tombstone?.dataUrl).toBeUndefined();

    await patch(slug, [element({ id: "img", type: "image", version: 3, dataUrl: PNG })]);
    expect((await board(slug))[0]?.dataUrl).toBe(PNG);
  });
});
