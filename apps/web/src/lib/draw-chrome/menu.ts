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

export const ARROWHEAD_KINDS: Arrowhead[] = ["none", "arrow", "triangle", "dot", "diamond", "bar"];

export const ARROWHEAD_GLYPH: Record<Arrowhead, string> = {
  none: "—",
  arrow: "▸",
  triangle: "▶",
  dot: "●",
  diamond: "◆",
  bar: "|",
};

export const ARROWHEAD_LABEL: Record<Arrowhead, string> = {
  none: "None",
  arrow: "Arrow",
  triangle: "Triangle",
  dot: "Dot",
  diamond: "Diamond",
  bar: "Bar",
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
