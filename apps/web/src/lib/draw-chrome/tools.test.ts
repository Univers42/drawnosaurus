import { describe, expect, it } from "vitest";
import { DRAW_TOOLS } from "./tools.ts";

describe("DRAW_TOOLS", () => {
  it("covers every engine tool exactly once", () => {
    const tools = DRAW_TOOLS.map((entry) => entry.tool);
    expect(tools).toEqual([
      "select",
      "hand",
      "rectangle",
      "diamond",
      "ellipse",
      "arrow",
      "line",
      "freedraw",
      "text",
      "eraser",
    ]);
  });

  it("gives every tool a unique hotkey", () => {
    const hotkeys = DRAW_TOOLS.map((entry) => entry.hotkey);
    expect(new Set(hotkeys).size).toBe(hotkeys.length);
  });
});
