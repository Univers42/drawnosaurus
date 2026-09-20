import type { DrawElement, DrawElementStyle, DrawTool } from "@osionos/draw-engine/types";

const DRAW_SHAPE_TOOLS = new Set<DrawTool>([
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "arrow",
  "freedraw",
  "eraser",
]);

/** `<input type="color">` only accepts #rrggbb. Anything else (transparent, tokens) falls back. */
export function toHex(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#1e1e1e";
}

export function cursorForTool(tool: DrawTool): string {
  if (tool === "text") return "text";
  if (DRAW_SHAPE_TOOLS.has(tool)) return "crosshair";
  return "default";
}

export function styleOf(element: DrawElement): DrawElementStyle {
  const {
    strokeColor,
    backgroundColor,
    fillStyle,
    strokeWidth,
    strokeStyle,
    roughness,
    opacity,
    roundness,
  } = element;
  return {
    strokeColor,
    backgroundColor,
    fillStyle,
    strokeWidth,
    strokeStyle,
    roughness,
    opacity,
    roundness,
  };
}
