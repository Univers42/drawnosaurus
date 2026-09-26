import { describe, expect, it, vi } from "vitest";
import {
  animateCamera,
  boundsOf,
  easeInOutCubic,
  fitCamera,
  focusCamera,
  lerpCamera,
  persistFocusModePreference,
  readFocusModePreference,
  revealPan,
  setCameraExact,
  worldToScreen,
  zoomPercent,
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
  it("matches the engine: wx * scale + camera.x", () => {
    expect(worldToScreen({ x: 100, y: 50, scale: 2 }, 10, 20)).toEqual({ sx: 120, sy: 90 });
  });

  it("is the inverse of the cursor send path (sx - cam) / scale", () => {
    const camera = { x: -40, y: 12, scale: 1.5 };
    const world = { x: 200, y: -30 };
    const screen = worldToScreen(camera, world.x, world.y);
    expect((screen.sx - camera.x) / camera.scale).toBeCloseTo(world.x);
    expect((screen.sy - camera.y) / camera.scale).toBeCloseTo(world.y);
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
    const tiny = fitCamera({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { width: 1000, height: 1000 });
    expect(tiny.scale).toBeLessThanOrEqual(30);
    const huge = fitCamera(
      { minX: 0, minY: 0, maxX: 1_000_000, maxY: 1_000_000 },
      { width: 100, height: 100 },
    );
    expect(huge.scale).toBeGreaterThanOrEqual(0.1);
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
});

describe("revealPan", () => {
  const viewport = { width: 800, height: 600 };
  const camera = { x: 0, y: 0, scale: 1 };

  it("does nothing when the target already fits with room to spare", () => {
    expect(revealPan(viewport, camera, { x: 100, y: 100, width: 50, height: 50 })).toBeNull();
  });

  it("scrolls right and down to reveal a node past the far edge", () => {
    const pan = revealPan(viewport, camera, { x: 900, y: 700, width: 40, height: 40 });
    expect(pan).not.toBeNull();
    expect(pan!.dx).toBeLessThan(0);
    expect(pan!.dy).toBeLessThan(0);

    // Applying the pan (added onto camera.x/y, panBy's own units) leaves the node's
    // near edge sitting exactly at the padding, not merely closer to it.
    const padded = { x: camera.x + pan!.dx, y: camera.y + pan!.dy, scale: 1 };
    const right = 900 * padded.scale + padded.x + 40;
    expect(right).toBeCloseTo(viewport.width - 48);
  });

  it("scrolls left and up to reveal a node before the near edge", () => {
    const pan = revealPan(viewport, camera, { x: -200, y: -100, width: 30, height: 30 });
    expect(pan).not.toBeNull();
    expect(pan!.dx).toBeGreaterThan(0);
    expect(pan!.dy).toBeGreaterThan(0);
  });

  it("accounts for zoom: the same world box needs a bigger pan at a higher scale", () => {
    const target = { x: 900, y: 100, width: 40, height: 40 };
    const at1x = revealPan(viewport, { x: 0, y: 0, scale: 1 }, target)!;
    const at2x = revealPan(viewport, { x: 0, y: 0, scale: 2 }, target)!;
    expect(Math.abs(at2x.dx)).toBeGreaterThan(Math.abs(at1x.dx));
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
