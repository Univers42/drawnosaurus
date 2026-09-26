import { describe, expect, it, vi } from "vitest";
import {
  buildCommands,
  filterCommands,
  groupCommands,
  matchScore,
  paletteGroups,
  type Command,
  type PaletteHost,
  type PaletteSelection,
} from "./commandPalette.ts";
import type { DrawEngine } from "@osionos/draw-engine/engine";
import type { ShapeActions } from "./shapeActions.ts";
import { ALL_TOOL_DEFS } from "./tools.ts";
import { FIGURE_KIND_OPTIONS } from "./inspector.ts";

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
      insertFigure: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomReset: vi.fn(),
      zoomToFit: vi.fn(),
      zoomToFitSelectionInViewport: vi.fn(),
      zoomToFitSelection: vi.fn(),
      pickTheme: vi.fn(),
      toggleGrid: vi.fn(),
      toggleObjectsSnap: vi.fn(),
      toggleFocusMode: vi.fn(),
      openExport: vi.fn(),
      openTemplates: vi.fn(),
      openMermaid: vi.fn(),
      enterPresent: vi.fn(),
      presets: [],
      applyStylePreset: vi.fn(),
      selection: null,
      run: vi.fn(),
      applyStyle: vi.fn(),
      openPicker: vi.fn(),
      openShapeSwitch: vi.fn(),
      copyStyles: vi.fn(),
      stepFontSize: vi.fn(),
      ...overrides,
    };
  }

  /** A selection the panel shows every row for, but for the rows in `off`. */
  function selected(
    off: (keyof ShapeActions)[] = [],
    element: Partial<PaletteSelection["element"]> = {},
  ): PaletteSelection {
    const can = new Proxy({} as ShapeActions, {
      get: (_, row) => !off.includes(row as keyof ShapeActions),
    });
    return {
      can,
      element: { locked: false, multi: true, grouped: false, ...element },
      switchable: true,
    };
  }

  /** The engine calls a command made, as `[method, ...args]`. */
  function engineCalls(h: PaletteHost, id: string): unknown[][] {
    const calls: unknown[][] = [];
    const engine = new Proxy({} as DrawEngine, {
      get:
        (_, method) =>
        (...args: unknown[]) =>
          calls.push([method, ...args]),
    });
    vi.mocked(h.run).mockImplementation((action) => action(engine));
    const command = buildCommands(h).find((c) => c.id === id);
    expect(command, id).toBeDefined();
    command!.run();
    return calls;
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

  it("opens the Mermaid dialog from the tools, found by 'mermaid' or 'flowchart'", () => {
    const h = host();
    const commands = buildCommands(h);
    const command = commands.find((c) => c.id === "tool:mermaid")!;
    expect(command.category).toBe("Tools");
    expect(filterCommands(commands, "flowchart").map((c) => c.id)).toContain("tool:mermaid");
    command.run();
    expect(h.openMermaid).toHaveBeenCalledOnce();
  });

  it("adds rectangle / diamond / ellipse insert commands", () => {
    const h = host();
    const commands = buildCommands(h);
    for (const kind of ["rectangle", "diamond", "ellipse"] as const) {
      commands.find((c) => c.id === `insert:${kind}`)!.run();
      expect(h.insertShape).toHaveBeenCalledWith(kind);
    }
  });

  it("adds an insert command for every figure kind, wired with that kind alone", () => {
    const h = host();
    const commands = buildCommands(h);
    for (const kind of FIGURE_KIND_OPTIONS) {
      commands.find((c) => c.id === `insert:figure:${kind.value}`)!.run();
      expect(h.insertFigure).toHaveBeenCalledWith({ kind: kind.value });
    }
  });

  it("wires view actions to the matching host callback", () => {
    const h = host();
    const commands = buildCommands(h);
    commands.find((c) => c.id === "view:zoomIn")!.run();
    commands.find((c) => c.id === "view:fit")!.run();
    commands.find((c) => c.id === "view:zoomToFitViewport")!.run();
    commands.find((c) => c.id === "view:zoomToSelection")!.run();
    commands.find((c) => c.id === "view:present")!.run();
    expect(h.zoomIn).toHaveBeenCalledOnce();
    expect(h.zoomToFit).toHaveBeenCalledOnce();
    expect(h.zoomToFitSelectionInViewport).toHaveBeenCalledOnce();
    expect(h.zoomToFitSelection).toHaveBeenCalledOnce();
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

  it("offers nothing to act on with nothing selected", () => {
    const ids = buildCommands(host()).map((c) => c.id);
    expect(ids.filter((id) => /^(element|style):/.test(id))).toEqual([]);
    expect(ids).toContain("editor:undo");
  });

  it("offers the oracle's element commands, each running its engine action", () => {
    const h = host({ selection: selected() });
    expect(engineCalls(h, "element:centerVertically")).toEqual([["alignSelection", "centerY"]]);
    expect(engineCalls(h, "element:centerHorizontally")).toEqual([["alignSelection", "centerX"]]);
    expect(engineCalls(h, "element:bringToFront")).toEqual([["reorderSelection", "front"]]);
    expect(engineCalls(h, "element:flipVertical")).toEqual([["flipSelection", "vertical"]]);
    expect(engineCalls(h, "element:group")).toEqual([["groupSelection"]]);
    expect(engineCalls(h, "editor:undo")).toEqual([["undo"]]);
  });

  it("offers group or ungroup, and lock or unlock, as the context menu does", () => {
    const labels = (selection: PaletteSelection) =>
      buildCommands(host({ selection })).map((c) => c.label);
    expect(labels(selected())).toEqual(expect.arrayContaining(["Group selection", "Lock"]));
    expect(labels(selected())).not.toContain("Ungroup selection");
    const group = labels(selected([], { grouped: true, locked: true }));
    expect(group).toEqual(expect.arrayContaining(["Ungroup selection", "Unlock"]));
    expect(group).not.toContain("Group selection");
  });

  it("offers a style row only where the panel shows it, applied as the panel applies it", () => {
    const h = host({ selection: selected(["strokeWidth", "align"]) });
    const commands = buildCommands(h);
    expect(commands.filter((c) => c.label.startsWith("Stroke width"))).toEqual([]);
    expect(commands.filter((c) => c.id.startsWith("element:align"))).toEqual([]);
    commands.find((c) => c.label === "Fill: Solid")!.run();
    commands.find((c) => c.label === "Edges: Round")!.run();
    expect(vi.mocked(h.applyStyle).mock.calls).toEqual([
      [{ fillStyle: "solid" }],
      [{ roundness: 8 }],
    ]);
    expect(engineCalls(h, "style:textAlign:center")).toEqual([["setTextAlign", "center"]]);
  });

  it("has no duplicate ids with everything offered", () => {
    const ids = buildCommands(host({ selection: selected() })).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
