import { describe, expect, it } from "vitest";
import { zoomPercent } from "./camera.ts";

describe("zoomPercent", () => {
  it("treats scale 1 as 100%", () => {
    expect(zoomPercent(1)).toBe(100);
  });

  it("rounds a fractional camera scale", () => {
    expect(zoomPercent(1.256)).toBe(126);
    expect(zoomPercent(0.333)).toBe(33);
  });
});
