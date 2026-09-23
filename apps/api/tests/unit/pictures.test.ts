import { describe, expect, it } from "vitest";
import type { DrawElementDto } from "@drawnosaurus/contract";
import { keepPictures } from "../../src/boards/pictures.ts";
import type { StoredElement } from "../../src/mongo.ts";

/**
 * Which picture each image keeps when edits of it meet at the server. A picture never
 * changes once an image has one, and clients send it once, so an edit usually arrives
 * without it — see `boards/pictures.ts`.
 */

const image = (patch: Partial<StoredElement> = {}): StoredElement => ({
  id: "img",
  type: "image",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  angle: 0,
  strokeColor: "#000",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
  ...patch,
});

describe("keepPictures", () => {
  it("gives an edit without a picture the one kept for it", () => {
    const stored = image({ picture: "key" });
    const moved = image({ x: 50, version: 2 });
    expect(keepPictures([moved], [stored], [moved])).toEqual([{ ...moved, picture: "key" }]);
  });

  it("takes the picture from an incoming copy when the one kept has none", () => {
    const stored = image({ version: 2 });
    const late = image({ version: 2, dataUrl: "data:image/png;base64,AA==" });
    // The merge kept the stored copy: the stamps tie.
    expect(keepPictures([stored], [stored], [late])[0]?.dataUrl).toBe(late.dataUrl);
  });

  it("keeps none on a deleted image", () => {
    const tombstone = image({ version: 2, isDeleted: true, picture: "key" });
    const [kept] = keepPictures([tombstone], [image({ picture: "key" })], [tombstone]);
    expect(kept).not.toHaveProperty("picture");
    expect(kept).not.toHaveProperty("dataUrl");
  });

  it("leaves everything that is not an image alone", () => {
    const shape: DrawElementDto = { ...image(), type: "rectangle" };
    expect(keepPictures([shape], [{ ...shape, picture: "key" }], [])).toEqual([shape]);
  });
});
