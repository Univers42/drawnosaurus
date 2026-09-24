import { describe, expect, it } from "vitest";
import { screenFontPx, worldToScreen, zoomPercent } from "./camera.ts";

describe("screenFontPx", () => {
  it("scales a world font size by the zoom", () => {
    expect(screenFontPx(20, 16, 100)).toBe(20);
    expect(screenFontPx(20, 16, 250)).toBe(50);
  });

  it("falls back to the element's size when the request carries none", () => {
    // What an engine that sent `font_size` looked like to a host reading `fontSize`: a
    // NaN font size, which is invalid CSS, so the editor drew in the browser's 13.33px.
    expect(screenFontPx(undefined, 28, 100)).toBe(28);
    expect(screenFontPx(Number.NaN, 28, 200)).toBe(56);
    expect(screenFontPx(Number.POSITIVE_INFINITY, 28, 100)).toBe(28);
    expect(screenFontPx(0, 28, 100)).toBe(28);
  });

  it("is never NaN, whatever it is given", () => {
    expect(screenFontPx(undefined, Number.NaN, 100)).toBe(20);
  });
});

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
