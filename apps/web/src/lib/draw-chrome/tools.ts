import type { DrawTool } from "@osionos/draw-engine/types";
import type { IconName } from "./icons.ts";

export type ExtendedTool = DrawTool | "sticky";

export interface ToolDef {
  tool: ExtendedTool;
  label: string;
  hotkey: string;
  icon: IconName;
}

export const DRAW_TOOLS: readonly ToolDef[] = [
  { tool: "select", label: "Select", hotkey: "1", icon: "select" },
  { tool: "lasso", label: "Lasso", hotkey: "S", icon: "lasso" },
  { tool: "hand", label: "Pan", hotkey: "H", icon: "hand" },
  { tool: "rectangle", label: "Rectangle", hotkey: "2", icon: "rectangle" },
  { tool: "diamond", label: "Diamond", hotkey: "3", icon: "diamond" },
  { tool: "ellipse", label: "Ellipse", hotkey: "4", icon: "ellipse" },
  { tool: "arrow", label: "Arrow", hotkey: "5", icon: "arrow" },
  { tool: "line", label: "Line", hotkey: "6", icon: "line" },
  { tool: "freedraw", label: "Draw", hotkey: "7", icon: "freedraw" },
  { tool: "text", label: "Text", hotkey: "8", icon: "text" },
  // "N" for note. Excalidraw's 9 is the image tool, and a sticky note is ours rather
  // than theirs, so it is the one that yields the digit.
  { tool: "sticky", label: "Sticky Note", hotkey: "N", icon: "sticky" },
  { tool: "image", label: "Insert image", hotkey: "9", icon: "image" },
  { tool: "eraser", label: "Eraser", hotkey: "0", icon: "eraser" },
  { tool: "laser", label: "Laser pointer", hotkey: "K", icon: "laser" },
  { tool: "frame", label: "Frame", hotkey: "F", icon: "frame" },
  { tool: "embed", label: "Embed web page", hotkey: "W", icon: "embed" },
];
