import { describe, expect, it } from "vitest";
import { SceneMirror } from "./sceneMirror.ts";

interface Element {
  id: string;
  v: number;
  isDeleted?: boolean;
}

const el = (id: string, v = 1, isDeleted = false): Element => ({ id, v, isDeleted });
const ids = (mirror: SceneMirror<Element>) => mirror.elements.map((e) => e.id);

describe("SceneMirror", () => {
  it("updates an element where it stands and puts a new one on top", () => {
    const mirror = new SceneMirror<Element>();
    mirror.replace([el("a"), el("b"), el("c")]);

    const appended = mirror.apply({ updated: [el("b", 2), el("d"), el("e")], removed: [] });

    expect(ids(mirror)).toEqual(["a", "b", "c", "d", "e"]);
    expect(mirror.lookup("b")?.v).toBe(2);
    expect(appended).toEqual(["d", "e"]);
  });

  it("puts the stack in the order a delta carries, when the stack moved", () => {
    // A shape drawn into a frame goes directly below it, and the engine says so.
    const mirror = new SceneMirror<Element>();
    mirror.replace([el("c1"), el("f"), el("x")]);

    const appended = mirror.apply({
      updated: [el("n")],
      removed: [],
      order: ["c1", "n", "f", "x"],
    });

    expect(ids(mirror)).toEqual(["c1", "n", "f", "x"]);
    expect(mirror.lookup("f")?.id).toBe("f");
    expect(appended).toEqual(["n"]);
  });

  it("keeps on top what an order leaves out", () => {
    const mirror = new SceneMirror<Element>();
    mirror.replace([el("a"), el("b"), el("c")]);

    mirror.apply({ updated: [], removed: [], order: ["b", "a"] });

    expect(ids(mirror)).toEqual(["b", "a", "c"]);
  });

  it("changes the list it already has, rather than building another", () => {
    // The point: a change costs what it touches, not the board.
    const mirror = new SceneMirror<Element>();
    mirror.replace([el("a"), el("b")]);
    const list = mirror.elements;

    mirror.apply({ updated: [el("a", 2), el("c")], removed: [] });

    expect(mirror.elements).toBe(list);
  });

  it("takes out what a delta deletes, and still finds the rest", () => {
    const mirror = new SceneMirror<Element>();
    mirror.replace([el("a"), el("b"), el("c")]);

    const appended = mirror.apply({ updated: [el("c", 2), el("d")], removed: ["a"] });

    expect(ids(mirror)).toEqual(["b", "c", "d"]);
    expect(appended).toEqual(["d"]);
    expect(mirror.lookup("a")).toBeUndefined();
    expect(mirror.lookup("d")?.id).toBe("d");
    expect(mirror.lookup("c")?.v).toBe(2);
  });

  it("treats an element marked deleted like one removed", () => {
    const mirror = new SceneMirror<Element>();
    mirror.replace([el("a"), el("b")]);

    mirror.apply({ updated: [el("a", 2, true)], removed: [] });

    expect(ids(mirror)).toEqual(["b"]);
  });

  it("says what a whole scene changed", () => {
    const mirror = new SceneMirror<Element>();
    const a = el("a");
    mirror.replace([a, el("b"), el("c")]);

    const { changed, removed } = mirror.replace([el("c", 2), a, el("d")]);

    expect(ids(mirror)).toEqual(["c", "a", "d"]);
    expect(changed.map((e) => e.id)).toEqual(["c", "d"]);
    expect(removed).toEqual(["b"]);
    expect(mirror.lookup("a")).toBe(a);
  });

  it("keeps no tombstones", () => {
    const mirror = new SceneMirror<Element>();
    mirror.replace([el("a"), el("b", 1, true)]);
    expect(ids(mirror)).toEqual(["a"]);
  });
});
