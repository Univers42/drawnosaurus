import { describe, expect, it } from "vitest";
import { DRAFT_PREFIX, writeDraft } from "./draft.ts";

/** Storage with a quota, as the browser's has. */
function storageOf(quota: number) {
  const items = new Map<string, string>();
  return {
    items,
    setItem(key: string, value: string) {
      if (value.length > quota) throw new DOMException("full", "QuotaExceededError");
      items.set(key, value);
    },
    removeItem(key: string) {
      items.delete(key);
    },
  };
}

const PICTURE = "data:image/png;base64," + "A".repeat(5000);
const board = [
  { id: "box", type: "rectangle" },
  { id: "photo", type: "image", dataUrl: PICTURE },
];

describe("writeDraft", () => {
  it("keeps the whole board when it fits", () => {
    const storage = storageOf(1_000_000);
    expect(writeDraft(storage, "s", board)).toBe("full");
    expect(storage.items.get(`${DRAFT_PREFIX}s`)).toContain(PICTURE);
  });

  it("drops the pictures rather than throwing when the board is over the quota", () => {
    // The throw used to stop the autosave with it.
    const storage = storageOf(1000);
    expect(writeDraft(storage, "s", board)).toBe("without-pictures");
    const saved = JSON.parse(storage.items.get(`${DRAFT_PREFIX}s`)!);
    expect(saved.elements.map((e: { id: string }) => e.id)).toEqual(["box", "photo"]);
    expect(saved.elements[1].dataUrl).toBeUndefined();
  });

  it("removes a stale draft when even that does not fit", () => {
    const storage = storageOf(10);
    storage.items.set(`${DRAFT_PREFIX}s`, "old");
    expect(writeDraft(storage, "s", board)).toBe("none");
    expect(storage.items.has(`${DRAFT_PREFIX}s`)).toBe(false);
  });

  it("never throws, whatever the storage does", () => {
    const hostile = {
      setItem() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
    };
    expect(() => writeDraft(hostile, "s", board)).not.toThrow();
    expect(writeDraft(undefined, "s", board)).toBe("none");
  });
});
