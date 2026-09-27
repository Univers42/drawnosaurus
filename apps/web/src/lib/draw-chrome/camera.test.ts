import { describe, expect, it, vi } from "vitest";
import { sceneBounds, type WorldBounds } from "@drawnosaurus/contract";
import { maxZoom, minZoom, screenToWorld, worldToScreen } from "@osionos/draw-engine/cameraMath";
import {
  animateCamera,
  boundsOf,
  easeInOutCubic,
  fitCamera,
  flight,
  focusCamera,
  lerpCamera,
  persistFocusModePreference,
  readFocusModePreference,
  setCameraExact,
  zoomPercent,
  type Box,
  type CameraSetter,
} from "./camera.ts";

describe("zoomPercent", () => {
  it("treats scale 1 as 100%", () => {
    expect(zoomPercent(1)).toBe(100);
  });

  it("rounds a fractional camera scale", () => {
    expect(zoomPercent(1.256)).toBe(126);
    expect(zoomPercent(0.333)).toBe(33);
  });
});

describe("worldToScreen", () => {
  it("is the engine's own world_to_screen: wx * scale + camera.x", () => {
    // The four values below are WASM exports of `camera.rs` now — the host's own mirror
    // of them is gone — so these cases are the front's half of the contract: the numbers
    // the five call sites place chrome with are the engine's, not a TypeScript copy of
    // them. The arithmetic is pinned in Rust, in
    // `engine/crates/draw-engine/tests/ci_camera.rs`; `cameraParity.test.ts` is what
    // stops the copy coming back.
    expect(worldToScreen({ x: 100, y: 50, scale: 2 }, 10, 20)).toEqual({ x: 120, y: 90 });
  });

  it("is the inverse of the engine's screen_to_world, which the cursor send path uses", () => {
    const camera = { x: -40, y: 12, scale: 1.5 };
    const world = { x: 200, y: -30 };
    const screen = worldToScreen(camera, world.x, world.y);
    expect(screenToWorld(camera, screen.x, screen.y).x).toBeCloseTo(world.x);
    expect(screenToWorld(camera, screen.x, screen.y).y).toBeCloseTo(world.y);
  });
});

describe("fitCamera", () => {
  it("centres the bounds on screen at the scale that fits it, minus the margin", () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    const camera = fitCamera(bounds, { width: 1000, height: 1000 }, 0);
    // The wider axis constrains: 200 world units into 1000 screen px is the tighter fit
    // (5×) against height's 100 into 1000 (10×) — the smaller of the two wins.
    expect(camera.scale).toBeCloseTo(5, 5);
    // The bounds' centre (100, 50) lands on the screen's centre (500, 500).
    expect(camera.x).toBeCloseTo(500 - 100 * 5, 5);
    expect(camera.y).toBeCloseTo(500 - 50 * 5, 5);
  });

  it("shrinks to fit inside the margin", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const withoutMargin = fitCamera(bounds, { width: 500, height: 500 }, 0);
    const withMargin = fitCamera(bounds, { width: 500, height: 500 }, 50);
    expect(withMargin.scale).toBeLessThan(withoutMargin.scale);
    expect(withMargin.scale).toBeCloseTo((500 - 100) / 100, 5);
  });

  it("clamps to the engine's own zoom limits", () => {
    // Asserted against what the engine answers rather than 0.1/30 written out
    // again here: a host that re-declared its own pair would drift silently, because
    // `setCameraExact` re-clamps through the engine's own `zoomAt` and hides it.
    const tiny = fitCamera({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { width: 1000, height: 1000 });
    expect(tiny.scale).toBe(maxZoom());
    const huge = fitCamera(
      { minX: 0, minY: 0, maxX: 1_000_000, maxY: 1_000_000 },
      { width: 100, height: 100 },
    );
    expect(huge.scale).toBe(minZoom());
  });
});

