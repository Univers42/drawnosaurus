/**
 * The command palette's data model — plain and DOM-free, so `DrawCommandPalette.svelte` is
 * only a thin list. Fuzzy search, grouping and the registry itself all live here, unit
 * tested without mounting anything (`CommandPalette.tsx@1118751f:145-146` is the oracle's
 * own palette this one is styled after: fuzzy search, grouped categories, a shortcut beside
 * each entry).
 */

import type { DrawEngine } from "@osionos/draw-engine/engine";
import type { DrawTool, FigureParams, StylePatch } from "@osionos/draw-engine/types";
import { ALL_TOOL_DEFS, hotkeyLabel } from "./tools.ts";
import { shortcutLabel } from "./shortcuts.ts";
import { SHORTCUT_REGISTRY, shortcutFor } from "./shortcutRegistry.ts";
import {
  ARROW_TYPES,
  FIGURE_KIND_OPTIONS,
  roundnessFor,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
} from "./inspector.ts";
import type { MenuElementInfo } from "./menu.ts";
import type { ShapeActions } from "./shapeActions.ts";
import type { ThemePreference } from "./theme.ts";

export interface Command {
  id: string;
  label: string;
  category: string;
  /** Printed beside the label, e.g. `shortcutLabel("CtrlOrCmd+Alt+P")`. */
  shortcut?: string;
  /** Extra text the query may match, invisible in the row. */
  keywords?: readonly string[];
  run: () => void;
}

/**
 * How well `query` matches `text`, or `null` for no match at all. A substring always beats
 * a mere subsequence, and an earlier substring beats a later one — the two properties an
 * incremental filter needs to keep the obvious answer on top without pulling in a fuzzy-
 * matching dependency for what a few lines do.
 */
export function matchScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const t = text.toLowerCase();

  const index = t.indexOf(q);
  if (index !== -1) return 10_000 - index;

  // Subsequence fallback: every character of `q` appears in `t`, in order, not
  // necessarily touching. Consecutive runs score higher than scattered ones.
  let cursor = 0;
  let score = 0;
  let run = 0;
  for (const char of q) {
    const found = t.indexOf(char, cursor);
    if (found === -1) return null;
    run = found === cursor ? run + 1 : 0;
    score += 1 + run;
    cursor = found + 1;
  }
  return score;
}

