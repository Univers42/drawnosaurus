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

/** Mirrors the engine's `MIN_ZOOM`/`MAX_ZOOM` (`camera.rs`). */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * The camera that frames `bounds` inside `viewport`, with `padding` screen pixels of
 * margin on every side — a host-side mirror of the engine's `fit_bounds` (`camera.rs`),
 * kept here because presenting fits a single *frame*, not the whole scene or the current
 * selection, which is the only two bounds the engine itself knows how to fit to.
 */
export function fitCamera(
  bounds: WorldBounds,
  viewport: Viewport,
  padding = 0,
): { x: number; y: number; scale: number } {
  const worldW = Math.max(bounds.maxX - bounds.minX, 1);
  const worldH = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = clamp(
    Math.min((viewport.width - padding * 2) / worldW, (viewport.height - padding * 2) / worldH),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
  };
}

/** Ease-in-out cubic: slow, fast, slow, the shape every "ease-in-out" in this project's
 *  spec means. `t` and the result are both clamped to [0, 1]. */
export function easeInOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface CameraLike {
  x: number;
  y: number;
  scale: number;
}

/** One camera between two others, `t` in [0, 1] — x, y and scale all lerped plainly. */
export function lerpCamera(from: CameraLike, to: CameraLike, t: number): CameraLike {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    scale: lerp(from.scale, to.scale, t),
  };
}

/** What `setCameraExact` needs from an engine: read the camera, and the two setters the
 *  WASM boundary already exposes. */
export interface CameraSetter {
  readonly camera: CameraLike;
  panBy(dx: number, dy: number): void;
  zoomAt(sx: number, sy: number, factor: number): void;
}

/**
 * Sets the camera to an exact `x`/`y`/`scale`, through the two calls the engine already
 * exposes rather than a third one on the WASM boundary just for this.
 *
 * `panBy` moves `x`/`y` with the scale held, landing exactly on the target's — pan adds
 * screen pixels straight to the camera. `zoomAt` anchored at that same point then changes
 * only the scale: solving the engine's own `zoom_to` (`sx - (sx - camera.x) * ratio`) for
 * the anchor that leaves `x` unmoved gives `sx = camera.x`, so anchoring there moves
 * nothing but the scale. Composed, the two land on `target` exactly, up to floating point.
 */
export function setCameraExact(engine: CameraSetter, target: CameraLike): void {
  const before = engine.camera;
  if (target.x !== before.x || target.y !== before.y) {
    engine.panBy(target.x - before.x, target.y - before.y);
  }
  const after = engine.camera;
  if (target.scale !== after.scale) {
    engine.zoomAt(after.x, after.y, target.scale / after.scale);
  }
}

export interface CameraAnimation {
  cancel(): void;
}

export interface AnimateCameraOptions {
  /** Default 400ms — the spec's "ease-in-out, ~400ms". */
  durationMs?: number;
  /** `prefers-reduced-motion`: jump straight to `to` in one step. */
  reducedMotion?: boolean;
  /** Called once, after the last frame is applied (or at once, for `reducedMotion`). */
  onDone?: () => void;
  raf?: (cb: (time: number) => void) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

/**
 * Drives a camera from `from` to `to`, easing in and out over `durationMs` — or straight
 * there in one step when `reducedMotion`. `raf`/`caf`/`now` are injectable so the
 * schedule is tested without a real frame loop or a real clock.
 */
export function animateCamera(
  from: CameraLike,
  to: CameraLike,
  apply: (camera: CameraLike) => void,
  options: AnimateCameraOptions = {},
): CameraAnimation {
  const duration = options.durationMs ?? 400;
  const now = options.now ?? (() => Date.now());
  if (options.reducedMotion || duration <= 0) {
    apply(to);
    options.onDone?.();
    return { cancel() {} };
  }
  const raf = options.raf ?? ((cb: (time: number) => void) => requestAnimationFrame(cb));
  const caf = options.caf ?? ((id: number) => cancelAnimationFrame(id));
  const start = now();
  let id = 0;
  const tick = (): void => {
    const t = clamp((now() - start) / duration, 0, 1);
    apply(lerpCamera(from, to, easeInOutCubic(t)));
    if (t < 1) {
      id = raf(tick);
    } else {
      options.onDone?.();
    }
  };
  // Paints the first frame (t=0) at once rather than waiting a tick, so the slide begins
  // moving the instant it is called rather than sitting still for one frame first.
  tick();
  return { cancel: () => caf(id) };
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
