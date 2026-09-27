import { MAX_ZOOM, MIN_ZOOM } from "@osionos/draw-engine/types";

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
 * Good enough to place chrome beside a selection or a pending flowchart cluster; a
 * rotated element would need the true rotated AABB `packages/contract/bounds.ts`
 * computes, which this module has no reason to duplicate for that.
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

function sameCamera(a: CameraLike, b: CameraLike): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}

export interface CameraAnimation {
  cancel(): void;
}

export interface AnimateCameraOptions {
  /** Default 400ms — the spec's "ease-in-out, ~400ms". */
  durationMs?: number;
  /** The way from `from` to `to`, `t` in [0, 1] and eased; a straight lerp by default.
   *  `flight(…).at` is the zoom-out-and-in a presentation travels by. */
  path?: (t: number) => CameraLike;
  /** `prefers-reduced-motion`: jump straight to `to` in one step. */
  reducedMotion?: boolean;
  /** Called once when it stops: after the last frame (at once, for `reducedMotion`), or
   *  when `source` shows the camera was taken over. */
  onDone?: () => void;
  /**
   * The engine the camera belongs to. Given it, the animation yields: it stops, leaving
   * the camera where it is, as soon as something else has moved it — or has started an
   * eased move of the engine's own (`cameraTarget` is not the camera), which the next
   * frame's `panBy` would otherwise cancel. A fit, a zoom or a reveal asked for while
   * this runs is kept, not undone a frame later.
   */
  source?: { readonly camera: CameraLike; readonly cameraTarget: CameraLike };
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
  const source = options.source;
  const path = options.path ?? ((t: number) => lerpCamera(from, to, t));
  let id = 0;
  let applied: CameraLike | null = null;
  const tick = (): void => {
    if (source && applied) {
      const camera = source.camera;
      if (!sameCamera(camera, applied) || !sameCamera(source.cameraTarget, camera)) {
        options.onDone?.();
        return;
      }
    }
    const t = clamp((now() - start) / duration, 0, 1);
    apply(path(easeInOutCubic(t)));
    applied = source?.camera ?? null;
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

/** How much a flight zooms out to travel: van Wijk & Nuij's ρ, √2 as they and d3 advise. */
const RHO = Math.SQRT2;
/** A flight's duration: milliseconds per unit of its length, within these bounds. */
const FLIGHT_MS_PER_UNIT = 700;
const FLIGHT_MIN_MS = 400;
const FLIGHT_MAX_MS = 1800;

export interface Flight {
  /** The camera `t` of the way along, `t` in [0, 1]: exactly `from` at 0 and `to` at 1. */
  at(t: number): CameraLike;
  /** How long the flight takes, from its length (see `flight`). */
  durationMs: number;
}

/**
 * The smooth zoom and pan from `from` to `to` (van Wijk & Nuij, "Smooth and efficient
 * zooming and panning", InfoVis 2003) — Prezi's transition. Between two places far apart
 * it zooms out on the way, so the destination comes into view while the camera travels,
 * and in again as it lands; between a frame and one nested in it, it is a zoom.
 *
 * The math is d3-interpolate's `interpolateZoom`, in camera terms: a view is its centre in
 * world units and its width, the viewport's longer side over the scale. A flight's length
 * `S` measures how much the view changes on the way, zoom counted in e-folds; it takes
 * `S` × 700ms, between 400 and 1800.
 */
export function flight(from: CameraLike, to: CameraLike, viewport: Viewport): Flight {
  const side = Math.max(viewport.width, viewport.height, 1);
  const view = (c: CameraLike) => ({
    x: (viewport.width / 2 - c.x) / c.scale,
    y: (viewport.height / 2 - c.y) / c.scale,
    w: side / c.scale,
  });
  const camera = (x: number, y: number, w: number): CameraLike => {
    const scale = side / w;
    return { scale, x: viewport.width / 2 - x * scale, y: viewport.height / 2 - y * scale };
  };
  const a = view(from);
  const b = view(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  let length: number;
  let along: (t: number) => CameraLike;
  if (d < 1e-9 * Math.min(a.w, b.w)) {
    // The same centre: a zoom, at a steady rate in e-folds.
    const folds = Math.log(b.w / a.w);
    length = Math.abs(folds) / RHO;
    along = (t) => camera(a.x + t * dx, a.y + t * dy, a.w * Math.exp(folds * t));
  } else {
    const rho2 = RHO * RHO;
    const b0 = (b.w * b.w - a.w * a.w + rho2 * rho2 * d * d) / (2 * a.w * rho2 * d);
    const b1 = (b.w * b.w - a.w * a.w - rho2 * rho2 * d * d) / (2 * b.w * rho2 * d);
    // `ln(√(b² + 1) − b)`, written so a large `b` cannot cancel to `ln(0)`.
    const r0 = -Math.asinh(b0);
    const r1 = -Math.asinh(b1);
    length = (r1 - r0) / RHO;
    along = (t) => {
      const s = t * length;
      const u = (a.w / (rho2 * d)) * (Math.cosh(r0) * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      return camera(a.x + u * dx, a.y + u * dy, (a.w * Math.cosh(r0)) / Math.cosh(RHO * s + r0));
    };
  }
  return {
    at: (t) => (t <= 0 ? from : t >= 1 ? to : along(t)),
    durationMs: clamp(length * FLIGHT_MS_PER_UNIT, FLIGHT_MIN_MS, FLIGHT_MAX_MS),
  };
}

/**
 * Focus mode's target camera: eases in so `bounds` — the shape Enter was pressed on —
 * fills the viewport width with a comfortable margin (80% by default), capped at
 * `maxScale` (2x — a "sensible zoom", not a hard engine limit), and never *below* the
 * camera's current scale. The floor matters as much as the ceiling: a shape entered
 * while already zoomed in past what the margin would ask for must not pull the camera
 * back out — that would fight the zoom level the person chose on their way in.
 */
export function focusCamera(
  bounds: Box,
  viewport: Viewport,
  current: CameraLike,
  options: { marginRatio?: number; maxScale?: number } = {},
): CameraLike {
  const marginRatio = options.marginRatio ?? 0.8;
  const maxScale = options.maxScale ?? 2;
  const fitScale = (viewport.width * marginRatio) / Math.max(bounds.width, 1);
  const scale = Math.max(current.scale, Math.min(fitScale, maxScale));
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    scale,
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
  };
}

const FOCUS_MODE_STORAGE_KEY = "drawnosaurus:focus-mode";

/**
 * Whether entering text from the keyboard (Enter on a selected shape) eases the camera
 * in on it. **On** by default, unlike the grid/objects-snap toggles above — Excalidraw
 * has no equivalent to default off against, and the point of the feature is lost if
 * most people never see it once.
 */
export function readFocusModePreference(storage?: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(FOCUS_MODE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function persistFocusModePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  on: boolean,
): void {
  try {
    storage?.setItem(FOCUS_MODE_STORAGE_KEY, String(on));
  } catch {
    // Not persisting is survivable; the current page still honours the choice.
  }
}
