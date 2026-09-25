/** Camera scale as an integer percentage (100 = 1:1). */
export function zoomPercent(scale: number): number {
  return Math.round(scale * 100);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The union box of one or more elements' own `x/y/width/height`, unrotated.
 *
 * A flowchart cluster is created axis-aligned, so this is exact for the case it exists
 * for; a rotated element would need the true rotated AABB `packages/contract/bounds.ts`
 * computes, which this module has no reason to duplicate for a reveal nudge.
 */
export function boundsOf(elements: Box[]): Box | null {
  if (elements.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    left = Math.min(left, el.x);
    top = Math.min(top, el.y);
    right = Math.max(right, el.x + el.width);
    bottom = Math.max(bottom, el.y + el.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The screen-space pan (`panBy`'s own units — added straight onto `camera.x/y`) that
 * brings `target` inside `viewport` with `padding` to spare, or `null` when it already
 * fits. Chosen over a re-fit so an in-progress flowchart never surprises the person by
 * changing their zoom out from under them — only scrolls, the way the oracle's own
 * `scale-down` fit would only if the cluster had outgrown the screen.
 */
export function revealPan(
  viewport: { width: number; height: number },
  camera: { x: number; y: number; scale: number },
  target: Box,
  padding = 48,
): { dx: number; dy: number } | null {
  const left = target.x * camera.scale + camera.x;
  const top = target.y * camera.scale + camera.y;
  const right = left + target.width * camera.scale;
  const bottom = top + target.height * camera.scale;

  let dx = 0;
  let dy = 0;
  if (left < padding) dx = padding - left;
  else if (right > viewport.width - padding) dx = viewport.width - padding - right;
  if (top < padding) dy = padding - top;
  else if (bottom > viewport.height - padding) dy = viewport.height - padding - bottom;

  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/**
 * Eased progress at `elapsedMs` of `durationMs` — a short ease-out, not a jump. `t=1`
 * once elapsed reaches the duration, so a caller can stop animating past it.
 */
export function easeOutProgress(elapsedMs: number, durationMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return 1 - (1 - t) * (1 - t);
}

/**
 * World → screen, matching the engine's `world_to_screen`
 * (`wx * scale + camera.x`). Peer cursors are stored in world space.
 */
export function worldToScreen(
  camera: { x: number; y: number; scale: number },
  wx: number,
  wy: number,
): { sx: number; sy: number } {
  return {
    sx: wx * camera.scale + camera.x,
    sy: wy * camera.scale + camera.y,
  };
}
