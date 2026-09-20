import { z } from "zod";

/**
 * Scene bounds, mirroring `engine/crates/draw-engine/src/scene/geometry.rs`
 * (`normalize_rect`, `element_bounds`, `scene_bounds`).
 *
 * This is a deliberate second implementation, not an oversight: the engine's copy
 * is compiled to WASM for the browser, and the API has no WASM runtime. The
 * semantics are pinned by tests so drift shows up as a failure rather than as a
 * gallery thumbnail that frames the wrong region:
 *
 *  - negative width/height normalise (a rect dragged up-left still has bounds)
 *  - tombstones are skipped
 *  - an empty scene has no bounds at all (null, not a zero rect)
 *  - rotation and freehand points are ignored, exactly as the engine ignores them
 */

export const worldBoundsSchema = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
});

export type WorldBounds = z.infer<typeof worldBoundsSchema>;

interface BoundsInput {
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted: boolean;
}

export function elementBounds(element: Omit<BoundsInput, "isDeleted">): WorldBounds {
  const minX = element.width < 0 ? element.x + element.width : element.x;
  const minY = element.height < 0 ? element.y + element.height : element.y;
  return {
    minX,
    minY,
    maxX: minX + Math.abs(element.width),
    maxY: minY + Math.abs(element.height),
  };
}

export function sceneBounds(elements: readonly BoundsInput[]): WorldBounds | null {
  let bounds: WorldBounds | null = null;

  for (const element of elements) {
    if (element.isDeleted) continue;
    const next = elementBounds(element);
    bounds =
      bounds === null
        ? next
        : {
            minX: Math.min(bounds.minX, next.minX),
            minY: Math.min(bounds.minY, next.minY),
            maxX: Math.max(bounds.maxX, next.maxX),
            maxY: Math.max(bounds.maxY, next.maxY),
          };
  }

  return bounds;
}
