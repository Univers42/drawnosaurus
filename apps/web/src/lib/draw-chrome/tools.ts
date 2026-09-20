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
  { tool: "hand", label: "Pan", hotkey: "H", icon: "hand" },
  { tool: "rectangle", label: "Rectangle", hotkey: "2", icon: "rectangle" },
  { tool: "diamond", label: "Diamond", hotkey: "3", icon: "diamond" },
  { tool: "ellipse", label: "Ellipse", hotkey: "4", icon: "ellipse" },
  { tool: "arrow", label: "Arrow", hotkey: "5", icon: "arrow" },
  { tool: "line", label: "Line", hotkey: "6", icon: "line" },
  { tool: "freedraw", label: "Draw", hotkey: "7", icon: "freedraw" },
  { tool: "text", label: "Text", hotkey: "8", icon: "text" },
  { tool: "sticky", label: "Sticky Note", hotkey: "9", icon: "sticky" },
  { tool: "eraser", label: "Eraser", hotkey: "0", icon: "eraser" },
];
