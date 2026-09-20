import type { Arrowhead, DrawElement } from "@osionos/draw-engine/types";
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
  linear: { start: Arrowhead; end: Arrowhead } | null;
  locked: boolean;
  multi: boolean;
  grouped: boolean;
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
): MenuElementInfo | null {
  if (selected.length === 0) return null;

  const linear = selected.find((element) => isLinearElement(element));
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
  };
}
