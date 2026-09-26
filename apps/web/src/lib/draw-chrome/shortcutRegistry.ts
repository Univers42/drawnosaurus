/**
 * The one list of keyboard shortcuts this app advertises. `DrawShortcutsDialog.svelte`
 * renders every entry, grouped by section; `commandPalette.ts` prints the same label for
 * any command whose shortcut lives here. One list, so the two cannot drift the way the
 * dialog's old hand-written copy did (hard-coded ⌘ off a Mac, no Shift+2/3, no Tab note).
 *
 * Sections and labels for "Tools" / "View" / "Editor" follow the oracle's own help dialog
 * (`HelpDialog.tsx@1118751f`, labels from `packages/excalidraw/locales/en.json`) for every
 * chord this app actually has. "Presentation" and "Flowchart" are ours: features or chords
 * the oracle does not have, kept out of the oracle-derived sections so the two are never
 * mixed under one label.
 *
 * `shortcutRegistry.test.ts` is the proof that every chord below is real: each one is run
 * through the real handler that owns it (the engine's key dispatch, or the chrome's own
 * `styleShortcut` / `presentKeyAction` / `appShortcut`) and asserted to do what the label
 * says.
 */

import type { DrawTool } from "@osionos/draw-engine/types";
import { toolDef } from "./tools.ts";
import { IS_MAC, shortcutLabel } from "./shortcuts.ts";

export type ShortcutSection = "Tools" | "View" | "Editor" | "Presentation" | "Flowchart";

export interface ShortcutEntry {
  id: string;
  section: ShortcutSection;
  label: string;
  /** Chord syntax from `shortcuts.ts`'s `shortcutLabel` (`"CtrlOrCmd+Shift+Z"`), or a bare
   *  key (`"Enter"`, `"ArrowUp"`) for one that takes no modifier. Every chord a person can
   *  press to do the same thing — not just the one this app's own UI happens to print. */
  chords: string[];
}

/** A tool's own chord, from `tools.ts` — the toolbar's single source for what key each
 *  tool answers to, so this registry never re-types a hotkey `tools.ts` could drift from. */
function toolChord(tool: DrawTool): string {
  const def = toolDef(tool);
  if (!def) throw new Error(`shortcutRegistry: no ToolDef for "${tool}"`);
  return def.shift ? `Shift+${def.hotkey}` : def.hotkey;
}

/**
 * Oracle tools this app also has, `toolBar.*` labels (`en.json`), in the oracle's order.
 * `letter` is the oracle's second chord for a tool the toolbar badge only shows a digit
 * for (`HelpDialog.tsx@1118751f`'s `shortcuts={[KEYS.V, KEYS["1"]]}` and the rest of the
 * shape row) — checked against this app's own chord table (`engine/src/tools.ts`'s
 * `HOTKEYS`), not guessed, and proven real by `shortcutRegistry.test.ts` dispatching it.
 */
const ORACLE_TOOLS: readonly { tool: DrawTool; label: string; letter?: string }[] = [
  { tool: "select", label: "Selection", letter: "V" },
  { tool: "hand", label: "Hand (panning tool)" },
  { tool: "rectangle", label: "Rectangle", letter: "R" },
  { tool: "diamond", label: "Diamond", letter: "D" },
  { tool: "ellipse", label: "Ellipse", letter: "O" },
  { tool: "arrow", label: "Arrow", letter: "A" },
  { tool: "line", label: "Line", letter: "L" },
  { tool: "freedraw", label: "Draw", letter: "P" },
  { tool: "text", label: "Text", letter: "T" },
  // The oracle grew a sticky note tool of its own (`toolBar.stickynote`, also N) — no
  // longer ours alone, so it sits here rather than in an "ours" section.
  { tool: "stickynote", label: "Sticky note" },
  { tool: "eraser", label: "Eraser", letter: "E" },
  { tool: "image", label: "Insert image" },
  { tool: "frame", label: "Frame tool" },
  { tool: "bucketfill", label: "Bucket fill" },
  { tool: "laser", label: "Laser pointer" },
];

