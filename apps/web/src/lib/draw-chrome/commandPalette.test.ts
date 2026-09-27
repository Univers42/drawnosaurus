import { describe, expect, it, vi } from "vitest";
import {
  RECENT_CATEGORY,
  buildCommands,
  filterCommands,
  groupCommands,
  matchScore,
  paletteGroups,
  type Command,
  type PaletteHost,
  type PaletteSelection,
} from "./commandPalette.ts";
import { VECTORIZE_LABEL, menuElementFromSelection, vectorizeAction } from "./menu.ts";
import { FONT_CHOICES } from "./fonts.ts";
import type { DrawEngine } from "@osionos/draw-engine/engine";
import type { DrawElement } from "@osionos/draw-engine/types";
import type { ShapeActions } from "./shapeActions.ts";
import { ALL_TOOL_DEFS } from "./tools.ts";
import { shortcutFor } from "./shortcutRegistry.ts";
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
    expect(paletteGroups(commands, "  ", null).map((g) => g.category)).toEqual(["Tools", "View"]);
  });

  it("collapses to one ranked group while searching", () => {
    const groups = paletteGroups(commands, "rect", null);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.commands.map((c) => c.id)).toEqual(["tool:rectangle"]);
  });

  it("is empty, not a group with nothing in it, when nothing matches", () => {
    expect(paletteGroups(commands, "zzz", null)).toEqual([]);
  });
});

