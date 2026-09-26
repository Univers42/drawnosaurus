import { describe, expect, it } from "vitest";
import { measureViewportOffsets, viewportOffsets } from "./viewportOffsets.ts";

// A 1000×600 canvas placed 50px down the page, under a header.
const canvas = { top: 50, right: 1000, bottom: 650, left: 0, width: 1000, height: 600 };

function box(left: number, top: number, width: number, height: number) {
  return { top, right: left + width, bottom: top + height, left, width };
}

describe("viewportOffsets", () => {
  it("is nothing without any surface over the canvas", () => {
    expect(viewportOffsets(canvas, [])).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("takes a top surface's bottom edge, measured from the canvas's own top", () => {
    const toolbar = { dock: "top", rect: box(300, 62, 400, 48) };
    expect(viewportOffsets(canvas, [toolbar]).top).toBe(62 + 48 - 50);
  });

  it("takes a bottom surface's height up from the canvas's bottom", () => {
    const bar = { dock: "bottom", rect: box(0, 600, 1000, 50) };
    expect(viewportOffsets(canvas, [bar]).bottom).toBe(50);
  });

  it("puts a side surface on whichever side its centre is nearer", () => {
    const leftPanel = { dock: "side", rect: box(12, 120, 220, 300) };
    const rightPanel = { dock: "side", rect: box(760, 120, 228, 300) };
    expect(viewportOffsets(canvas, [leftPanel, rightPanel])).toEqual({
      top: 0,
      right: 1000 - 760,
      bottom: 0,
      left: 12 + 220,
    });
  });

  it("keeps the furthest reach per side and ignores surfaces that do not opt in", () => {
    const surfaces = [
      { dock: "top", rect: box(0, 50, 100, 20) },
      { dock: "top", rect: box(400, 50, 100, 70) },
      { dock: undefined, rect: box(0, 50, 1000, 600) },
    ];
    expect(viewportOffsets(canvas, surfaces)).toEqual({ top: 70, right: 0, bottom: 0, left: 0 });
  });

  it("never goes negative for a surface that is not laid out", () => {
    const hidden = { dock: "side", rect: box(0, 0, 0, 0) };
    expect(viewportOffsets(canvas, [hidden])).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("measureViewportOffsets", () => {
  it("reads every `[data-viewport-ui]` surface under the root", () => {
    const node = (dock: string, rect: ReturnType<typeof box>) => ({
      dataset: { viewportUi: dock },
      getBoundingClientRect: () => rect,
    });
    const root = {
      querySelectorAll: (selector: string) => {
        expect(selector).toBe("[data-viewport-ui]");
        return [node("top", box(300, 62, 400, 48)), node("side", box(12, 120, 220, 300))];
      },
    } as unknown as ParentNode;
    const host = { getBoundingClientRect: () => canvas } as unknown as Element;
    expect(measureViewportOffsets(root, host)).toEqual({ top: 60, right: 0, bottom: 0, left: 232 });
  });
});
