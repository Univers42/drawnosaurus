import type {
  ArrowType,
  FillStyle,
  SelectionStyle,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from "@osionos/draw-engine/types";
import type { IconName } from "./icons.ts";

export type ThemeMode = "light" | "dark";

/**
 * Quick picks, five of them, as Excalidraw's `DEFAULT_ELEMENT_STROKE_PICKS` and
 * `DEFAULT_ELEMENT_BACKGROUND_PICKS` are.
 *
 * Five is not arbitrary: the row is five swatches, a divider and the current colour,
 * which is exactly what fits the panel on one line. We carried six plus a separate
 * transparent button plus the colour input — eight slots in a 188px row — so it wrapped
 * onto a second line and the current colour ended up orphaned below the presets.
 *
 * Order matters, because these are positional: black/none, red, green, blue, yellow.
 * The background row leads with transparent, which is where Excalidraw puts it rather
 * than hanging it off the side as an extra control.
 */
export const LIGHT_STROKE_SWATCHES = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];

export const DARK_STROKE_SWATCHES = ["#f8f9fa", "#ff8787", "#69db7c", "#74c0fc", "#ffd43b"];

export const LIGHT_FILL_SWATCHES = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];

export const DARK_FILL_SWATCHES = ["transparent", "#5c2b29", "#1b4729", "#183b5e", "#5e4514"];

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
export const EDGES: Array<{ label: string; value: "sharp" | "round" }> = [
  { label: "Sharp", value: "sharp" },
  { label: "Round", value: "round" },
];

/**
 * The roundness a pick writes. Named values rather than `null` for sharp, because the
 * panel shows a mixed selection as `null` — and a `null` option would read as chosen.
 */
export function roundnessFor(edges: "sharp" | "round"): number | null {
  return edges === "round" ? 8 : null;
}

/**
 * Grid spacings offered in the menu, in world units.
 *
 * 20 is Excalidraw's default; the rest are halves and doubles of it, so a drawing made
 * on one spacing stays aligned on another.
 */
export const GRID_SIZES: Array<{ label: string; value: number }> = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "40", value: 40 },
  { label: "80", value: 80 },
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

/**
 * The labels say "text" on purpose.
 *
 * The panel already has an Align row — the one that lines *elements* up with each other —
 * and its buttons are "Align left", "Align top". Naming these the same makes two
 * different operations indistinguishable to anyone reading the accessible names, which
 * includes every browser test that selects a control by name.
 */
export const TEXT_ALIGNS: Array<{ label: string; icon: IconName; value: TextAlign }> = [
  { label: "Align text left", icon: "textAlignLeft", value: "left" },
  { label: "Align text centre", icon: "textAlignCenter", value: "center" },
  { label: "Align text right", icon: "textAlignRight", value: "right" },
];

export const VERTICAL_ALIGNS: Array<{ label: string; icon: IconName; value: VerticalAlign }> = [
  { label: "Align text top", icon: "textAlignTop", value: "top" },
  { label: "Align text middle", icon: "textAlignMiddle", value: "middle" },
  { label: "Align text bottom", icon: "textAlignBottom", value: "bottom" },
];

/**
 * The arrow-type row: `actionChangeArrowType`'s options
 * (`packages/excalidraw/actions/actionProperties.tsx@1118751f:2057-2242`) without the
 * elbow, which this engine does not route — a gap in `docs/reference/console.md`.
 */
export const ARROW_TYPES: Array<{ label: string; icon: IconName; value: ArrowType }> = [
  { label: "Sharp arrow", icon: "arrowSharp", value: "sharp" },
  { label: "Curved arrow", icon: "arrowRound", value: "round" },
];

/**
 * The wrap row, a divergence addition (`docs/reference/console.md`): a text wraps in a
 * width it keeps, or grows to hold its lines. For a free text that is `autoResize`
 * (`actionTextAutoResize.ts@1118751f`, which the oracle offers only in the context menu,
 * and only one way); for a label, the engine's `wrap` — the oracle's labels always wrap.
 */
export type TextWrap = "wrap" | "grow";

export const TEXT_WRAPS: Array<{ label: string; value: TextWrap }> = [
  { label: "Wrap", value: "wrap" },
  { label: "Grow", value: "grow" },
];

type WrapFacts = Pick<SelectionStyle, "hasFreeText" | "autoResize" | "hasLabel" | "labelWrap">;

/** What the selection's texts do, or `null` when they disagree or there are none. */
export function textWrap(style: WrapFacts): TextWrap | null {
  const values: Array<boolean | null> = [];
  if (style.hasFreeText) values.push(style.autoResize === null ? null : !style.autoResize);
  if (style.hasLabel) values.push(style.labelWrap);
  const [first] = values;
  if (first === undefined || first === null || values.some((value) => value !== first)) {
    return null;
  }
  return first ? "wrap" : "grow";
}

/**
 * What a pick writes, for the kinds of text selected: `setTextAutoResize` for free texts,
 * `setLabelWrap` for labels. ponytail: a selection holding both takes two engine calls,
 * so two steps of undo; one engine call for both is the upgrade.
 */
export function wrapWrites(
  style: Pick<WrapFacts, "hasFreeText" | "hasLabel">,
  wrap: TextWrap,
): { autoResize?: boolean; labelWrap?: boolean } {
  return {
    ...(style.hasFreeText ? { autoResize: wrap === "grow" } : {}),
    ...(style.hasLabel ? { labelWrap: wrap === "wrap" } : {}),
  };
}
