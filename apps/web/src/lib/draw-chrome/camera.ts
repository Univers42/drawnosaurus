/** Camera scale as an integer percentage (100 = 1:1). */
export function zoomPercent(scale: number): number {
  return Math.round(scale * 100);
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
