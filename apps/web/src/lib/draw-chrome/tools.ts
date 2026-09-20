import type { DrawTool } from "@osionos/draw-engine/types";
import type { IconName } from "./icons.ts";

export interface ToolDef {
  tool: DrawTool;
  label: string;
  hotkey: string;
  icon: IconName;
}

export const DRAW_TOOLS: readonly ToolDef[] = [
  { tool: "select", label: "Select", hotkey: "V", icon: "select" },
  { tool: "hand", label: "Pan", hotkey: "H", icon: "hand" },
  { tool: "rectangle", label: "Rectangle", hotkey: "R", icon: "rectangle" },
  { tool: "diamond", label: "Diamond", hotkey: "D", icon: "diamond" },
  { tool: "ellipse", label: "Ellipse", hotkey: "O", icon: "ellipse" },
  { tool: "arrow", label: "Arrow", hotkey: "A", icon: "arrow" },
  { tool: "line", label: "Line", hotkey: "L", icon: "line" },
  { tool: "freedraw", label: "Draw", hotkey: "P", icon: "freedraw" },
  { tool: "text", label: "Text", hotkey: "T", icon: "text" },
  { tool: "eraser", label: "Eraser", hotkey: "E", icon: "eraser" },
];
