import { describe, expect, it } from "vitest";
import type { StampedElement } from "./sceneDiff.ts";
import { splitPatch } from "./split.ts";

const el = (id: string, patch: Record<string, unknown> = {}): StampedElement =>
  ({ id, version: 1, versionNonce: 1, updated: 0, isDeleted: false, ...patch }) as StampedElement;

const ids = (parts: { elements: StampedElement[] }[]): string[][] =>
  parts.map((part) => part.elements.map((element) => element.id));

describe("splitPatch", () => {
  it("leaves an ordinary patch as one request", () => {
    expect(ids(splitPatch({ elements: [el("a"), el("b")] }))).toEqual([["a", "b"]]);
  });

  it("still sends a patch that is only a reorder", () => {
    expect(splitPatch({ elements: [], order: ["b", "a"] })).toEqual([
      { elements: [], order: ["b", "a"] },
    ]);
  });

  it("sends each picture alone, after everything else", () => {
    // So a picture refused for its size refuses only itself: the move and the text
    // edit beside it have already landed.
    const parts = splitPatch({
      elements: [el("photo", { dataUrl: "data:image/png;base64,AAAA" }), el("a"), el("b")],
    });
    expect(ids(parts)).toEqual([["a", "b"], ["photo"]]);
  });

  it("sends two pictures in two requests", () => {
    const parts = splitPatch({
      elements: [
        el("one", { dataUrl: "data:image/png;base64,AAAA" }),
        el("two", { dataUrl: "data:image/png;base64,BBBB" }),
      ],
    });
    expect(ids(parts)).toEqual([["one"], ["two"]]);
  });

  it("splits ordinary elements that would not fit in one request", () => {
    const big = (id: string) => el(id, { text: "x".repeat(400) });
    const parts = splitPatch({ elements: [big("a"), big("b"), big("c")] }, 1000);
    expect(ids(parts)).toEqual([["a", "b"], ["c"]]);
  });

  it("carries the order on every request, so the last to land sequences everything", () => {
    const parts = splitPatch({
      elements: [el("a"), el("photo", { dataUrl: "data:image/png;base64,AAAA" })],
      order: ["photo", "a"],
    });
    expect(parts.map((part) => part.order)).toEqual([
      ["photo", "a"],
      ["photo", "a"],
    ]);
  });
});
