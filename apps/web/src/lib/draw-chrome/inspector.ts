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

export const SLOPPINESS: Array<{ label: string; value: number }> = [
  { label: "Fine", value: 0 },
  { label: "Rough", value: 1 },
  { label: "Extra", value: 2 },
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
