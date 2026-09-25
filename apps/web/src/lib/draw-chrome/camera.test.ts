import { describe, expect, it } from "vitest";
import { worldToScreen, zoomPercent } from "./camera.ts";

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
