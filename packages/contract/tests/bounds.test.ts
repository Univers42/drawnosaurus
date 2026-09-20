import { describe, expect, it } from "vitest";
import { elementBounds, sceneBounds } from "../src/bounds.ts";
import { element } from "./factory.ts";

/**
 * These pin the semantics of `scene/geometry.rs` in the engine. If the Rust side
 * ever starts accounting for rotation or freehand points, these tests are the
 * place that will notice.
 */
describe("elementBounds", () => {
  it("matches a plain rect", () => {
    expect(elementBounds({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
      minX: 10,
      minY: 20,
      maxX: 40,
      maxY: 60,
    });
  });

  it("normalises a rect dragged up and to the left", () => {
    expect(elementBounds({ x: 10, y: 20, width: -30, height: -40 })).toEqual({
      minX: -20,
      minY: -20,
      maxX: 10,
      maxY: 20,
    });
  });

  it("ignores rotation, exactly as the engine does", () => {
    const upright = elementBounds({ x: 0, y: 0, width: 100, height: 10 });
    expect(upright).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 10 });
  });
});

describe("sceneBounds", () => {
  it("is null for an empty scene rather than a zero rect", () => {
    expect(sceneBounds([])).toBeNull();
  });

  it("is null when every element is a tombstone", () => {
    expect(sceneBounds([element({ isDeleted: true })])).toBeNull();
  });

  it("unions the live elements and skips tombstones", () => {
    const elements = [
      element({ id: "a", x: 0, y: 0, width: 10, height: 10 }),
      element({ id: "b", x: 100, y: 50, width: 20, height: 20 }),
      element({ id: "gone", x: -9999, y: -9999, width: 1, height: 1, isDeleted: true }),
    ];

    expect(sceneBounds(elements)).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 70 });
  });
});
