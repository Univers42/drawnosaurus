import { describe, expect, it } from "vitest";
import { toolForKey } from "@osionos/draw-engine/tools";
import { ICONS } from "./icons.ts";
import { DRAW_TOOLS } from "./tools.ts";

describe("DRAW_TOOLS", () => {
  it("covers every engine tool exactly once", () => {
    const tools = DRAW_TOOLS.map((entry) => entry.tool);
    expect(tools).toEqual([
      "select",
      "lasso",
      "hand",
      "rectangle",
      "diamond",
      "ellipse",
      "arrow",
      "line",
      "freedraw",
      "text",
      "sticky",
      "eraser",
      "laser",
      "frame",
    ]);
  });

  it("gives every tool an icon that exists", () => {
    // A missing icon renders as an empty button, which reads as a disabled tool rather
    // than as a mistake — so it is the kind of thing that ships.
    for (const entry of DRAW_TOOLS) {
      expect(ICONS[entry.icon], `${entry.label}`).toBeDefined();
      expect(ICONS[entry.icon].length, `${entry.label} has an empty icon`).toBeGreaterThan(0);
    }
  });

  it("gives every tool a unique hotkey", () => {
    const hotkeys = DRAW_TOOLS.map((entry) => entry.hotkey);
    expect(new Set(hotkeys).size).toBe(hotkeys.length);
  });

  it("gives every toolbar entry a hotkey the engine actually maps", () => {
    // A badge printing a key the engine ignores is worse than no badge. `sticky` is
    // ours rather than the engine's, so it is the one entry without an engine tool.
    for (const entry of DRAW_TOOLS) {
      if (entry.tool === "sticky") continue;
      expect(toolForKey(entry.hotkey), `${entry.label} (${entry.hotkey})`).toBe(entry.tool);
    }
  });
});
