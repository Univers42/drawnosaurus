import type { FillStyle, StrokeStyle } from "@osionos/draw-engine/types";

export type ThemeMode = "light" | "dark";

export const LIGHT_STROKE_SWATCHES = [
  "#1e1e1e",
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#9c36b5",
];

export const DARK_STROKE_SWATCHES = [
  "#f8f9fa",
  "#ff8787",
  "#69db7c",
  "#74c0fc",
  "#ffd43b",
  "#da77f2",
];

export const LIGHT_FILL_SWATCHES = [
  "#ffc9c9",
  "#b2f2bb",
  "#a5d8ff",
  "#ffec99",
  "#eebefa",
  "#d0ebff",
];

export const DARK_FILL_SWATCHES = [
  "#5c2b29",
  "#1b4729",
  "#183b5e",
  "#5e4514",
  "#4d1d5c",
  "#1c4456",
];

export function getStrokeSwatches(themeMode: ThemeMode = "light"): string[] {
  return themeMode === "dark" ? DARK_STROKE_SWATCHES : LIGHT_STROKE_SWATCHES;
}

export function getFillSwatches(themeMode: ThemeMode = "light"): string[] {
  return themeMode === "dark" ? DARK_FILL_SWATCHES : LIGHT_FILL_SWATCHES;
}

// Keep backward compatibility
export const STROKE_SWATCHES = LIGHT_STROKE_SWATCHES;
export const FILL_SWATCHES = LIGHT_FILL_SWATCHES;

export const WIDTHS: Array<{ label: string; value: number }> = [
  { label: "S", value: 1 },
  { label: "M", value: 2 },
  { label: "L", value: 4 },
];

export const STROKE_STYLES: Array<{ label: string; value: StrokeStyle }> = [
  { label: "──", value: "solid" },
  { label: "– –", value: "dashed" },
  { label: "···", value: "dotted" },
];

/**
 * The canvas paper colours, matching Excalidraw's top picks for the canvas background:
 * white, a near-white grey, a cool tint, a warm cream and a pink-ish neutral.
 */
export const CANVAS_BACKGROUNDS: string[] = ["#ffffff", "#f8f9fa", "#f5faff", "#fffce8", "#fdf8f6"];

export const SLOPPINESS: Array<{ label: string; value: number }> = [
  { label: "Fine", value: 0 },
  { label: "Rough", value: 1 },
  { label: "Extra", value: 2 },
];

/**
 * Excalidraw's "Edges", which is a mode and not a radius.
 *
 * Their elements carry `roundness: {type: 3}` with no value at all, and the engine gives
 * a rounded shape a size-adaptive radius — a small rectangle gets a proportional corner,
 * a large one a fixed 32. The panel used to offer a 0-40px slider, which was a promise
 * nothing kept: measured on the canvas, a radius of 1, 8, 32 and 64 all produced pixel-
 * identical corners, because only "is it rounded" was ever read.
 */
export const EDGES: Array<{ label: string; value: number | null }> = [
  { label: "Sharp", value: null },
  { label: "Round", value: 8 },
];

export const FILL_STYLES: Array<{ label: string; value: FillStyle }> = [
  { label: "Hachure", value: "hachure" },
  { label: "Cross", value: "cross-hatch" },
  { label: "Solid", value: "solid" },
];

export const FONT_SIZES: Array<{ label: string; value: number }> = [
  { label: "S", value: 16 },
  { label: "M", value: 20 },
  { label: "L", value: 28 },
  { label: "XL", value: 36 },
];