/** The best score `query` gets across a command's label, category and keywords. */
function bestScore(command: Command, query: string): number | null {
  const haystacks = [command.label, command.category, ...(command.keywords ?? [])];
  let best: number | null = null;
  for (const text of haystacks) {
    const score = matchScore(query, text);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}

/** Every command the query matches, best match first. Everything, in order, for `""`. */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  if (query.trim() === "") return [...commands];
  return commands
    .map((command) => ({ command, score: bestScore(command, query) }))
    .filter((entry): entry is { command: Command; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command);
}

export interface CommandGroup {
  category: string;
  commands: Command[];
}

/** Every command, grouped by category in the order each category was first seen. */
export function groupCommands(commands: readonly Command[]): CommandGroup[] {
  const order: string[] = [];
  const byCategory = new Map<string, Command[]>();
  for (const command of commands) {
    if (!byCategory.has(command.category)) {
      byCategory.set(command.category, []);
      order.push(command.category);
    }
    byCategory.get(command.category)!.push(command);
  }
  return order.map((category) => ({ category, commands: byCategory.get(category)! }));
}

/**
 * What the palette renders: grouped by category with an empty query (browsing), or one
 * ranked group while searching — Excalidraw's own palette collapses categories the same
 * way once there is a query to rank against. `[]`, not a group with nothing in it, when
 * the query matches nothing.
 */
export function paletteGroups(commands: readonly Command[], query: string): CommandGroup[] {
  if (query.trim() === "") return groupCommands(commands);
  const filtered = filterCommands(commands, query);
  return filtered.length === 0 ? [] : [{ category: "Results", commands: filtered }];
}

/** The saved style presets the palette offers, named minimally to stay decoupled from
 *  `stylePresets.ts` — the palette needs only what it prints and what it hands back. */
export interface PresetSummary {
  id: string;
  name: string;
}

/** What is selected, as the panel (`getShapeActions`) and the context menu
 *  (`menuElementFromSelection`) already read it — the palette asks nothing of its own. */
export interface PaletteSelection {
  can: ShapeActions;
  element: Pick<MenuElementInfo, "locked" | "multi" | "grouped">;
  /** Tab's shape switch has something to switch. */
  switchable: boolean;
}

/** Every real host action the palette can run, gathered in one bag so `buildCommands` is a
 *  pure function of it — testable with plain spies, no engine or DOM. */
export interface PaletteHost {
  setTool: (tool: DrawTool) => void;
  insertShape: (kind: "rectangle" | "diamond" | "ellipse") => void;
  insertFigure: (figure: FigureParams) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  zoomToFit: () => void;
  zoomToFitSelectionInViewport: () => void;
  zoomToFitSelection: () => void;
  pickTheme: (mode: ThemePreference) => void;
  toggleGrid: () => void;
  toggleObjectsSnap: () => void;
  toggleFocusMode: () => void;
  toggleZenMode: () => void;
  openExport: () => void;
  openTemplates: () => void;
  openMermaid: () => void;
  enterPresent: () => void;
  openPath: () => void;
  presets: readonly PresetSummary[];
  applyStylePreset: (id: string) => void;
  /** `null` with nothing selected, which leaves the Elements and Style commands out, as
   *  the oracle's predicate does (`CommandPalette.tsx@1118751f:347-356`). */
  selection: PaletteSelection | null;
  /** An engine action, run as the context menu and the panel run theirs. */
  run: (action: (engine: DrawEngine) => void) => void;
  applyStyle: (patch: StylePatch) => void;
  openPicker: (kind: "stroke" | "background") => void;
  openShapeSwitch: () => void;
  copyStyles: () => void;
  stepFontSize: (increase: boolean) => void;
}

type Offer = Omit<Command, "category"> & { when?: boolean };

/** A command's `run` for an engine action. */
function engineRun(host: PaletteHost, action: (engine: DrawEngine) => void): () => void {
  return () => host.run(action);
}

/** `offers` whose `when` holds, in `category`. */
function offered(category: string, offers: Offer[]): Command[] {
  return offers
    .filter((offer) => offer.when !== false)
    .map(({ when: _when, ...command }) => ({ ...command, category }));
}

/**
 * The oracle's Elements commands this app has, in its order and with its labels
 * (`CommandPalette.tsx@1118751f:310-341`, `:452-500`; `en.json`), each offered when the
 * panel or the context menu would offer it.
 */
function elementCommands(host: PaletteHost, { can, element, switchable }: PaletteSelection) {
  return offered("Elements", [
    {
      id: "element:group",
      label: "Group selection",
      shortcut: shortcutFor("editor.group"),
      when: element.multi && !element.grouped,
      run: engineRun(host, (e) => e.groupSelection()),
    },
    {
      id: "element:ungroup",
      label: "Ungroup selection",
      shortcut: shortcutFor("editor.ungroup"),
      when: element.grouped,
      run: engineRun(host, (e) => e.ungroupSelection()),
    },
    {
      id: "element:cut",
      label: "Cut",
      shortcut: shortcutFor("editor.cut"),
      run: engineRun(host, (e) => e.cutSelection()),
    },
    {
      id: "element:copy",
      label: "Copy",
      shortcut: shortcutFor("editor.copy"),
      run: engineRun(host, (e) => e.copySelection()),
    },
    {
      id: "element:delete",
      label: "Delete",
      shortcut: shortcutFor("editor.delete"),
      run: engineRun(host, (e) => e.deleteSelection()),
    },
    {
      id: "element:copyStyles",
      label: "Copy styles",
      shortcut: shortcutFor("editor.copyStyles"),
      run: host.copyStyles,
    },
    {
      id: "element:pasteStyles",
      label: "Paste styles",
      shortcut: shortcutFor("editor.pasteStyles"),
      run: engineRun(host, (e) => e.pasteStyles()),
    },
    ...(
      [
        ["bringToFront", "Bring to front", "front"],
        ["bringForward", "Bring forward", "forward"],
        ["sendBackward", "Send backward", "backward"],
        ["sendToBack", "Send to back", "back"],
      ] as const
    ).map(([id, label, to]) => ({
      id: `element:${id}`,
      label,
      shortcut: shortcutFor(`editor.${id}`),
      when: can.layers,
      run: engineRun(host, (e) => e.reorderSelection(to)),
    })),
    ...(
      [
        ["alignTop", "Align top", "top"],
        ["alignBottom", "Align bottom", "bottom"],
        ["alignLeft", "Align left", "left"],
        ["alignRight", "Align right", "right"],
        ["centerVertically", "Center vertically", "centerY"],
        ["centerHorizontally", "Center horizontally", "centerX"],
      ] as const
    ).map(([id, label, mode]) => ({
      id: `element:${id}`,
      label,
      shortcut: REGISTRY_IDS.has(`editor.${id}`) ? shortcutFor(`editor.${id}`) : undefined,
      when: can.align,
      run: engineRun(host, (e) => e.alignSelection(mode)),
    })),
    {
      id: "element:duplicate",
      label: "Duplicate",
      shortcut: shortcutFor("editor.duplicate"),
      run: engineRun(host, (e) => e.duplicateSelection()),
    },
    {
      id: "element:flipHorizontal",
      label: "Flip horizontal",
      shortcut: shortcutFor("editor.flipHorizontal"),
      when: can.mirror,
      run: engineRun(host, (e) => e.flipSelection("horizontal")),
    },
    {
      id: "element:flipVertical",
      label: "Flip vertical",
      shortcut: shortcutFor("editor.flipVertical"),
      when: can.mirror,
      run: engineRun(host, (e) => e.flipSelection("vertical")),
    },
    {
      id: "element:increaseFontSize",
      label: "Increase font size",
      shortcut: shortcutFor("editor.increaseFontSize"),
      when: can.text,
      run: () => host.stepFontSize(true),
    },
    {
      id: "element:decreaseFontSize",
      label: "Decrease font size",
      shortcut: shortcutFor("editor.decreaseFontSize"),
      when: can.text,
      run: () => host.stepFontSize(false),
    },
    {
      id: "element:shapeSwitch",
      label: "Switch shape",
      shortcut: shortcutFor("tool.shapeSwitch"),
      when: switchable,
      run: host.openShapeSwitch,
    },
    {
      id: "element:changeStroke",
      label: "Change stroke color",
      shortcut: shortcutFor("editor.showStroke"),
      keywords: ["color", "outline"],
      when: can.strokeColor,
      run: () => host.openPicker("stroke"),
    },
    {
      id: "element:changeBackground",
      label: "Change background color",
      shortcut: shortcutFor("editor.showBackground"),
      keywords: ["color", "fill"],
      when: can.backgroundColor,
      run: () => host.openPicker("background"),
    },
    {
      id: "element:lock",
      label: element.locked ? "Unlock" : "Lock",
      shortcut: shortcutFor("editor.toggleLock"),
      run: engineRun(host, (e) => e.toggleLockSelection()),
    },
  ]);
}

/**
 * Every choice of the panel's rows, one command each — beyond the oracle's palette, which
 * leaves them to its panel, because here the panel is out of the keyboard's reach while a
 * shape is selected: Tab is the shape switch's. Named as the oracle names the buttons
 * (`en.json`), offered where the panel shows the row, applied as the panel applies it.
 */
function styleCommands(host: PaletteHost, { can }: PaletteSelection): Command[] {
  const rows: { row: keyof ShapeActions; name: string; picks: [string, StylePatch][] }[] = [
    {
      row: "fill",
      name: "Fill",
      picks: [
        ["Hachure", { fillStyle: "hachure" }],
        ["Cross-hatch", { fillStyle: "cross-hatch" }],
        ["Solid", { fillStyle: "solid" }],
      ],
    },
    {
      row: "strokeWidth",
      name: "Stroke width",
      picks: [
        ["Thin", { strokeWidth: 1 }],
        ["Bold", { strokeWidth: 2 }],
        ["Extra bold", { strokeWidth: 4 }],
      ],
    },
    {
      row: "strokeStyle",
      name: "Stroke style",
      picks: [
        ["Solid", { strokeStyle: "solid" }],
        ["Dashed", { strokeStyle: "dashed" }],
        ["Dotted", { strokeStyle: "dotted" }],
      ],
    },
    {
      row: "sloppiness",
      name: "Sloppiness",
      picks: [
        ["Architect", { roughness: 0 }],
        ["Artist", { roughness: 1 }],
        ["Cartoonist", { roughness: 2 }],
      ],
    },
    {
      row: "roundness",
      name: "Edges",
      picks: [
        ["Sharp", { roundness: roundnessFor("sharp") }],
        ["Round", { roundness: roundnessFor("round") }],
      ],
    },
    {
      row: "text",
      name: "Font size",
      picks: [
        ["Small", { fontSize: 16 }],
        ["Medium", { fontSize: 20 }],
        ["Large", { fontSize: 28 }],
        ["Very large", { fontSize: 36 }],
      ],
    },
  ];
  const commands = rows
    .filter(({ row }) => can[row])
    .flatMap(({ name, picks }) =>
      picks.map(([pick, patch]) => ({
        id: `style:${name}:${pick}`,
        label: `${name}: ${pick}`,
        category: "Style",
        run: () => host.applyStyle(patch),
      })),
    );
  // The rows the panel sets through the engine rather than a style patch.
  return [
    ...commands,
    ...offered(
      "Style",
      TEXT_ALIGNS.map(({ label, value }) => ({
        id: `style:textAlign:${value}`,
        label,
        when: can.textAlign,
        run: engineRun(host, (e) => e.setTextAlign(value)),
      })),
    ),
    ...offered(
      "Style",
      VERTICAL_ALIGNS.map(({ label, value }) => ({
        id: `style:verticalAlign:${value}`,
        label,
        when: can.verticalAlign,
        run: engineRun(host, (e) => e.setVerticalAlign(value)),
      })),
    ),
    ...offered(
      "Style",
      ARROW_TYPES.map(({ label, value }) => ({
        id: `style:arrowType:${value}`,
        label,
        when: can.arrowType,
        run: engineRun(host, (e) => e.setArrowType(value)),
      })),
    ),
  ];
}

const REGISTRY_IDS = new Set(SHORTCUT_REGISTRY.map((entry) => entry.id));

/** `shortcutFor(id)` where the registry has the chord, `fallback` otherwise — a tool such
 *  as the lasso or the shapes picker has no oracle-derived registry entry, so it keeps
 *  printing its own badge (`hotkeyLabel`) instead of throwing. */
function registryShortcut(id: string, fallback: string | undefined): string | undefined {
  return REGISTRY_IDS.has(id) ? shortcutFor(id) : fallback;
}

/**
 * The registry: tools, keyboard-only shape insertion, view/zoom, theme, export, Present and
 * every saved style preset — real actions this chrome already has a callback for, never a
 * hardcoded duplicate of what `DrawSurface.svelte` does.
 */
export function buildCommands(host: PaletteHost): Command[] {
  const commands: Command[] = [];
  if (host.selection) {
    commands.push(...elementCommands(host, host.selection), ...styleCommands(host, host.selection));
  }
  commands.push(
    ...offered("Editor", [
      {
        id: "editor:undo",
        label: "Undo",
        shortcut: shortcutFor("editor.undo"),
        run: engineRun(host, (e) => e.undo()),
      },
      {
        id: "editor:redo",
        label: "Redo",
        shortcut: shortcutFor("editor.redo"),
        run: engineRun(host, (e) => e.redo()),
      },
      {
        id: "editor:selectAll",
        label: "Select all",
        shortcut: shortcutFor("editor.selectAll"),
        run: engineRun(host, (e) => e.selectAll()),
      },
      { id: "editor:unlockAll", label: "Unlock all", run: engineRun(host, (e) => e.unlockAll()) },
    ]),
  );
  commands.push(
    ...ALL_TOOL_DEFS.map((tool) => ({
      id: `tool:${tool.tool}`,
      label: tool.label,
      category: "Tools",
      shortcut: registryShortcut(`tool.${tool.tool}`, hotkeyLabel(tool)),
      keywords: [tool.tool],
      run: () => host.setTool(tool.tool),
    })),
    // The oracle files its dialog with the tools (`CommandPalette.tsx@1118751f:577-590`).
    {
      id: "tool:mermaid",
      label: "Mermaid to diagram…",
      category: "Tools",
      keywords: ["mermaid", "flowchart", "sequence", "import"],
      run: host.openMermaid,
    },
  );

  commands.push(
    {
      id: "insert:rectangle",
      label: "Add rectangle",
      category: "Insert",
      run: () => host.insertShape("rectangle"),
    },
    {
      id: "insert:diamond",
      label: "Add diamond",
      category: "Insert",
      run: () => host.insertShape("diamond"),
    },
    {
      id: "insert:ellipse",
      label: "Add ellipse",
      category: "Insert",
      run: () => host.insertShape("ellipse"),
    },
  );

  for (const kind of FIGURE_KIND_OPTIONS) {
    commands.push({
      id: `insert:figure:${kind.value}`,
      label: `Add ${kind.label.toLowerCase()}`,
      category: "Insert",
      run: () => host.insertFigure({ kind: kind.value }),
    });
  }

  commands.push(
    {
      id: "view:zoomIn",
      label: "Zoom in",
      category: "View",
      shortcut: shortcutFor("view.zoomIn"),
      run: host.zoomIn,
    },
    {
      id: "view:zoomOut",
      label: "Zoom out",
      category: "View",
      shortcut: shortcutFor("view.zoomOut"),
      run: host.zoomOut,
    },
    {
      id: "view:zoomReset",
      label: "Reset zoom",
      category: "View",
      shortcut: shortcutFor("view.zoomReset"),
      run: host.zoomReset,
    },
    {
      id: "view:fit",
      label: "Zoom to fit all elements",
      category: "View",
      shortcut: shortcutFor("view.zoomToFit"),
      run: host.zoomToFit,
    },
    {
      id: "view:zoomToFitViewport",
      label: "Zoom to fit in viewport",
      category: "View",
      shortcut: shortcutFor("view.zoomToFitSelectionInViewport"),
      run: host.zoomToFitSelectionInViewport,
    },
    {
      id: "view:zoomToSelection",
      label: "Zoom to selection",
      category: "View",
      shortcut: shortcutFor("view.zoomToFitSelection"),
      run: host.zoomToFitSelection,
    },
    {
      id: "view:grid",
      label: "Toggle grid",
      category: "View",
      shortcut: shortcutFor("view.grid"),
      run: host.toggleGrid,
    },
    {
      id: "view:snap",
      label: "Toggle snap to objects",
      category: "View",
      shortcut: shortcutFor("view.snap"),
      run: host.toggleObjectsSnap,
    },
    {
      id: "view:focusMode",
      label: "Toggle focus while typing",
      category: "View",
      run: host.toggleFocusMode,
    },
    {
      id: "view:zenMode",
      label: "Toggle zen mode",
      category: "View",
      shortcut: shortcutFor("view.zenMode"),
      run: host.toggleZenMode,
    },
    {
      id: "view:present",
      label: "Present",
      category: "View",
      shortcut: shortcutFor("presentation.enter"),
      run: host.enterPresent,
    },
    {
      id: "view:path",
      label: "Presentation path…",
      category: "View",
      keywords: ["path", "order", "slides", "frames", "prezi", "stops"],
      run: host.openPath,
    },
  );

  commands.push(
    {
      id: "theme:light",
      label: "Theme: Light",
      category: "Theme",
      run: () => host.pickTheme("light"),
    },
    {
      id: "theme:dark",
      label: "Theme: Dark",
      category: "Theme",
      run: () => host.pickTheme("dark"),
    },
    {
      id: "theme:system",
      label: "Theme: Match system",
      category: "Theme",
      run: () => host.pickTheme("system"),
    },
  );

  commands.push(
    {
      id: "file:export",
      label: "Export…",
      category: "File",
      shortcut: shortcutLabel("CtrlOrCmd+Shift+E"),
      run: host.openExport,
    },
    {
      id: "file:templates",
      label: "Templates…",
      category: "File",
      run: host.openTemplates,
    },
  );

  for (const preset of host.presets) {
    commands.push({
      id: `preset:${preset.id}`,
      label: `Style: ${preset.name}`,
      category: "Style presets",
      run: () => host.applyStylePreset(preset.id),
    });
  }

  return commands;
}
