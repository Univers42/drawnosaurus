import type { DrawTool } from "@osionos/draw-engine/types";
import type { IconName } from "./icons.ts";

/**
 * Every tool the toolbar can show: the engine's own, plus the host's.
 *
 * Only `"sticky"` is listed here. Everything else — image, frame, embed, autoshape,
 * laser, lasso — is the engine's, and naming those again would fork the tool list: the
 * union would keep compiling after the engine dropped or renamed one, and the toolbar
 * would offer a tool `setTool` no longer accepts.
 */
export type ExtendedTool = DrawTool | "sticky";

export interface ToolDef {
  tool: ExtendedTool;
  label: string;
  /** The bare key, without a modifier. `shift` carries the modifier separately. */
  hotkey: string;
  /** Set only for autoshape, the one tool Excalidraw reaches with a chord. */
  shift?: boolean;
  icon: IconName;
}

/**
 * The shortcut as a person reads it: `⇧X`, or just the key.
 *
 * Kept apart from `hotkey` because the badge and the keymap want different things — the
 * keymap needs the key and the modifier as separate values, and printing `⇧X` into a
 * lookup would find nothing.
 */
export function hotkeyLabel(entry: ToolDef): string {
  return entry.shift ? `⇧${entry.hotkey}` : entry.hotkey;
}

/**
 * The tools on the bar itself: the ones you reach for constantly.
 *
 * This list is short on purpose. Every tool added to it makes every *other* tool harder
 * to hit, because the bar is a row of identical squares and finding one in it is a
 * scanning problem — and past a point the row stops fitting on a laptop screen at all,
 * which is what happened here: the last few were simply off the end.
 *
 * Excalidraw's split, and for the same reason.
 */
export const DRAW_TOOLS: readonly ToolDef[] = [
  { tool: "select", label: "Select", hotkey: "1", icon: "select" },
  { tool: "hand", label: "Pan", hotkey: "H", icon: "hand" },
  { tool: "rectangle", label: "Rectangle", hotkey: "2", icon: "rectangle" },
  { tool: "diamond", label: "Diamond", hotkey: "3", icon: "diamond" },
  { tool: "ellipse", label: "Ellipse", hotkey: "4", icon: "ellipse" },
  { tool: "arrow", label: "Arrow", hotkey: "5", icon: "arrow" },
  { tool: "line", label: "Line", hotkey: "6", icon: "line" },
  { tool: "freedraw", label: "Draw", hotkey: "7", icon: "freedraw" },
  { tool: "text", label: "Text", hotkey: "8", icon: "text" },
  { tool: "eraser", label: "Eraser", hotkey: "0", icon: "eraser" },
];

/**
 * The tools behind the "more tools" button, after the divider.
 *
 * Not lesser tools — a frame or a laser is as real as a rectangle — but occasional ones,
 * reached deliberately rather than by reflex. Each still has its own shortcut and the
 * shortcut does not go through this menu at all: the engine owns the keymap, so every
 * one of these is one key away whether the menu is open, closed or never discovered.
 *
 * Excalidraw's dropdown holds exactly these, which is where the order comes from.
 */
export const EXTRA_TOOLS: readonly ToolDef[] = [
  { tool: "image", label: "Insert image", hotkey: "9", icon: "image" },
  { tool: "frame", label: "Frame", hotkey: "F", icon: "frame" },
  { tool: "embed", label: "Embed web page", hotkey: "W", icon: "embed" },
  // Shift+X, Excalidraw's own: autoshape is the shifted freedraw key. It used to print
  // `G`, an invention from when the engine's keymap could not express a modifier.
  { tool: "autoshape", label: "Draw to shape", hotkey: "X", shift: true, icon: "autoshape" },
  { tool: "bucketfill", label: "Bucket fill", hotkey: "B", icon: "bucketfill" },
  { tool: "laser", label: "Laser pointer", hotkey: "K", icon: "laser" },
  { tool: "lasso", label: "Lasso", hotkey: "S", icon: "lasso" },
  // "N" for note. Excalidraw's 9 is the image tool, and a sticky note is ours rather
  // than theirs, so it is the one that yields the digit.
  { tool: "sticky", label: "Sticky Note", hotkey: "N", icon: "sticky" },
];

/** Every tool, wherever it lives. */
export const ALL_TOOL_DEFS: readonly ToolDef[] = [...DRAW_TOOLS, ...EXTRA_TOOLS];

/** Whether a tool lives behind the "more tools" button. */
export function isExtraTool(tool: ExtendedTool): boolean {
  return EXTRA_TOOLS.some((entry) => entry.tool === tool);
}

/** The definition for a tool, wherever it lives. */
export function toolDef(tool: ExtendedTool): ToolDef | undefined {
  return ALL_TOOL_DEFS.find((entry) => entry.tool === tool);
}
