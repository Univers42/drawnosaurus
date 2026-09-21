import type { DrawElement, DrawElementStyle, DrawTool } from "@osionos/draw-engine/types";

/**
 * Tools whose cursor is a crosshair — every tool aimed at a point rather than at a thing.
 *
 * Named for what it decides rather than for shapes: it has never been only shapes, and
 * the eraser, the lasso and the laser are all aimed the same way. These must agree with
 * the engine's own hover cursors, which is why the lasso is here — the engine already
 * showed a crosshair once a loop was under way, so the pointer changed shape the moment
 * you pressed.
 */
const CROSSHAIR_TOOLS = new Set<DrawTool>([
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "arrow",
  "freedraw",
  "eraser",
  "lasso",
  "laser",
  "frame",
  "autoshape",
]);

/** `<input type="color">` only accepts #rrggbb. Anything else (transparent, tokens) falls back. */
export function toHex(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#1e1e1e";
}

export function cursorForTool(tool: DrawTool): string {
  if (tool === "text") return "text";
  if (CROSSHAIR_TOOLS.has(tool)) return "crosshair";
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
