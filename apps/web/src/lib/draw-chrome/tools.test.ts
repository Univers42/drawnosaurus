import { describe, expect, it } from "vitest";
import { toolForKey } from "@osionos/draw-engine/tools";
import { ICONS } from "./icons.ts";
import { ALL_TOOL_DEFS, DRAW_TOOLS, EXTRA_TOOLS, isExtraTool, toolDef } from "./tools.ts";

describe("DRAW_TOOLS", () => {
  it("keeps the bar to the tools reached by reflex", () => {
    // Short on purpose. A bar is a row of identical squares, so every tool added makes
    // every other one harder to find — and past a point the row stops fitting on a
    // laptop, which is how the newest tools ended up off the end and invisible.
    expect(DRAW_TOOLS.map((entry) => entry.tool)).toEqual([
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

  it("puts the occasional tools behind the more-tools button", () => {
    expect(EXTRA_TOOLS.map((entry) => entry.tool)).toEqual([
      "image",
      "frame",
      "embed",
      "autoshape",
      "bucketfill",
      "laser",
      "lasso",
      "sticky",
    ]);
  });

  it("puts every tool in exactly one of the two places", () => {
    // A tool in both appears twice; a tool in neither is unreachable by pointer.
    const bar = DRAW_TOOLS.map((entry) => entry.tool);
    const extra = EXTRA_TOOLS.map((entry) => entry.tool);
    expect(bar.filter((tool) => extra.includes(tool))).toEqual([]);
    expect(new Set(ALL_TOOL_DEFS.map((entry) => entry.tool)).size).toBe(ALL_TOOL_DEFS.length);
  });

  it("knows where a tool lives", () => {
    expect(isExtraTool("laser")).toBe(true);
    expect(isExtraTool("rectangle")).toBe(false);
    // The trigger wears the active extra tool's icon, so it has to be findable.
    expect(toolDef("frame")?.icon).toBe("frame");
    expect(toolDef("rectangle")?.icon).toBe("rectangle");
  });

  it("gives every tool an icon that exists", () => {
    // A missing icon renders as an empty button, which reads as a disabled tool rather
    // than as a mistake — so it is the kind of thing that ships.
    for (const entry of ALL_TOOL_DEFS) {
      expect(ICONS[entry.icon], `${entry.label}`).toBeDefined();
      expect(ICONS[entry.icon].length, `${entry.label} has an empty icon`).toBeGreaterThan(0);
    }
  });

  it("gives every tool a unique hotkey", () => {
    const hotkeys = ALL_TOOL_DEFS.map((entry) => entry.hotkey);
    expect(new Set(hotkeys).size).toBe(hotkeys.length);
  });

  it("gives every toolbar entry a hotkey the engine actually maps", () => {
    // A badge printing a key the engine ignores is worse than no badge. `sticky` is
    // ours rather than the engine's, so it is the one entry without an engine tool.
    // Every tool, wherever it lives. A shortcut printed in the dropdown that the engine
    // ignores is worse than one printed on the bar, because the menu is where someone
    // goes to *learn* the key.
    for (const entry of ALL_TOOL_DEFS) {
      if (entry.tool === "sticky") continue;
      expect(toolForKey(entry.hotkey), `${entry.label} (${entry.hotkey})`).toBe(entry.tool);
    }
  });

  it("leaves the sticky note's hotkey to itself", () => {
    // The sticky note is handled by the host's own keydown listener, and the engine has
    // its own on the canvas. `preventDefault` does not stop the other one, so a key the
    // engine also maps fires *both*: "9" selected the sticky note and opened the image
    // picker in one keystroke. The only safe key for a host tool is one the engine
    // ignores entirely.
    const sticky = toolDef("sticky");
    expect(sticky).toBeDefined();
    expect(toolForKey(sticky!.hotkey)).toBeNull();
  });
});
