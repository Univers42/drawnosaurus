import { describe, expect, it, vi } from "vitest";
import { EraserTrail, smoothOutlinePath } from "./eraserTrail.ts";

describe("EraserTrail", () => {
  it("initializes without points and not active", () => {
    const trail = new EraserTrail();
    expect(trail.active).toBe(false);
    expect(trail.computePath()).toBe("");
  });

  it("handles start and single point", () => {
    const trail = new EraserTrail();
    trail.start(100, 200);
    expect(trail.active).toBe(true);
    const path = trail.computePath();
    expect(path).toContain("M ");
    expect(path).toContain("a ");
  });

  it("generates smooth outline path for multiple points", () => {
    const trail = new EraserTrail({ streamline: 0 });
    trail.start(10, 10);
    trail.addPoint(50, 50);
    trail.addPoint(100, 50);
    trail.addPoint(150, 100);

    const path = trail.computePath();
    expect(path).toContain("M ");
    expect(path).toContain("Q ");
    expect(path).toContain("Z");
  });

  it("decays points when time exceeds decayTime", () => {
    const onUpdate = vi.fn();
    const trail = new EraserTrail({ decayTime: 200, onUpdate });
    trail.start(10, 10);
    trail.addPoint(20, 20);

    const futureTime = performance.now() + 300;
    const path = trail.computePath(futureTime);
    // After decayTime has passed, path should be empty
    expect(path).toBe("");
  });

  it("smoothOutlinePath handles small point sets gracefully", () => {
    expect(smoothOutlinePath([])).toBe("");
    expect(smoothOutlinePath([{ x: 1, y: 1 }])).toBe("");
    expect(
      smoothOutlinePath([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe("");

    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    const path = smoothOutlinePath(triangle);
    expect(path).toContain("M 0.0,0.0");
    expect(path).toContain("Q");
    expect(path).toContain("Z");
  });

  it("clear cancels and clears trail", () => {
    const onUpdate = vi.fn();
    const trail = new EraserTrail({ onUpdate });
    trail.start(50, 50);
    expect(trail.active).toBe(true);
    trail.clear();
    expect(trail.active).toBe(false);
    expect(onUpdate).toHaveBeenCalledWith("");
  });
});