export const SHORTCUT_REGISTRY: readonly ShortcutEntry[] = [
  // --- Tools (HelpDialog.tsx's "Tools" island) ---------------------------------------
  ...ORACLE_TOOLS.map(({ tool, label, letter }): ShortcutEntry => ({
    id: `tool.${tool}`,
    section: "Tools",
    label,
    chords: letter ? [toolChord(tool), letter] : [toolChord(tool)],
  })),
  {
    id: "tool.lockActive",
    section: "Tools",
    label: "Keep selected tool active after drawing",
    chords: ["Q"],
  },
  { id: "tool.editText", section: "Tools", label: "Edit text / add label", chords: ["Enter"] },
  // `toolBar.convertElementType` (`HelpDialog.tsx@1118751f`), the oracle's own label for
  // Tab's shape switch (`shapeSwitch.ts`) — owned by `switchKey`, not the engine.
  {
    id: "tool.shapeSwitch",
    section: "Tools",
    label: "Toggle shape type",
    chords: ["Tab", "Shift+Tab"],
  },

  // --- View (HelpDialog.tsx's "View" island) ------------------------------------------
  { id: "view.zoomIn", section: "View", label: "Zoom in", chords: ["CtrlOrCmd+="] },
  { id: "view.zoomOut", section: "View", label: "Zoom out", chords: ["CtrlOrCmd+-"] },
  { id: "view.zoomReset", section: "View", label: "Reset zoom", chords: ["CtrlOrCmd+0"] },
  // The oracle's three fits (`actionCanvas.tsx@1118751f:290-410`), each its own action
  // with its own label — not "ours": `zoomToFitSelectionInViewport` (Shift+2) and
  // `zoomToFitSelection` (Shift+3, `Contain`, can zoom past 100%) are both the oracle's.
  {
    id: "view.zoomToFit",
    section: "View",
    label: "Zoom to fit all elements",
    chords: ["Shift+1"],
  },
  {
    id: "view.zoomToFitSelectionInViewport",
    section: "View",
    label: "Zoom to fit in viewport",
    chords: ["Shift+2"],
  },
  {
    id: "view.zoomToFitSelection",
    section: "View",
    label: "Zoom to selection",
    chords: ["Shift+3"],
  },
  {
    id: "view.movePageUpDown",
    section: "View",
    label: "Move page up/down",
    chords: ["PageUp", "PageDown"],
  },
  {
    id: "view.movePageLeftRight",
    section: "View",
    label: "Move page left/right",
    chords: ["Shift+PageUp", "Shift+PageDown"],
  },
  { id: "view.snap", section: "View", label: "Snap to objects", chords: ["Alt+S"] },
  { id: "view.grid", section: "View", label: "Toggle grid", chords: ["CtrlOrCmd+'"] },
  {
    id: "view.commandPalette",
    section: "View",
    label: "Command palette",
    chords: ["CtrlOrCmd+/", "CtrlOrCmd+Shift+P"],
  },

  // --- Editor (HelpDialog.tsx's "Editor" island) --------------------------------------
  { id: "editor.delete", section: "Editor", label: "Delete", chords: ["Delete", "Backspace"] },
  { id: "editor.cut", section: "Editor", label: "Cut", chords: ["CtrlOrCmd+X"] },
  { id: "editor.copy", section: "Editor", label: "Copy", chords: ["CtrlOrCmd+C"] },
  { id: "editor.selectAll", section: "Editor", label: "Select all", chords: ["CtrlOrCmd+A"] },
  {
    id: "editor.copyStyles",
    section: "Editor",
    label: "Copy styles",
    chords: ["CtrlOrCmd+Alt+C"],
  },
  {
    id: "editor.pasteStyles",
    section: "Editor",
    label: "Paste styles",
    chords: ["CtrlOrCmd+Alt+V"],
  },
  {
    id: "editor.sendToBack",
    section: "Editor",
    label: "Send to back",
    chords: ["CtrlOrCmd+Alt+[", "CtrlOrCmd+Shift+["],
  },
  {
    id: "editor.bringToFront",
    section: "Editor",
    label: "Bring to front",
    chords: ["CtrlOrCmd+Alt+]", "CtrlOrCmd+Shift+]"],
  },
  {
    id: "editor.sendBackward",
    section: "Editor",
    label: "Send backward",
    chords: ["CtrlOrCmd+["],
  },
  {
    id: "editor.bringForward",
    section: "Editor",
    label: "Bring forward",
    chords: ["CtrlOrCmd+]"],
  },
  // The oracle's four (`labels.alignTop/Bottom/Left/Right`, `actionAlign.tsx@1118751f`),
  // each its own action — `engine/src/host/keys.ts`'s `ALIGN_ARROWS` routes all four.
  {
    id: "editor.alignTop",
    section: "Editor",
    label: "Align top",
    chords: ["CtrlOrCmd+Shift+ArrowUp"],
  },
  {
    id: "editor.alignBottom",
    section: "Editor",
    label: "Align bottom",
    chords: ["CtrlOrCmd+Shift+ArrowDown"],
  },
  {
    id: "editor.alignLeft",
    section: "Editor",
    label: "Align left",
    chords: ["CtrlOrCmd+Shift+ArrowLeft"],
  },
  {
    id: "editor.alignRight",
    section: "Editor",
    label: "Align right",
    chords: ["CtrlOrCmd+Shift+ArrowRight"],
  },
  { id: "editor.duplicate", section: "Editor", label: "Duplicate", chords: ["CtrlOrCmd+D"] },
  {
    id: "editor.toggleLock",
    section: "Editor",
    label: "Lock/unlock selection",
    chords: ["CtrlOrCmd+Shift+L"],
  },
  { id: "editor.undo", section: "Editor", label: "Undo", chords: ["CtrlOrCmd+Z"] },
  {
    id: "editor.redo",
    section: "Editor",
    label: "Redo",
    chords: ["CtrlOrCmd+Shift+Z", "CtrlOrCmd+Y"],
  },
  { id: "editor.group", section: "Editor", label: "Group selection", chords: ["CtrlOrCmd+G"] },
  {
    id: "editor.ungroup",
    section: "Editor",
    label: "Ungroup selection",
    chords: ["CtrlOrCmd+Shift+G"],
  },
  // The oracle has no help-dialog entry for the arrow keys (`App.tsx@1118751f:5801-5810`),
  // so this label is ours — `nudge_step` (`engine/crates/draw-engine/src/engine/arrange.rs`)
  // moves the selection 1px, 5px with Shift, matching the oracle's own step exactly.
  {
    id: "editor.moveSelection",
    section: "Editor",
    label: "Move selection 1px, 5px with Shift",
    chords: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  },
  { id: "editor.flipHorizontal", section: "Editor", label: "Flip horizontal", chords: ["Shift+H"] },
  { id: "editor.flipVertical", section: "Editor", label: "Flip vertical", chords: ["Shift+V"] },
  {
    id: "editor.showStroke",
    section: "Editor",
    label: "Show stroke color picker",
    chords: ["S"],
  },
  {
    id: "editor.showBackground",
    section: "Editor",
    label: "Show background color picker",
    chords: ["G"],
  },
  { id: "editor.showFonts", section: "Editor", label: "Show font picker", chords: ["Shift+F"] },
  {
    id: "editor.decreaseFontSize",
    section: "Editor",
    label: "Decrease font size",
    chords: ["CtrlOrCmd+Shift+<"],
  },
  {
    id: "editor.increaseFontSize",
    section: "Editor",
    label: "Increase font size",
    chords: ["CtrlOrCmd+Shift+>"],
  },

  // --- Presentation (ours: the oracle has no presentation mode) ----------------------
  {
    id: "presentation.enter",
    section: "Presentation",
    label: "Present — the board's frames as slides",
    chords: ["CtrlOrCmd+Alt+P"],
  },
  {
    id: "presentation.next",
    section: "Presentation",
    label: "Next slide",
    chords: ["ArrowRight", "ArrowDown", "Space", "PageDown", "Enter"],
  },
  {
    id: "presentation.prev",
    section: "Presentation",
    label: "Previous slide",
    chords: ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"],
  },
  {
    id: "presentation.firstLast",
    section: "Presentation",
    label: "First / last slide",
    chords: ["Home", "End"],
  },
  {
    id: "presentation.exit",
    section: "Presentation",
    label: "Exit presentation",
    chords: ["Escape"],
  },

  // --- Flowchart (create/navigate follow the oracle; the shape picker is ours) -------
  {
    id: "flowchart.create",
    section: "Flowchart",
    label: "Create a flowchart from a generic element",
    chords: [
      "CtrlOrCmd+ArrowUp",
      "CtrlOrCmd+ArrowDown",
      "CtrlOrCmd+ArrowLeft",
      "CtrlOrCmd+ArrowRight",
    ],
  },
  {
    id: "flowchart.navigate",
    section: "Flowchart",
    label: "Navigate a flowchart",
    chords: ["Alt+ArrowUp", "Alt+ArrowDown", "Alt+ArrowLeft", "Alt+ArrowRight"],
  },
  {
    id: "flowchart.shape",
    section: "Flowchart",
    label: "Rectangle / diamond / ellipse, while creating a flowchart node",
    chords: ["CtrlOrCmd+1", "CtrlOrCmd+2", "CtrlOrCmd+3"],
  },
];

