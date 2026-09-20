import type { FillStyle, StrokeStyle } from "@osionos/draw-engine/types";

export const STROKE_SWATCHES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
export const FILL_SWATCHES = ["#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];

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
