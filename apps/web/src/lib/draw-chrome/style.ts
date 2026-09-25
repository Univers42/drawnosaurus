import type { DrawTool } from "@osionos/draw-engine/types";

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
  "bucketfill",
  "stickynote",
]);

export function cursorForTool(tool: DrawTool): string {
  if (tool === "text") return "text";
  if (CROSSHAIR_TOOLS.has(tool)) return "crosshair";
  return "default";
}