/** Every entry, grouped by section in the order each section was first seen — the same
 *  shape `commandPalette.ts`'s `groupCommands` builds for `Command`, over this registry's
 *  own entry type instead. */
export function groupedShortcuts(
  entries: readonly ShortcutEntry[] = SHORTCUT_REGISTRY,
): { section: ShortcutSection; entries: ShortcutEntry[] }[] {
  const order: ShortcutSection[] = [];
  const bySection = new Map<ShortcutSection, ShortcutEntry[]>();
  for (const entry of entries) {
    if (!bySection.has(entry.section)) {
      bySection.set(entry.section, []);
      order.push(entry.section);
    }
    bySection.get(entry.section)!.push(entry);
  }
  return order.map((section) => ({ section, entries: bySection.get(section)! }));
}

/**
 * What the help dialog and the palette both print for a registry entry: every chord it
 * takes, `shortcutLabel`-formatted for this platform and joined with " or ". Throws on an
 * unknown id so a typo in `commandPalette.ts` fails loudly instead of showing no shortcut.
 */
export function shortcutFor(id: string, mac: boolean = IS_MAC): string {
  const entry = SHORTCUT_REGISTRY.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`shortcutRegistry: no entry "${id}"`);
  return entry.chords.map((chord) => shortcutLabel(chord, mac)).join(" or ");
}
