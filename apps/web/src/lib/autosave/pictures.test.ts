import { describe, expect, it } from "vitest";
import { fillPictures, PictureLedger } from "./pictures.ts";

const PNG = "data:image/png;base64,AAAA";
const JPG = "data:image/jpeg;base64,BBBB";

const image = (id: string, patch: { dataUrl?: string; isDeleted?: boolean; x?: number } = {}) => ({
  id,
  type: "image",
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
  ...patch,
});

describe("PictureLedger", () => {
  it("sends a picture the first time and leaves it off after", () => {
    const ledger = new PictureLedger();
    const first = [image("a", { dataUrl: PNG })];
    expect(ledger.strip(first)).toEqual(first);
    ledger.note(first);

    const moved = [image("a", { dataUrl: PNG, x: 50 })];
    expect(ledger.strip(moved)).toEqual([image("a", { x: 50 })]);
    expect(moved[0]!.dataUrl, "only the copy sent loses it").toBe(PNG);
  });

  it("starts from what the other side loaded", () => {
    const ledger = new PictureLedger();
    ledger.reset([image("a", { dataUrl: PNG })]);
    expect(ledger.strip([image("a", { dataUrl: PNG })])).toEqual([image("a")]);
  });

  it("sends a different picture under the same id", () => {
    const ledger = new PictureLedger();
    ledger.reset([image("a", { dataUrl: PNG })]);
    expect(ledger.strip([image("a", { dataUrl: JPG })])).toEqual([image("a", { dataUrl: JPG })]);
  });

  it("forgets a picture once its image is deleted, so an undo sends it again", () => {
    // The server and the engine drop a tombstone's picture: nothing has it any more.
    const ledger = new PictureLedger();
    ledger.reset([image("a", { dataUrl: PNG })]);
    ledger.note([image("a", { isDeleted: true })]);
    expect(ledger.strip([image("a", { dataUrl: PNG })])).toEqual([image("a", { dataUrl: PNG })]);
  });

  it("keeps what it knew when a copy without the picture goes by", () => {
    const ledger = new PictureLedger();
    ledger.reset([image("a", { dataUrl: PNG })]);
    ledger.note([image("a", { x: 9 })]);
    expect(ledger.strip([image("a", { dataUrl: PNG })])).toEqual([image("a")]);
  });
});

describe("fillPictures", () => {
  const here = new Map([["a", image("a", { dataUrl: PNG })]]);
  const known = (id: string) => here.get(id);

  it("gives an image that came without its picture the one here", () => {
    expect(fillPictures([image("a", { x: 5 })], known)).toEqual([
      image("a", { x: 5, dataUrl: PNG }),
    ]);
  });

  it("leaves a tombstone, an image it does not know, and anything that is not an image", () => {
    const shape = { ...image("a"), type: "rectangle" };
    const elements = [image("a", { isDeleted: true }), image("b"), shape];
    expect(fillPictures(elements, known)).toEqual(elements);
  });
});
