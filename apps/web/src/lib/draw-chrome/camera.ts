/** Camera scale as an integer percentage (100 = 1:1). */
export function zoomPercent(scale: number): number {
  return Math.round(scale * 100);
}

/** The engine's size for new text, and the "M" of the panel's font sizes. */
const DEFAULT_FONT_SIZE = 20;

/**
 * A world font size on screen, in CSS px, at a zoom percentage.
 *
 * The size comes over the wire, so it is checked rather than trusted: a missing one once
 * made this NaN — `NaNpx` is invalid CSS, and the text editor drew in the browser's
 * 13.33px default. `fallback` stands in for it (the element's own size, as the engine
 * reports it), and the engine's default for that.
 */
export function screenFontPx(fontSize: number | undefined, fallback: number, zoom: number): number {
  const usable = (size: number | undefined): size is number =>
    size !== undefined && Number.isFinite(size) && size > 0;
  const size = [fontSize, fallback].find(usable) ?? DEFAULT_FONT_SIZE;
  return (size * zoom) / 100;
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