describe("easeInOutCubic", () => {
  it("starts at 0 and ends at 1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("is exactly halfway at the midpoint", () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });

  it("clamps outside [0, 1]", () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it("is slower at the ends than in the middle — an eased step, not a linear one", () => {
    const early = easeInOutCubic(0.1) - easeInOutCubic(0);
    const middle = easeInOutCubic(0.55) - easeInOutCubic(0.45);
    expect(middle).toBeGreaterThan(early);
  });
});

describe("lerpCamera", () => {
  it("is `from` at t=0 and `to` at t=1", () => {
    const from = { x: 0, y: 0, scale: 1 };
    const to = { x: 100, y: 200, scale: 3 };
    expect(lerpCamera(from, to, 0)).toEqual(from);
    expect(lerpCamera(from, to, 1)).toEqual(to);
  });

  it("interpolates x, y and scale independently", () => {
    const from = { x: 0, y: 0, scale: 1 };
    const to = { x: 100, y: 200, scale: 3 };
    expect(lerpCamera(from, to, 0.25)).toEqual({ x: 25, y: 50, scale: 1.5 });
  });
});

describe("setCameraExact", () => {
  function fakeEngine(initial: { x: number; y: number; scale: number }): CameraSetter {
    let camera = { ...initial };
    return {
      get camera() {
        return camera;
      },
      panBy(dx, dy) {
        camera = { ...camera, x: camera.x + dx, y: camera.y + dy };
      },
      zoomAt(sx, sy, factor) {
        const scale = camera.scale * factor;
        const ratio = scale / camera.scale;
        camera = { scale, x: sx - (sx - camera.x) * ratio, y: sy - (sy - camera.y) * ratio };
      },
    };
  }

  it("lands exactly on the target camera, through panBy then zoomAt alone", () => {
    const engine = fakeEngine({ x: 10, y: -20, scale: 2 });
    setCameraExact(engine, { x: -300, y: 450, scale: 0.6 });
    expect(engine.camera.x).toBeCloseTo(-300, 9);
    expect(engine.camera.y).toBeCloseTo(450, 9);
    expect(engine.camera.scale).toBeCloseTo(0.6, 9);
  });

  it("is a no-op when already there", () => {
    const engine = fakeEngine({ x: 5, y: 5, scale: 1 });
    const panBy = vi.spyOn(engine, "panBy");
    const zoomAt = vi.spyOn(engine, "zoomAt");
    setCameraExact(engine, { x: 5, y: 5, scale: 1 });
    expect(panBy).not.toHaveBeenCalled();
    expect(zoomAt).not.toHaveBeenCalled();
  });
});

describe("animateCamera", () => {
  /** A fake frame loop: `raf` just remembers the callback, `tick()` runs it. */
  function fakeClock() {
    let ms = 0;
    let queued: ((t: number) => void) | null = null;
    return {
      now: () => ms,
      raf: (cb: (t: number) => void) => {
        queued = cb;
        return 1;
      },
      caf: () => {
        queued = null;
      },
      tick(byMs: number) {
        ms += byMs;
        const cb = queued;
        queued = null;
        cb?.(ms);
      },
      get pending() {
        return queued !== null;
      },
    };
  }

  it("jumps straight to `to` for reduced motion, and calls onDone at once", () => {
    const applied: unknown[] = [];
    const onDone = vi.fn();
    const from = { x: 0, y: 0, scale: 1 };
    const to = { x: 100, y: 100, scale: 2 };
    animateCamera(from, to, (c) => applied.push(c), { reducedMotion: true, onDone });
    expect(applied).toEqual([to]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("eases from `from` to `to` over the given duration, then stops and calls onDone once", () => {
    const clock = fakeClock();
    const applied: { x: number; y: number; scale: number }[] = [];
    const onDone = vi.fn();
    const from = { x: 0, y: 0, scale: 1 };
    const to = { x: 100, y: 0, scale: 1 };
    animateCamera(from, to, (c) => applied.push(c), {
      durationMs: 400,
      now: clock.now,
      raf: clock.raf,
      caf: clock.caf,
      onDone,
    });
    expect(applied).toEqual([from]);

    clock.tick(200);
    expect(applied[1]!.x).toBeGreaterThan(0);
    expect(applied[1]!.x).toBeLessThan(100);
    expect(onDone).not.toHaveBeenCalled();
    expect(clock.pending, "schedules the next frame").toBe(true);

    clock.tick(200);
    expect(applied.at(-1)).toEqual(to);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(clock.pending, "does not schedule past the end").toBe(false);
  });

  /** An engine whose camera the animation drives, and which can start moves of its own. */
  function fakeEngine(start: { x: number; y: number; scale: number }) {
    return {
      camera: start,
      cameraTarget: start,
      apply(camera: { x: number; y: number; scale: number }) {
        this.camera = camera;
        this.cameraTarget = camera;
      },
    };
  }

  it("stops, and says so, when something else moves the camera", () => {
    const clock = fakeClock();
    const engine = fakeEngine({ x: 0, y: 0, scale: 1 });
    const onDone = vi.fn();
    animateCamera(engine.camera, { x: 100, y: 0, scale: 1 }, (c) => engine.apply(c), {
      durationMs: 400,
      source: engine,
      onDone,
      ...clock,
    });
    clock.tick(100);
    const panned = { x: -50, y: 0, scale: 1 };
    engine.apply(panned);
    clock.tick(100);
    expect(engine.camera).toEqual(panned);
    expect(clock.pending).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stops when the engine starts an eased move of its own, before that move's first frame", () => {
    const clock = fakeClock();
    const engine = fakeEngine({ x: 0, y: 0, scale: 1 });
    animateCamera(engine.camera, { x: 100, y: 0, scale: 1 }, (c) => engine.apply(c), {
      durationMs: 400,
      source: engine,
      ...clock,
    });
    clock.tick(100);
    const before = engine.camera;
    // A fit: headed somewhere, not there yet.
    engine.cameraTarget = { x: 10, y: 10, scale: 0.5 };
    clock.tick(100);
    expect(engine.camera).toBe(before);
    expect(clock.pending).toBe(false);
  });

  it("cancel() stops the schedule before it reaches the end", () => {
    const clock = fakeClock();
    const applied: unknown[] = [];
    const animation = animateCamera(
      { x: 0, y: 0, scale: 1 },
      { x: 100, y: 0, scale: 1 },
      (c) => applied.push(c),
      { durationMs: 400, now: clock.now, raf: clock.raf, caf: clock.caf },
    );
    animation.cancel();
    expect(clock.pending).toBe(false);
  });
});

describe("flight", () => {
  const viewport = { width: 1280, height: 800 };
  /** Where a camera's view is centred, in world units. */
  const centre = (c: { x: number; y: number; scale: number }) => ({
    x: (viewport.width / 2 - c.x) / c.scale,
    y: (viewport.height / 2 - c.y) / c.scale,
  });
  const frame = (x: number, y: number, w: number, h: number) =>
    fitCamera({ minX: x, minY: y, maxX: x + w, maxY: y + h }, viewport, 24);

  it("starts exactly where it is and lands exactly on the target", () => {
    const from = frame(0, 0, 300, 200);
    const to = frame(5000, 3000, 300, 200);
    const path = flight(from, to, viewport);
    expect(path.at(0)).toEqual(from);
    expect(path.at(1)).toEqual(to);
    // And from inside, it closes on the target rather than jumping to it at the end:
    // the centre within a world unit, the zoom within 1%. (Not `x`, which is the centre
    // times the scale — thousands of units out, a 1% zoom is a hundred pixels of it.)
    const near = path.at(0.999);
    const [got, want] = [centre(near), centre(to)];
    expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(1);
    expect(Math.abs(near.scale - to.scale) / to.scale).toBeLessThan(0.01);
  });

  it("zooms out on the way between two frames far apart, and back in to land", () => {
    const from = frame(0, 0, 300, 200);
    const to = frame(5000, 0, 300, 200);
    const path = flight(from, to, viewport);
    const scales = [0, 0.25, 0.5, 0.75, 1].map((t) => path.at(t).scale);
    expect(scales[2]!).toBeLessThan(from.scale / 4);
    expect(scales[1]!).toBeLessThan(scales[0]!);
    expect(scales[3]!).toBeGreaterThan(scales[2]!);
    // The centre travels the straight line between the two, one way only.
    const xs = [0, 0.25, 0.5, 0.75, 1].map((t) => centre(path.at(t)).x);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    for (const t of [0.25, 0.5, 0.75]) expect(centre(path.at(t)).y).toBeCloseTo(100, 6);
  });

  it("is a zoom about the shared centre into a frame nested in the one on screen", () => {
    const outer = frame(0, 0, 3000, 2000);
    const inner = frame(1350, 900, 300, 200);
    const path = flight(outer, inner, viewport);
    const scales = [0, 0.25, 0.5, 0.75, 1].map((t) => path.at(t).scale);
    for (let i = 1; i < scales.length; i += 1) expect(scales[i]!).toBeGreaterThan(scales[i - 1]!);
    for (const t of [0.25, 0.5, 0.75]) {
      expect(centre(path.at(t)).x).toBeCloseTo(1500, 6);
      expect(centre(path.at(t)).y).toBeCloseTo(1000, 6);
    }
  });

  it("takes longer the farther it goes, within 400 to 1800ms", () => {
    const from = frame(0, 0, 300, 200);
    const next = flight(from, frame(400, 0, 300, 200), viewport).durationMs;
    const far = flight(from, frame(8000, 0, 300, 200), viewport).durationMs;
    const nowhere = flight(from, from, viewport).durationMs;
    expect(far).toBeGreaterThan(next);
    for (const ms of [next, far, nowhere]) {
      expect(ms).toBeGreaterThanOrEqual(400);
      expect(ms).toBeLessThanOrEqual(1800);
    }
  });

  it("stays finite where the formula's terms grow huge: a hair's offset, a vast zoom", () => {
    const at = (x: number, y: number, scale: number) => ({
      scale,
      x: viewport.width / 2 - x * scale,
      y: viewport.height / 2 - y * scale,
    });
    const from = at(20, 10, 30);
    for (const to of [at(20 + 1e-6, 10, 0.1), at(20 + 1e6, 10, 0.1), at(20.1, 9.9, 29.9)]) {
      const path = flight(from, to, viewport);
      expect(Number.isFinite(path.durationMs)).toBe(true);
      for (const t of [0.1, 0.5, 0.9]) {
        const c = path.at(t);
        expect([c.x, c.y, c.scale].every(Number.isFinite), JSON.stringify({ to, t, c })).toBe(true);
      }
    }
  });

  it("drives animateCamera along its way rather than the straight line", () => {
    const from = frame(0, 0, 300, 200);
    const to = frame(5000, 0, 300, 200);
    const path = flight(from, to, viewport);
    let ms = 0;
    let queued: (() => void) | null = null;
    const applied: { scale: number }[] = [];
    animateCamera(from, to, (c) => applied.push(c), {
      durationMs: path.durationMs,
      path: path.at,
      now: () => ms,
      raf: (cb) => ((queued = () => cb(ms)), 1),
      caf: () => {},
    });
    ms = path.durationMs / 2;
    queued!();
    expect(applied.at(-1)!.scale).toBeLessThan(Math.min(from.scale, to.scale) / 4);
    ms = path.durationMs;
    queued!();
    expect(applied.at(-1)).toEqual(to);
  });
});

/**
 * The world bounds `sceneBounds` says a set of elements occupies — the contract package's
 * sanctioned mirror of the engine's `element_bounds`/`normalize_rect`
 * (`scene/geometry.rs:14-21,113-131`), pinned to the Rust by `packages/contract/tests/
 * bounds.test.ts`. Every mirrored case below is asserted against it rather than against a
 * number written here: a hand-typed `-67` is a second copy of the answer, and it drifts.
 */
function referenceBounds(elements: Box[]): WorldBounds {
  const bounds = sceneBounds(elements.map((el) => ({ ...el, isDeleted: false })));
  if (!bounds) throw new Error("sceneBounds of a non-empty set is never null");
  return bounds;
}

/** The same world bounds in `boundsOf`'s own `x/y/width/height` form. */
function asBox(bounds: WorldBounds): Box {
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

/** `boundsOf` for a set that always has bounds, without a non-null assertion. */
function unionBounds(elements: Box[]): Box {
  const bounds = boundsOf(elements);
  if (!bounds) throw new Error("a non-empty set of elements has bounds");
  return bounds;
}

describe("boundsOf", () => {
  it("is null for no elements", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("is the box itself for one element", () => {
    expect(boundsOf([{ x: 10, y: 20, width: 30, height: 40 }])).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it("unions several elements, however scattered", () => {
    const bounds = boundsOf([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 100, y: -50, width: 20, height: 5 },
    ]);
    expect(bounds).toEqual({ x: 0, y: -50, width: 120, height: 60 });
  });

  it("leaves a non-mirrored rect exactly as it was", () => {
    // The proof that normalising is invisible for an ordinary element: these are the
    // numbers the pre-fix union produced — a fractional width and height among them, so
    // it is not just the two plain literals above — and they agree with the reference.
    const upright = [
      { x: -30, y: 70, width: 12.5, height: 0.25 },
      { x: 0, y: 0, width: 10, height: 10 },
    ];
    expect(boundsOf(upright)).toEqual({ x: -30, y: 0, width: 40, height: 70.25 });
    expect(boundsOf(upright)).toEqual(asBox(referenceBounds(upright)));
  });

  // A **mirrored** element — one whose width or height went negative, which is what a
  // drag across an edge leaves behind — still occupies a box: the engine normalises it
  // (`normalize_rect`, `scene/geometry.rs:14-21`) and the contract's mirror does the
  // same (`elementBounds`, `packages/contract/src/bounds.ts:35-44`). Reading `x + width`
  // instead leaves `min_x > max_x`, which every consumer then reads as an empty or
  // inverted box. These four cases are the fix; the literals above are what must not move.
  it("normalises an element mirrored on both axes", () => {
    const mirrored = [{ x: 100, y: 100, width: -60, height: -40 }];
    expect(boundsOf(mirrored)).toEqual(asBox(referenceBounds(mirrored)));
  });

  it("normalises an element mirrored on one axis only", () => {
    const mirrored = [{ x: 100, y: 100, width: -60, height: 40 }];
    expect(boundsOf(mirrored)).toEqual(asBox(referenceBounds(mirrored)));
  });

  it("keeps a mirrored element's far corner in a union with a positive sibling", () => {
    // The case that frames empty space: the mirrored element reaches further right and
    // further down than `x + width` says, so a union that drops that corner loses it.
    const sibling = { x: 0, y: 0, width: 400, height: 300 };
    const mirrored = { x: 1000, y: 600, width: -200, height: -100 };
    const elements = [sibling, mirrored];

    expect(boundsOf(elements)).toEqual(asBox(referenceBounds(elements)));

    // Stated on its own too, so the failure names the missing corner rather than a diff.
    const union = referenceBounds(elements);
    const alone = referenceBounds([mirrored]);
    expect(union.maxX).toBe(alone.maxX);
    expect(union.maxY).toBe(alone.maxY);
  });

  it("frames the mirrored element, not the space beside it", () => {
    // What the camera does with that union. The frame is wider than the viewport asks
    // for, so the 2x cap does not hide the mistake: an inverted box asks for a zoom the
    // element does not need, and the mirrored element ends up outside the viewport.
    const sibling = { x: 0, y: 0, width: 400, height: 300 };
    const mirrored = { x: 1000, y: 600, width: -200, height: -100 };
    const viewport = { width: 1280, height: 800 };
    const camera = focusCamera(unionBounds([sibling, mirrored]), viewport, {
      x: 0,
      y: 0,
      scale: 1,
    });
    const box = referenceBounds([mirrored]);
    const screen = (world: number) => world * camera.scale + camera.x;
    const screenY = (world: number) => world * camera.scale + camera.y;

    expect(
      screen(box.minX),
      "the mirrored element's left edge is on screen",
    ).toBeGreaterThanOrEqual(0);
    expect(screen(box.maxX), "…and its right edge").toBeLessThanOrEqual(viewport.width);
    expect(screenY(box.minY), "its top edge is on screen").toBeGreaterThanOrEqual(0);
    expect(screenY(box.maxY), "…and its bottom edge").toBeLessThanOrEqual(viewport.height);
  });

  // What a *selected text element* is when Enter frames it, and the reason the width the
  // camera reads has to be the normalised one. `focusCamera` divides by
  // `Math.max(bounds.width, 1)`, so an unnormalised negative width made the fit come from
  // 1 world pixel and pinned the scale at the 2x cap. Wide enough here that the cap cannot
  // hide the difference: `1280 × 0.8 / 512` is where a fit stops being capped.
  it("frames a selected text element that has been mirrored, rather than capping the zoom", () => {
    const text = [{ x: 1400, y: 400, width: -900, height: -40 }];
    const viewport = { width: 1280, height: 800 };
    const camera = focusCamera(unionBounds(text), viewport, { x: 0, y: 0, scale: 1 });
    const box = referenceBounds(text);

    expect(camera.scale, "the text's own width asked for the fit, not 1 world pixel").toBeCloseTo(
      (viewport.width * 0.8) / (box.maxX - box.minX),
      5,
    );
    expect(camera.scale, "…which is below the 2x cap for an element this wide").toBeLessThan(2);
    // And the whole line is on screen, which at the cap it would not have been.
    expect(box.maxX * camera.scale + camera.x, "its right edge is on screen").toBeLessThanOrEqual(
      viewport.width,
    );
    expect(box.minX * camera.scale + camera.x, "…and its left edge").toBeGreaterThanOrEqual(0);
  });
});

describe("focusCamera", () => {
  const viewport = { width: 1000, height: 800 };

  it("zooms in so the shape fills the viewport width, minus the margin", () => {
    const bounds = { x: 100, y: 100, width: 500, height: 100 };
    const camera = focusCamera(bounds, viewport, { x: 0, y: 0, scale: 1 });
    // Default margin: the shape's width becomes 80% of the viewport's. (Comfortably
    // under the 2x cap, so the cap is not what this test is about.)
    expect(camera.scale).toBeCloseTo((viewport.width * 0.8) / bounds.width, 5);
  });

  it("centres the shape on screen", () => {
    const bounds = { x: 100, y: 100, width: 200, height: 100 };
    const camera = focusCamera(bounds, viewport, { x: 0, y: 0, scale: 1 });
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    expect(centerX * camera.scale + camera.x).toBeCloseTo(viewport.width / 2, 5);
    expect(centerY * camera.scale + camera.y).toBeCloseTo(viewport.height / 2, 5);
  });

  it("caps at the maximum zoom for a small shape rather than zooming in arbitrarily far", () => {
    const bounds = { x: 0, y: 0, width: 10, height: 10 };
    const camera = focusCamera(bounds, viewport, { x: 0, y: 0, scale: 1 });
    expect(camera.scale).toBeCloseTo(2, 5);
  });

  it("never zooms out below the current zoom, even for a shape already bigger than the margin", () => {
    const bounds = { x: 0, y: 0, width: 5000, height: 100 };
    const camera = focusCamera(bounds, viewport, { x: 0, y: 0, scale: 1.5 });
    expect(camera.scale).toBeCloseTo(1.5, 5);
  });

  it("a custom maxScale overrides the default 2x cap", () => {
    const bounds = { x: 0, y: 0, width: 10, height: 10 };
    const camera = focusCamera(bounds, viewport, { x: 0, y: 0, scale: 1 }, { maxScale: 4 });
    expect(camera.scale).toBeCloseTo(4, 5);
  });
});

describe("focus mode preference persistence", () => {
  const store = (value: string | null) => ({ getItem: () => value });

  it("defaults to on for an unset, unknown or absent store", () => {
    expect(readFocusModePreference(store(null))).toBe(true);
    expect(readFocusModePreference(store("nonsense"))).toBe(true);
    expect(readFocusModePreference(undefined)).toBe(true);
  });

  it("round-trips an explicit off", () => {
    const written: Record<string, string> = {};
    persistFocusModePreference({ setItem: (k, v) => void (written[k] = v) }, false);
    expect(readFocusModePreference({ getItem: (k) => written[k] ?? null })).toBe(false);
  });

  it("survives storage that throws", () => {
    const hostile = {
      getItem: (): string => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
    };
    expect(readFocusModePreference(hostile)).toBe(true);
    expect(() => persistFocusModePreference(hostile, false)).not.toThrow();
  });
});
