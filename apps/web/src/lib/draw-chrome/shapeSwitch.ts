/**
 * Tab's shape switch, the chrome's half — the engine switches the shapes
 * (`engine/convert.rs`), the chrome opens, steps and closes the panel that shows it, as
 * Excalidraw's `ConvertElementTypePopup` does (`App.tsx@1118751f:5543-5572`).
 */
import { worldToScreen } from "@osionos/draw-engine/camera";
import type { FlowchartShape } from "@osionos/draw-engine/types";
import type { Box } from "./camera.ts";

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

const SHAPES: readonly string[] = ["rectangle", "diamond", "ellipse"] satisfies FlowchartShape[];

/** The type the switchable shapes among `elements` share — the one the panel shows pressed. */
export function sharedShape(elements: { type: string }[]): FlowchartShape | null {
  const kinds = new Set(
    elements.map((element) => element.type).filter((type) => SHAPES.includes(type)),
  );
  return kinds.size === 1 ? ([...kinds][0] as FlowchartShape) : null;
}

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
