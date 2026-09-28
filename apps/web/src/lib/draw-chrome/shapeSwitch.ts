/**
 * Tab's shape switch, the chrome's half — the engine switches the types
 * (`engine/convert.rs`), the chrome opens, steps and closes the panel that shows it, as
 * Excalidraw's `ConvertElementTypePopup` does (`App.tsx@1118751f:5543-5572`).
 *
 * What type the selection is at, and which of the seven the panel offers, are the engine's
 * to answer — for a line or an arrow that is a reading of `roundness` and `elbowed`, and a
 * host working it out from the scene JSON would be running an engine formula here. What is
 * left here is the keys and where the panel hangs.
 */
import { worldToScreen } from "@osionos/draw-engine/cameraMath";
import type { ConversionType, FlowchartShape, LinearType } from "@osionos/draw-engine/types";
import type { Box } from "./camera.ts";
import type { IconName } from "./icons.ts";

export type SwitchKey = "open" | "forward" | "back" | "close";

type KeyPress = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">;

/**
 * What a key does to the switch. The first Tab (or Shift+Tab) only opens it, each one
 * after that switches the selection forward (or back), and Escape closes it.
 *
 * Tab is the board's only while there is something to switch, where the oracle takes it
 * from the board whatever is selected: with nothing to switch it moves focus on, so the
 * board is never a keyboard trap.
 */
export function switchKey(
  event: KeyPress,
  state: { open: boolean; switchable: boolean; onBoard: boolean },
): SwitchKey | null {
  if (event.key === "Escape") return state.open ? "close" : null;
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (!state.onBoard || !state.switchable) return null;
  if (!state.open) return "open";
  return event.shiftKey ? "back" : "forward";
}

/** The three closed shapes, 1/2/3, as a growing flowchart offers them. */
export const CLOSED_SHAPES: readonly FlowchartShape[] = ["rectangle", "diamond", "ellipse"];

/**
 * The four a line or an arrow switches between, in the order Tab walks them —
 * `LINEAR_TYPES` (`ConvertElementTypePopup.tsx@1118751f:113-120`), which is the same order
 * the panel lists them in.
 */
export const LINEAR_TYPES: readonly LinearType[] = [
  "line",
  "sharpArrow",
  "curvedArrow",
  "elbowArrow",
];

/**
 * The types the panel offers, given the type the engine says the selection is at: the
 * three closed shapes, or the four linear ones. A selection of nothing switchable, or of
 * two kinds at once, is offered nothing — the oracle's panel closes rather than offering
 * a choice between two families
 * (`getConversionTypeFromElements`, `ConvertElementTypePopup.tsx@1118751f:641-664`).
 */
export function switchTypes(current: ConversionType | null): readonly ConversionType[] {
  if (!current) return [];
  return current === "line" || LINEAR_TYPES.includes(current as LinearType)
    ? LINEAR_TYPES
    : CLOSED_SHAPES;
}

/** The title each of the four linear types' button carries. */
const LINEAR_LABELS: Record<LinearType, string> = {
  line: "Line",
  sharpArrow: "Sharp arrow",
  curvedArrow: "Curved arrow",
  elbowArrow: "Elbow arrow",
};

/**
 * The glyph each linear type is drawn with. The conversion names and the icon names were
 * chosen on different sides of the wire, so they do not line up: `sharpArrow` here,
 * `arrowSharp` in `icons.ts`.
 */
const LINEAR_ICONS: Record<LinearType, IconName> = {
  line: "line",
  sharpArrow: "arrowSharp",
  curvedArrow: "arrowRound",
  elbowArrow: "arrowElbow",
};

/** The title a type's button carries, and the glyph that draws it. */
export function typeLabel(type: ConversionType): string {
  return isLinear(type) ? LINEAR_LABELS[type] : capitalise(type);
}

export function typeIcon(type: ConversionType): IconName {
  return isLinear(type) ? LINEAR_ICONS[type] : type;
}

export function isLinearType(type: string): type is LinearType {
  return (LINEAR_TYPES as readonly string[]).includes(type);
}

const isLinear = (type: ConversionType): type is LinearType => isLinearType(type);

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Where the panel hangs: 8px left of the selection's bottom-left corner and 18 zoomed
 * pixels below it (`GAP_HORIZONTAL`, `GAP_VERTICAL + 8`). The oracle turns that corner
 * with a lone rotated shape; this takes the unrotated box, as the flowchart strip does.
 */
export function switchPanelAt(
  bounds: Box,
  camera: { x: number; y: number; scale: number },
): { x: number; y: number } {
  const { x, y } = worldToScreen(camera, bounds.x, bounds.y + bounds.height);
  return { x: x - 8, y: y + 18 * camera.scale };
}
