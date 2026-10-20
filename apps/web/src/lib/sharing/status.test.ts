import { describe, expect, it } from "vitest";
import { forgetUnsent, isUnsent, markUnsent, SHARED_LABELS, sharedLine } from "./status.ts";

const calm = { unread: false, unsent: false };

/** Storage as the page has it, in memory. */
function storage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("sharedLine", () => {
  it("says the copy is saved, saving, waiting, or unavailable, as its saver is", () => {
    expect(SHARED_LABELS[sharedLine("idle", calm)]).toBe("Shared copy saved");
    expect(SHARED_LABELS[sharedLine("saving", calm)]).toBe("Saving the shared copy…");
    expect(SHARED_LABELS[sharedLine("pending", calm)]).toBe("Shared copy: unsaved changes");
    expect(SHARED_LABELS[sharedLine("error", calm)]).toBe("Shared copy unavailable — retrying");
  });

  it("names the answers that a retry will not change", () => {
    expect(SHARED_LABELS[sharedLine("too-large", calm)]).toBe("Shared copy not saved — over 10 MB");
    expect(SHARED_LABELS[sharedLine("refused", calm)]).toBe(
      "Shared copy not saved — this link cannot write it",
    );
  });

  it("says the last seconds may be missing until the edits that follow are saved", () => {
    const unsent = { unread: false, unsent: true };
    expect(SHARED_LABELS[sharedLine("idle", unsent)]).toBe(
      "Shared copy may lack the last seconds before the tab closed",
    );
    // Sending them again is not having sent them.
    expect(sharedLine("saving", unsent)).toBe("unsent");
    expect(sharedLine("pending", unsent)).toBe("unsent");
    // A failure says more than a doubt does.
    expect(sharedLine("error", unsent)).toBe("error");
    expect(sharedLine("refused", unsent)).toBe("refused");
  });

  it("says a copy that could not be read could not, under any saving failure", () => {
    const unread = { unread: true, unsent: true };
    expect(SHARED_LABELS[sharedLine("idle", unread)]).toBe(
      "Shared copy unavailable — could not be read",
    );
    expect(sharedLine("saving", unread)).toBe("unread");
    expect(sharedLine("error", unread)).toBe("error");
    expect(sharedLine("too-large", unread)).toBe("too-large");
  });
});

describe("the unsent mark", () => {
  it("is kept per drawing until it is forgotten", () => {
    const store = storage();
    markUnsent(store, "drawinga");

    expect(isUnsent(store, "drawinga")).toBe(true);
    expect(isUnsent(store, "drawingb")).toBe(false);
    forgetUnsent(store, "drawinga");
    expect(isUnsent(store, "drawinga")).toBe(false);
  });

  it("is no mark, and no failure, where the page may not store anything", () => {
    const blocked = {
      ...storage(),
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    } as Storage;

    expect(() => markUnsent(blocked, "drawinga")).not.toThrow();
    expect(() => forgetUnsent(blocked, "drawinga")).not.toThrow();
    expect(isUnsent(blocked, "drawinga")).toBe(false);
    expect(isUnsent(null, "drawinga")).toBe(false);
  });
});
