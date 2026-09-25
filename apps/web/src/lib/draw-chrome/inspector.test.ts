import { describe, expect, it } from "vitest";
import {
  CANVAS_BACKGROUNDS,
  DARK_FILL_SWATCHES,
  DARK_STROKE_SWATCHES,
  EDGES,
  roundnessFor,
  GRID_SIZES,
  LIGHT_FILL_SWATCHES,
  LIGHT_STROKE_SWATCHES,
  getFillSwatches,
  getStrokeSwatches,
} from "./inspector.ts";

describe("quick colour picks", () => {
  const rows = {
    "light stroke": LIGHT_STROKE_SWATCHES,
    "dark stroke": DARK_STROKE_SWATCHES,
    "light fill": LIGHT_FILL_SWATCHES,
    "dark fill": DARK_FILL_SWATCHES,
  };

  it("offers exactly five, as Excalidraw does", () => {
    // Five picks + a divider + the current colour is what fits the panel on one line.
    // Six plus a separate transparent button plus the colour input wrapped onto a
    // second row and orphaned the current colour below the presets.
    for (const [name, row] of Object.entries(rows)) {
      expect(row, name).toHaveLength(5);
    }
  });

  it("has no duplicates within a row", () => {
    for (const [name, row] of Object.entries(rows)) {
      expect(new Set(row).size, name).toBe(row.length);
    }
  });

  it("puts transparent first in the fill rows and nowhere in the stroke rows", () => {
    // Positional, like theirs: transparent is one of the five rather than an extra
    // control hung off the side.
    expect(LIGHT_FILL_SWATCHES[0]).toBe("transparent");
    expect(DARK_FILL_SWATCHES[0]).toBe("transparent");
    expect(LIGHT_STROKE_SWATCHES).not.toContain("transparent");
    expect(DARK_STROKE_SWATCHES).not.toContain("transparent");
  });

  it("gives every non-transparent pick a hex colour", () => {
    for (const [name, row] of Object.entries(rows)) {
      for (const color of row) {
        if (color === "transparent") continue;
        expect(color, `${name}: ${color}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("hands back the row for the theme", () => {
    expect(getStrokeSwatches("light")).toBe(LIGHT_STROKE_SWATCHES);
    expect(getStrokeSwatches("dark")).toBe(DARK_STROKE_SWATCHES);
    expect(getFillSwatches("light")).toBe(LIGHT_FILL_SWATCHES);
    expect(getFillSwatches("dark")).toBe(DARK_FILL_SWATCHES);
    expect(getStrokeSwatches()).toBe(LIGHT_STROKE_SWATCHES);
  });

  it("keeps the dark rows distinct from the light ones", () => {
    // A dark stroke row that reused the light colours would be invisible on a dark
    // canvas, which is the whole reason there are two.
    expect(DARK_STROKE_SWATCHES).not.toEqual(LIGHT_STROKE_SWATCHES);
    expect(DARK_FILL_SWATCHES).not.toEqual(LIGHT_FILL_SWATCHES);
  });
});

describe("the other option rows", () => {
  it("offers sharp and round edges, and nothing between", () => {
    // Excalidraw's roundness is a mode, not a radius: their elements carry
    // `roundness: {type: 3}` with no value at all.
    expect(EDGES.map((e) => e.label)).toEqual(["Sharp", "Round"]);
    expect(EDGES.map((e) => roundnessFor(e.value))).toEqual([null, 8]);
  });

  it("names both edges, so a mixed selection (null) marks neither as chosen", () => {
    expect(EDGES.map((e) => e.value)).not.toContain(null);
  });

  it("offers grid spacings that stay aligned with each other", () => {
    // Halves and doubles of 20, so a drawing made on one spacing still lands on
    // another's intersections.
    const values = GRID_SIZES.map((g) => g.value);
    expect(values).toContain(20);
    for (const v of values) {
      expect(Math.max(v, 20) % Math.min(v, 20), `${v} vs 20`).toBe(0);
    }
  });

  it("offers canvas backgrounds that are all light enough to draw on", () => {
    for (const color of CANVAS_BACKGROUNDS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      const value = parseInt(color.slice(1), 16);
      const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
      expect((r + g + b) / 3, color).toBeGreaterThan(200);
    }
  });
});
