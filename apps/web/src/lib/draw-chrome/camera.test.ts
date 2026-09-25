import { describe, expect, it } from "vitest";
import { boundsOf, easeOutProgress, revealPan, worldToScreen, zoomPercent } from "./camera.ts";

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

describe("easeOutProgress", () => {
  it("starts at 0 and ends at 1", () => {
    expect(easeOutProgress(0, 300)).toBe(0);
    expect(easeOutProgress(300, 300)).toBe(1);
  });

  it("never overshoots past the duration", () => {
    expect(easeOutProgress(500, 300)).toBe(1);
  });

  it("eases out: past the midpoint sooner than a linear ramp would", () => {
    expect(easeOutProgress(150, 300)).toBeGreaterThan(0.5);
  });
});
