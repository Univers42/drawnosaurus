import { describe, expect, it } from "vitest";
import {
  CANVAS_BACKGROUNDS,
  DARK_FILL_SWATCHES,
  DARK_STROKE_SWATCHES,
  EDGES,
  FIGURE_KIND_OPTIONS,
  FIGURE_RATIO_RANGE,
  FIGURE_SIDES_RANGE,
  roundnessFor,
  GRID_SIZES,
  LIGHT_FILL_SWATCHES,
  LIGHT_STROKE_SWATCHES,
  STICKY_NOTE_BACKGROUND_PICKS,
  colorRow,
  getFillSwatches,
  getStrokeSwatches,
  textWrap,
} from "./inspector.ts";
import { ICONS } from "./icons.ts";

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

describe("a note's colour rows", () => {
  it("offers a note the oracle's background picks, the default paper first", () => {
    // `STICKY_NOTE_BACKGROUND_PICKS` (`common/src/colors.ts@1118751f:273-281`).
    expect(STICKY_NOTE_BACKGROUND_PICKS).toEqual([
      "#ffdf6b",
      "#fcc2d7",
      "#b2f2bb",
      "#a5d8ff",
      "#ffd8a8",
    ]);
    expect(colorRow("background", "sticky", "light")).toEqual({
      label: "Background",
      picks: STICKY_NOTE_BACKGROUND_PICKS,
      hideTransparent: true,
    });
  });

  it("calls a note's stroke its text colour, with the regular picks", () => {
    // A note has no stroke: its "stroke" is its text's and its footer's ink
    // (`actionProperties.tsx@1118751f:405-408`).
    expect(colorRow("stroke", "sticky", "dark")).toEqual({
      label: "Text color",
      picks: DARK_STROKE_SWATCHES,
      hideTransparent: true,
    });
  });

  it("keeps the regular rows for a mixed selection and for everything else", () => {
    for (const domain of ["regular", "mixed"] as const) {
      expect(colorRow("stroke", domain, "light"), domain).toEqual({
        label: "Stroke",
        picks: LIGHT_STROKE_SWATCHES,
        hideTransparent: false,
      });
      expect(colorRow("background", domain, "light"), domain).toEqual({
        label: "Background",
        picks: LIGHT_FILL_SWATCHES,
        hideTransparent: false,
      });
    }
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

describe("the Shapes picker's kind row", () => {
  it("offers all six kinds, each with an icon that exists", () => {
    expect(FIGURE_KIND_OPTIONS.map((k) => k.value)).toEqual([
      "polygon",
      "star",
      "parallelogram",
      "trapezoid",
      "cylinder",
      "document",
    ]);
    for (const option of FIGURE_KIND_OPTIONS) {
      expect(ICONS[option.icon], option.label).toBeDefined();
      expect(ICONS[option.icon].length, option.label).toBeGreaterThan(0);
    }
  });

  it("mirrors the engine's SIDES_RANGE/RATIO_RANGE", () => {
    expect(FIGURE_SIDES_RANGE).toEqual({ min: 3, max: 12 });
    expect(FIGURE_RATIO_RANGE.min).toBe(0.05);
    expect(FIGURE_RATIO_RANGE.max).toBe(0.95);
  });
});

describe("the wrap row", () => {
  const facts = {
    hasFreeText: false,
    autoResize: null,
    hasLabel: false,
    labelWrap: null,
  };

  it("reads a free text's fixed width, and a label's wrapping, as wrapping", () => {
    expect(textWrap({ ...facts, hasFreeText: true, autoResize: false })).toBe("wrap");
    expect(textWrap({ ...facts, hasFreeText: true, autoResize: true })).toBe("grow");
    expect(textWrap({ ...facts, hasLabel: true, labelWrap: true })).toBe("wrap");
    expect(textWrap({ ...facts, hasLabel: true, labelWrap: false })).toBe("grow");
  });

  it("marks nothing for a mixed selection, or one with no text", () => {
    expect(textWrap({ ...facts, hasFreeText: true, autoResize: null })).toBeNull();
    const both = { hasFreeText: true, autoResize: true, hasLabel: true, labelWrap: true };
    expect(textWrap(both)).toBeNull();
    expect(textWrap({ ...both, labelWrap: false })).toBe("grow");
    expect(textWrap(facts)).toBeNull();
  });
});
