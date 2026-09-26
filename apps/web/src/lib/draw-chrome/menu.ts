import type { Arrowhead, DrawElement, SelectionStyle } from "@osionos/draw-engine/types";
import { isLinearElement } from "@osionos/draw-engine/json";

export interface Size {
  width: number;
  height: number;
}

export interface MenuPoint {
  left: number;
  top: number;
}

/** What the right-click landed on — drives which menu sections render. */
export interface MenuElementInfo {
  /** The heads of the first line or arrow selected that is not locked. */
  linear: { start: Arrowhead; end: Arrowhead } | null;
  locked: boolean;
  multi: boolean;
  grouped: boolean;
  /** The embed whose link can be changed: one, alone and unlocked. */
  embedId: string | null;
  /** The image that can be vectorized: one, alone and unlocked. */
  vectorizeId: string | null;
  /** The text entries on offer — see `textMenu`. */
  text: TextMenu;
}

/**
 * The element menu's text entries, which Excalidraw lists between Group and Ungroup
 * (`components/App.tsx@1118751f:13775-13780`). Each is offered on its action's own
 * predicate, which the engine answers in `selectionStyle()`.
 */
export interface TextMenu {
  /** "Enable text auto-resizing": one text, keeping a fixed width (`actions/actionTextAutoResize.ts@1118751f:27-34`). */
  autoResize: boolean;
  /** "Unbind text" (`actions/actionBoundText.tsx@1118751f:64-68`). */
  unbind: boolean;
  /** "Bind text to the container" (`:128-154`). */
  bind: boolean;
  /** "Wrap text in a container" (`:262-268`). */
  wrap: boolean;
}

export type TextMenuFacts = Pick<
  SelectionStyle,
  "count" | "hasFreeText" | "autoResize" | "canBindText" | "canUnbindText"
>;

const NO_TEXT_MENU: TextMenu = { autoResize: false, unbind: false, bind: false, wrap: false };

export function textMenu(style: TextMenuFacts): TextMenu {
  return {
    // One element and a free text among it: that text is the element.
    autoResize: style.count === 1 && style.hasFreeText && style.autoResize === false,
    unbind: style.canUnbindText,
    bind: style.canBindText,
    wrap: style.hasFreeText,
  };
}

/** The oracle's own picker order (`actions/actionProperties.tsx@1118751f`'s
 *  `getArrowheadOptions`): visible defaults first, then the plain heads it hides until one
 *  is already picked, then the cardinality/crow's-foot group ER diagrams use. */
export const ARROWHEAD_KINDS: Arrowhead[] = [
  "none",
  "arrow",
  "triangle",
  "triangle_outline",
  "circle",
  "circle_outline",
  "diamond",
  "diamond_outline",
  "bar",
  "cardinality_one",
  "cardinality_many",
  "cardinality_one_or_many",
  "cardinality_exactly_one",
  "cardinality_zero_or_one",
  "cardinality_zero_or_many",
];

export const ARROWHEAD_GLYPH: Record<Arrowhead, string> = {
  none: "—",
  arrow: "▸",
  triangle: "▶",
  triangle_outline: "▷",
  circle: "●",
  circle_outline: "○",
  diamond: "◆",
  diamond_outline: "◇",
  bar: "|",
  // Crow's-foot notation: a single tick for "one", a fork for "many", combined or doubled
  // for the compound markers.
  cardinality_one: "⊣",
  cardinality_many: "⋔",
  cardinality_one_or_many: "⊣⋔",
  cardinality_exactly_one: "‖",
  cardinality_zero_or_one: "○⊣",
  cardinality_zero_or_many: "○⋔",
};

/** `labels.arrowhead_*` in the oracle's own `locales/en.json`. */
export const ARROWHEAD_LABEL: Record<Arrowhead, string> = {
  none: "None",
  arrow: "Arrow",
  triangle: "Triangle",
  triangle_outline: "Triangle (outline)",
  circle: "Circle",
  circle_outline: "Circle (outline)",
  diamond: "Diamond",
  diamond_outline: "Diamond (outline)",
  bar: "Bar",
  cardinality_one: "Cardinality (one)",
  cardinality_many: "Cardinality (many)",
  cardinality_one_or_many: "Cardinality (one or many)",
  cardinality_exactly_one: "Cardinality (exactly one)",
  cardinality_zero_or_one: "Cardinality (zero or one)",
  cardinality_zero_or_many: "Cardinality (zero or many)",
};

export function clampMenuPosition(
  x: number,
  y: number,
  menu: Size,
  host: Size,
  padding = 4,
): MenuPoint {
  return {
    left: Math.max(padding, Math.min(x, host.width - menu.width - padding)),
    top: Math.max(padding, Math.min(y, host.height - menu.height - padding)),
  };
}

export function menuElementFromSelection(
  selected: readonly DrawElement[],
  locked: boolean,
  grouped: boolean,
  /** The engine's `selectionStyle()`, for the text entries; none are offered without it. */
  style?: TextMenuFacts,
): MenuElementInfo | null {
  if (selected.length === 0) return null;

  // Not a locked one: the engine passes it by, so a head picked for it would change only
  // the next arrow's while the row showed it picked.
  const linear = selected.find((element) => isLinearElement(element) && !element.locked);
  const only = selected.length === 1 && !locked ? selected[0] : undefined;
  return {
    linear: linear
      ? {
          start: linear.startArrowhead ?? "none",
          end: linear.endArrowhead ?? (linear.type === "arrow" ? "arrow" : "none"),
        }
      : null,
    locked,
    multi: selected.length > 1,
    grouped,
    embedId: only?.type === "embed" ? only.id : null,
    vectorizeId: only?.type === "image" ? only.id : null,
    text: style ? textMenu(style) : NO_TEXT_MENU,
  };
}