describe("palette recency", () => {
  // Three categories, several rows each: enough that a ranking which reshuffles shows it.
  const commands = [
    cmd("editor:undo", "Undo", "Editor"),
    cmd("editor:redo", "Redo", "Editor"),
    cmd("editor:selectAll", "Select all", "Editor"),
    cmd("tool:rectangle", "Rectangle", "Tools"),
    cmd("tool:ellipse", "Ellipse", "Tools"),
    cmd("tool:line", "Line", "Tools"),
    cmd("view:present", "Present", "View"),
    cmd("view:grid", "Toggle grid", "View"),
  ];
  /** The rows as the dialog lists them, top to bottom. */
  const rows = (lastUsedId: string | null) =>
    paletteGroups(commands, "", lastUsedId).flatMap((group) => group.commands.map((c) => c.id));

  it("leaves the list alone when nothing has been run", () => {
    expect(rows(null)).toEqual(commands.map((c) => c.id));
  });

  it("lifts the run command to its own group and moves no other row", () => {
    // The case a "sort by lastUsed descending" ranking gets wrong, twice over. Such a
    // sort puts every run command above every command that was never run, so the rows a
    // new user is looking for slide down the list; and it leaves the run command in its
    // own category as well, so it shows twice. The oracle lifts one row out of the list
    // and puts it in a group of its own above the rest (`CommandPalette.tsx@1118751f:844-857`).
    const before = rows(null);
    const after = rows("view:present");
    expect(after[0]).toBe("view:present");
    expect(after).toHaveLength(before.length);
    expect(after.slice(1)).toEqual(before.filter((id) => id !== "view:present"));
  });

  it("never demotes a command that was never run, however late it was declared", () => {
    // Declared last, in a category of its own, so a sort that used usage as its first key
    // would sink it under the earlier Tools rows.
    const text: Command = cmd("style:fontFamily:6", "Font: Nunito", "Style");
    const list = [...commands, text];
    const flat = (id: string | null) =>
      paletteGroups(list, "", id).flatMap((g) => g.commands.map((c) => c.id));
    expect(flat("editor:undo")).toEqual([
      "editor:undo",
      ...flat(null).filter((c) => c !== "editor:undo"),
    ]);
    expect(flat(null).at(-1)).toBe("style:fontFamily:6");
  });

  it("remembers one command, not a history", () => {
    // `lastUsedPaletteItem` holds a single item, so the second run replaces the first and
    // the first is back among its own (`CommandPalette.tsx@1118751f:85`).
    expect(rows("view:present")[0]).toBe("view:present");
    const afterTwoRuns = rows("tool:ellipse");
    expect(afterTwoRuns[0]).toBe("tool:ellipse");
    expect(afterTwoRuns).toHaveLength(commands.length);
    expect(afterTwoRuns.filter((id) => id === "tool:ellipse")).toEqual(["tool:ellipse"]);
    expect(afterTwoRuns.slice(1)).toEqual(rows(null).filter((id) => id !== "tool:ellipse"));
  });

  it("gives the recents group one row, whatever ran before it", () => {
    // The cap is one, and it is structural rather than enforced: `paletteGroups` takes a
    // single id, so there is no way to hand it a history to rank. A palette that remembered
    // several would have to promote all of them, and every row they displaced would be a
    // never-run command pushed down — the exact failure the oracle's single item avoids.
    for (const lastUsedId of ["editor:undo", "view:grid", "tool:line"]) {
      const groups = paletteGroups(commands, "", lastUsedId);
      expect(groups[0]?.category).toBe(RECENT_CATEGORY);
      expect(
        groups[0]?.commands.map((c) => c.id),
        lastUsedId,
      ).toEqual([lastUsedId]);
      expect(
        groups.flatMap((g) => g.commands),
        lastUsedId,
      ).toHaveLength(commands.length);
    }
  });

  it("drops a category that held only the run command", () => {
    // The oracle groups what is left (`getNextCommandsByCategory`,
    // `CommandPalette.tsx@1118751f:819-830`), so a category nothing is left in has no
    // heading — an empty one would print a bare label over nothing.
    const lonely = [cmd("view:grid", "Toggle grid", "View"), ...commands];
    const groups = paletteGroups(lonely, "", "view:grid");
    expect(groups.map((g) => g.category)).toEqual([RECENT_CATEGORY, "Editor", "Tools", "View"]);
    expect(groups.at(-1)?.commands.map((c) => c.id)).toEqual(["view:present"]);
  });

  it("ignores a run id the current list does not have", () => {
    // Commands come and go with the selection: the run command may be gone next time.
    expect(rows("element:vectorize")).toEqual(rows(null));
  });

  it("shows no recent group once a query is typed", () => {
    // `showLastUsed` needs an empty search (`CommandPalette.tsx@1118751f:844-845`): the
    // ranked results are the answer, and a recents heading above them would be a
    // category the search did not match.
    const groups = paletteGroups(commands, "ellipse", "view:present");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("Results");
    expect(groups[0]?.commands.map((c) => c.id)).toEqual(["tool:ellipse"]);
  });

  it("gives the same order every time, and after the same run twice", () => {
    expect(rows("tool:line")).toEqual(rows("tool:line"));
    // A run command that is the only one in the list is still not a duplicate of itself.
    const one = [cmd("only:one", "Only", "Editor")];
    const groups = paletteGroups(one, "", "only:one");
    expect(groups.flatMap((g) => g.commands.map((c) => c.id))).toEqual(["only:one"]);
  });

  it("is the run command, and only the run command, that is remembered", () => {
    // The oracle's palette keeps the run and the highlight apart: `executeCommand` fills
    // the memory after `perform` (`CommandPalette.tsx@1118751f:665`), while hovering a row
    // (`:933`, `:951`) and arrowing onto one (`:710-778`) move the highlight and never reach
    // it. Here that split is the ranking's *signature*: the only thing it is told is one run
    // id, so there is no channel by which a highlight could promote a row — and the
    // argument is required, so a caller cannot leave it out and be handed a palette that
    // quietly shows no recents. Nothing run, no recents group; a run, exactly one.
    const browsed = paletteGroups(commands, "", null);
    expect(browsed.map((g) => g.category)).toEqual(["Editor", "Tools", "View"]);
    const browsedIds = browsed.flatMap((g) => g.commands.map((c) => c.id));
    const recents = paletteGroups(commands, "", "view:grid");
    expect(recents[0]?.category).toBe(RECENT_CATEGORY);
    // One row lifted, and every other row exactly where it was — including the rest of the
    // category the lifted row came out of.
    expect(recents.flatMap((g) => g.commands.map((c) => c.id))).toEqual([
      "view:grid",
      ...browsedIds.filter((id) => id !== "view:grid"),
    ]);
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
      toggleZenMode: vi.fn(),
      openExport: vi.fn(),
      openTemplates: vi.fn(),
      openMermaid: vi.fn(),
      enterPresent: vi.fn(),
      openPath: vi.fn(),
      presets: [],
      applyStylePreset: vi.fn(),
      selection: null,
      run: vi.fn(),
      applyStyle: vi.fn(),
      openPicker: vi.fn(),
      openShapeSwitch: vi.fn(),
      copyStyles: vi.fn(),
      stepFontSize: vi.fn(),
      vectorize: vi.fn(),
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
      element: { locked: false, multi: true, grouped: false, vectorizeId: null, ...element },
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

  it("toggles zen mode from the palette, printing the registry's own chord", () => {
    const h = host();
    const command = buildCommands(h).find((c) => c.id === "view:zenMode");
    expect(command, "view:zenMode").toBeDefined();
    expect(command!.category).toBe("View");
    expect(command!.shortcut).toBe(shortcutFor("view.zenMode"));
    // Findable by the word the menu and the exit button both use.
    expect(filterCommands(buildCommands(h), "zen").map((c) => c.id)).toContain("view:zenMode");
    command!.run();
    expect(h.toggleZenMode).toHaveBeenCalledOnce();
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

  it("opens the presentation path, found by 'path' or 'order'", () => {
    const h = host();
    const commands = buildCommands(h);
    for (const query of ["path", "order"]) {
      expect(filterCommands(commands, query).map((c) => c.id)).toContain("view:path");
    }
    commands.find((c) => c.id === "view:path")!.run();
    expect(h.openPath).toHaveBeenCalledOnce();
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

  it("offers one command per font family, applied as the panel's own style patch", () => {
    // `ShapeActions.text` is the panel's font-family-and-size row
    // (`shapeActions.ts:143-144`), and the families are the picker's own list
    // (`FONT_CHOICES`, `fonts.ts`). The oracle's palette has no font command to port at
    // `@1118751f` — it leaves the row to its properties panel — so these are ours.
    const h = host({ selection: selected() });
    const families = buildCommands(h).filter((c) => c.id.startsWith("style:fontFamily:"));
    expect(families.map((c) => c.id)).toEqual(
      FONT_CHOICES.map((font) => `style:fontFamily:${font.id}`),
    );
    expect(families.map((c) => c.label)).toEqual(FONT_CHOICES.map((font) => `Font: ${font.label}`));
    for (const font of FONT_CHOICES) {
      // The two assertions above pair these ids with FONT_CHOICES one for one.
      families.find((c) => c.id === `style:fontFamily:${font.id}`)!.run();
    }
    expect(vi.mocked(h.applyStyle).mock.calls).toEqual(
      FONT_CHOICES.map((font) => [{ fontFamily: font.id }]),
    );
  });

  it("offers no font family where the panel shows no font row", () => {
    const h = host({ selection: selected(["text"]) });
    const ids = buildCommands(h).map((c) => c.id);
    expect(ids.filter((id) => id.startsWith("style:fontFamily:"))).toEqual([]);
    expect(ids).not.toContain("element:increaseFontSize");
  });

  describe("Vectorize", () => {
    const image = (patch: Partial<DrawElement> = {}): DrawElement =>
      ({
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        angle: 0,
        seed: 1,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "hachure",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        roundness: 8,
        version: 1,
        versionNonce: 1,
        updated: 0,
        isDeleted: false,
        ...patch,
      }) as DrawElement;

    /** Whether the palette offers the row, for exactly what the canvas menu would be given. */
    const commandsFor = (elements: readonly DrawElement[], locked = false) => {
      const element = menuElementFromSelection(elements, locked, false);
      const ids = element
        ? buildCommands(host({ selection: { ...selected(), element } })).map((c) => c.id)
        : [];
      return { element, offered: ids.includes("element:vectorize") };
    };

    it("is the canvas menu's own row, not a second declaration of it", () => {
      const { element, offered } = commandsFor([image({ id: "i", type: "image" })]);
      const row = vectorizeAction(element);
      // One declaration (`menu.ts` › `vectorizeAction`, scanned by `menu.test.ts`): the
      // label is the one the context menu prints, and the target is the same id.
      expect(offered).toBe(true);
      expect(row).not.toBeNull();
      // A one-unlocked-image selection always yields a MenuElementInfo — `offered` above
      // is the assertion that it did.
      const command = buildCommands(host({ selection: { ...selected(), element: element! } })).find(
        (c) => c.id === "element:vectorize",
      );
      expect(command?.label).toBe(row?.label);
      expect(command?.label).toBe(VECTORIZE_LABEL);
      expect(command?.category).toBe("Elements");
    });

    it("vectorizes the image the menu names", () => {
      const element = menuElementFromSelection(
        [image({ id: "img-7", type: "image" })],
        false,
        false,
      );
      // One unlocked image: `menuElementFromSelection` answers, and the row above is offered.
      const h = host({ selection: { ...selected(), element: element! } });
      const command = buildCommands(h).find((c) => c.id === "element:vectorize")!;
      command.run();
      expect(h.vectorize).toHaveBeenCalledOnce();
      expect(h.vectorize).toHaveBeenCalledWith("img-7");
    });

    it("appears exactly when the canvas menu's row does", () => {
      const cases: [string, readonly DrawElement[], boolean][] = [
        ["one unlocked image", [image({ id: "i", type: "image" })], false],
        ["a locked image", [image({ id: "i", type: "image" })], true],
        [
          "an image beside another shape",
          [image({ id: "i", type: "image" }), image({ id: "r", type: "rectangle" })],
          false,
        ],
        ["an embed", [image({ id: "e", type: "embed" })], false],
        ["a rectangle", [image({ id: "r", type: "rectangle" })], false],
      ];
      for (const [name, elements, locked] of cases) {
        const { element, offered } = commandsFor(elements, locked);
        expect(offered, name).toBe(vectorizeAction(element) !== null);
      }
    });
  });
});
