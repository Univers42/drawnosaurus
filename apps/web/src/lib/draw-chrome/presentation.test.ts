import { describe, expect, it } from "vitest";
import {
  PRESENT_MARGIN,
  presentingNotice,
  presentKeyAction,
  slideCounterText,
  slidesFromScene,
  stepSlideIndex,
  type SlideElement,
} from "./presentation.ts";

const frame = (id: string, x: number, y: number, w: number, h: number): SlideElement => ({
  id,
  type: "frame",
  isDeleted: false,
  x,
  y,
  width: w,
  height: h,
});

const rect = (id: string, x: number, y: number, w: number, h: number): SlideElement => ({
  id,
  type: "rectangle",
  isDeleted: false,
  x,
  y,
  width: w,
  height: h,
});

describe("slidesFromScene", () => {
  it("is the board's frames, bottom to top, each one slide", () => {
    const elements = [frame("f1", 0, 0, 100, 100), frame("f2", 200, 0, 100, 100)];
    expect(slidesFromScene(elements)).toEqual([
      { frameId: "f1", bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
      { frameId: "f2", bounds: { minX: 200, minY: 0, maxX: 300, maxY: 100 } },
    ]);
  });

  it("skips a deleted frame", () => {
    const deleted = { ...frame("gone", 0, 0, 10, 10), isDeleted: true };
    const elements = [deleted, frame("f1", 0, 0, 100, 100)];
    expect(slidesFromScene(elements)).toEqual([
      { frameId: "f1", bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
    ]);
  });

  it("with no frames, the whole board is one slide fit to its content", () => {
    const elements = [rect("a", 10, 10, 50, 50), rect("b", 100, 100, 20, 20)];
    expect(slidesFromScene(elements)).toEqual([
      { frameId: null, bounds: { minX: 10, minY: 10, maxX: 120, maxY: 120 } },
    ]);
  });

  it("an empty board is one slide with nothing to fit", () => {
    expect(slidesFromScene([])).toEqual([{ frameId: null, bounds: null }]);
  });
});

describe("stepSlideIndex", () => {
  it("next stops at the last slide", () => {
    expect(stepSlideIndex("next", 1, 3)).toBe(2);
    expect(stepSlideIndex("next", 2, 3)).toBe(2);
  });

  it("prev stops at the first slide", () => {
    expect(stepSlideIndex("prev", 1, 3)).toBe(0);
    expect(stepSlideIndex("prev", 0, 3)).toBe(0);
  });

  it("home and end jump to the ends", () => {
    expect(stepSlideIndex("home", 2, 5)).toBe(0);
    expect(stepSlideIndex("end", 0, 5)).toBe(4);
  });

  it("a single slide never moves", () => {
    expect(stepSlideIndex("next", 0, 1)).toBe(0);
    expect(stepSlideIndex("prev", 0, 1)).toBe(0);
  });
});

describe("presentKeyAction", () => {
  it("advances on the next keys", () => {
    for (const key of ["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"]) {
      expect(presentKeyAction(key), key).toBe("next");
    }
  });

  it("goes back on the previous keys", () => {
    for (const key of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]) {
      expect(presentKeyAction(key), key).toBe("prev");
    }
  });

  it("Home and End jump, Escape exits", () => {
    expect(presentKeyAction("Home")).toBe("home");
    expect(presentKeyAction("End")).toBe("end");
    expect(presentKeyAction("Escape")).toBe("exit");
  });

  it("a key that means nothing here is null", () => {
    expect(presentKeyAction("a")).toBeNull();
    expect(presentKeyAction("Tab")).toBeNull();
  });
});

describe("slideCounterText", () => {
  it("is 1-based, 'index / count'", () => {
    expect(slideCounterText(2, 7)).toBe("3 / 7");
    expect(slideCounterText(0, 1)).toBe("1 / 1");
  });
});

describe("presentingNotice", () => {
  it("names who is presenting", () => {
    expect(presentingNotice("Ana")).toBe("Ana is presenting — Follow");
  });

  it("falls back for a peer with no name", () => {
    expect(presentingNotice(undefined)).toBe("Someone is presenting — Follow");
  });
});

describe("PRESENT_MARGIN", () => {
  it("is a small, positive margin", () => {
    expect(PRESENT_MARGIN).toBeGreaterThan(0);
    expect(PRESENT_MARGIN).toBeLessThan(96);
  });
});
