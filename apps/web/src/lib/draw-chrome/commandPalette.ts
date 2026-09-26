/**
 * The command palette's data model — plain and DOM-free, so `DrawCommandPalette.svelte` is
 * only a thin list. Fuzzy search, grouping and the registry itself all live here, unit
 * tested without mounting anything (`CommandPalette.tsx@1118751f:145-146` is the oracle's
 * own palette this one is styled after: fuzzy search, grouped categories, a shortcut beside
 * each entry).
 */

import type { DrawTool, FigureParams } from "@osionos/draw-engine/types";
import { ALL_TOOL_DEFS, hotkeyLabel } from "./tools.ts";
import { shortcutLabel } from "./shortcuts.ts";
import { FIGURE_KIND_OPTIONS } from "./inspector.ts";
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

/** Every real host action the palette can run, gathered in one bag so `buildCommands` is a
 *  pure function of it — testable with plain spies, no engine or DOM. */
export interface PaletteHost {
  setTool: (tool: DrawTool) => void;
  insertShape: (kind: "rectangle" | "diamond" | "ellipse") => void;
  insertFigure: (figure: FigureParams) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  fit: () => void;
  zoomToSelection: () => void;
  pickTheme: (mode: ThemePreference) => void;
  toggleGrid: () => void;
  toggleObjectsSnap: () => void;
  toggleFocusMode: () => void;
  openExport: () => void;
  enterPresent: () => void;
  presets: readonly PresetSummary[];
  applyStylePreset: (id: string) => void;
}

/**
 * The registry: tools, keyboard-only shape insertion, view/zoom, theme, export, Present and
 * every saved style preset — real actions this chrome already has a callback for, never a
 * hardcoded duplicate of what `DrawSurface.svelte` does.
 */
export function buildCommands(host: PaletteHost): Command[] {
  const commands: Command[] = ALL_TOOL_DEFS.map((tool) => ({
    id: `tool:${tool.tool}`,
    label: tool.label,
    category: "Tools",
    shortcut: hotkeyLabel(tool),
    keywords: [tool.tool],
    run: () => host.setTool(tool.tool),
  }));

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
      shortcut: shortcutLabel("CtrlOrCmd+="),
      run: host.zoomIn,
    },
    {
      id: "view:zoomOut",
      label: "Zoom out",
      category: "View",
      shortcut: shortcutLabel("CtrlOrCmd+-"),
      run: host.zoomOut,
    },
    {
      id: "view:zoomReset",
      label: "Reset zoom",
      category: "View",
      shortcut: shortcutLabel("CtrlOrCmd+0"),
      run: host.zoomReset,
    },
    {
      id: "view:fit",
      label: "Zoom to fit",
      category: "View",
      shortcut: shortcutLabel("Shift+1"),
      run: host.fit,
    },
    {
      id: "view:zoomToSelection",
      label: "Zoom to selection",
      category: "View",
      shortcut: shortcutLabel("Shift+2"),
      run: host.zoomToSelection,
    },
    {
      id: "view:grid",
      label: "Toggle grid",
      category: "View",
      shortcut: shortcutLabel("CtrlOrCmd+'"),
      run: host.toggleGrid,
    },
    {
      id: "view:snap",
      label: "Toggle snap to objects",
      category: "View",
      shortcut: shortcutLabel("Alt+S"),
      run: host.toggleObjectsSnap,
    },
    {
      id: "view:focusMode",
      label: "Toggle focus while typing",
      category: "View",
      run: host.toggleFocusMode,
    },
    {
      id: "view:present",
      label: "Present",
      category: "View",
      shortcut: shortcutLabel("CtrlOrCmd+Alt+P"),
      run: host.enterPresent,
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

  commands.push({
    id: "file:export",
    label: "Export…",
    category: "File",
    shortcut: shortcutLabel("CtrlOrCmd+Shift+E"),
    run: host.openExport,
  });

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
