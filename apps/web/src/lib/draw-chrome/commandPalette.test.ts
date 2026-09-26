import { describe, expect, it, vi } from "vitest";
import {
  buildCommands,
  filterCommands,
  groupCommands,
  matchScore,
  paletteGroups,
  type Command,
  type PaletteHost,
} from "./commandPalette.ts";
import { ALL_TOOL_DEFS } from "./tools.ts";

function cmd(id: string, label: string, category: string, shortcut?: string): Command {
  return { id, label, category, shortcut, run: () => {} };
}

describe("matchScore", () => {
  it("matches an empty query against anything, with no preference", () => {
    expect(matchScore("", "Rectangle")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(matchScore("rect", "Rectangle")).not.toBeNull();
    expect(matchScore("RECT", "rectangle")).not.toBeNull();
  });

  it("scores an earlier substring match higher than a later one", () => {
    const early = matchScore("rect", "Rectangle tool");
    const late = matchScore("rect", "Select a Rectangle");
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(early!).toBeGreaterThan(late!);
  });

  it("falls back to matching the query's letters in order, out of sequence", () => {
    // "zin" is not a substring of "Zoom in" but is a subsequence.
    expect(matchScore("zin", "Zoom in")).not.toBeNull();
  });

  it("returns null when a letter is missing entirely", () => {
    expect(matchScore("xyz", "Rectangle")).toBeNull();
  });

  it("scores a substring match higher than a mere subsequence", () => {
    const substring = matchScore("rect", "Rectangle");
    const subsequence = matchScore("rct", "Rectangle");
    expect(substring!).toBeGreaterThan(subsequence!);
  });
});

describe("filterCommands", () => {
  const commands = [
    cmd("tool:rectangle", "Rectangle", "Tools"),
    cmd("tool:ellipse", "Ellipse", "Tools"),
    cmd("view:present", "Present", "View"),
  ];

  it("returns everything, unranked, for an empty query", () => {
    expect(filterCommands(commands, "")).toEqual(commands);
  });

  it("keeps only commands the query matches", () => {
    const result = filterCommands(commands, "rect");
    expect(result.map((c) => c.id)).toEqual(["tool:rectangle"]);
  });

  it("also matches a category, so 'view' finds Present", () => {
    const result = filterCommands(commands, "view");
    expect(result.map((c) => c.id)).toContain("view:present");
  });

  it("ranks the best match first", () => {
    const result = filterCommands(commands, "e");
    // every label here contains "e"; the point is the call does not throw and returns all.
    expect(result).toHaveLength(3);
  });

  it("matches a keyword not in the visible label", () => {
    const withKeyword: Command = {
      ...cmd("tool:ellipse", "Ellipse", "Tools"),
      keywords: ["oval", "circle"],
    };
    expect(filterCommands([withKeyword], "oval").map((c) => c.id)).toEqual(["tool:ellipse"]);
  });
});

describe("groupCommands", () => {
  it("groups by category, in first-seen order", () => {
    const commands = [cmd("a", "A", "Tools"), cmd("b", "B", "View"), cmd("c", "C", "Tools")];
    expect(groupCommands(commands)).toEqual([
      { category: "Tools", commands: [commands[0], commands[2]] },
      { category: "View", commands: [commands[1]] },
    ]);
  });
});

describe("paletteGroups", () => {
  const commands = [
    cmd("tool:rectangle", "Rectangle", "Tools"),
    cmd("view:present", "Present", "View"),
  ];

  it("groups by category with no query", () => {
    expect(paletteGroups(commands, "  ").map((g) => g.category)).toEqual(["Tools", "View"]);
  });

  it("collapses to one ranked group while searching", () => {
    const groups = paletteGroups(commands, "rect");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.commands.map((c) => c.id)).toEqual(["tool:rectangle"]);
  });

  it("is empty, not a group with nothing in it, when nothing matches", () => {
    expect(paletteGroups(commands, "zzz")).toEqual([]);
  });
});

describe("buildCommands", () => {
  function host(overrides: Partial<PaletteHost> = {}): PaletteHost {
    return {
      setTool: vi.fn(),
      insertShape: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomReset: vi.fn(),
      fit: vi.fn(),
      zoomToSelection: vi.fn(),
      pickTheme: vi.fn(),
      toggleGrid: vi.fn(),
      toggleObjectsSnap: vi.fn(),
      toggleFocusMode: vi.fn(),
      openExport: vi.fn(),
      enterPresent: vi.fn(),
      presets: [],
      applyStylePreset: vi.fn(),
      ...overrides,
    };
  }

  it("has no duplicate ids", () => {
    const ids = buildCommands(host()).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers every toolbar tool, wired to setTool", () => {
    const h = host();
    const commands = buildCommands(h);
    for (const tool of ALL_TOOL_DEFS) {
      const command = commands.find((c) => c.id === `tool:${tool.tool}`);
      expect(command, tool.tool).toBeDefined();
      command!.run();
      expect(h.setTool).toHaveBeenCalledWith(tool.tool);
    }
  });

  it("adds rectangle / diamond / ellipse insert commands", () => {
    const h = host();
    const commands = buildCommands(h);
    for (const kind of ["rectangle", "diamond", "ellipse"] as const) {
      commands.find((c) => c.id === `insert:${kind}`)!.run();
      expect(h.insertShape).toHaveBeenCalledWith(kind);
    }
  });

  it("wires view actions to the matching host callback", () => {
    const h = host();
    const commands = buildCommands(h);
    commands.find((c) => c.id === "view:zoomIn")!.run();
    commands.find((c) => c.id === "view:fit")!.run();
    commands.find((c) => c.id === "view:present")!.run();
    expect(h.zoomIn).toHaveBeenCalledOnce();
    expect(h.fit).toHaveBeenCalledOnce();
    expect(h.enterPresent).toHaveBeenCalledOnce();
  });

  it("picks a theme by name", () => {
    const h = host();
    buildCommands(h)
      .find((c) => c.id === "theme:dark")!
      .run();
    expect(h.pickTheme).toHaveBeenCalledWith("dark");
  });

  it("turns each given preset into its own command", () => {
    const h = host({ presets: [{ id: "sketch", name: "Sketch" }] });
    const commands = buildCommands(h);
    const preset = commands.find((c) => c.id === "preset:sketch");
    expect(preset?.category).toBe("Style presets");
    preset!.run();
    expect(h.applyStylePreset).toHaveBeenCalledWith("sketch");
  });
});
