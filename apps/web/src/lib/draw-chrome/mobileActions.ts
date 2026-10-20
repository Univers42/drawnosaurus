/**
 * The compact style strip.
 *
 * Port of the oracle's `MobileShapeActions` (`packages/excalidraw/components/Actions.tsx@1118751f:731-880`)
 * onto this chrome's own predicate row: `getShapeActions` (`shapeActions.ts`) answers the
 * same questions its `getShapeActionPredicates` does, so the strip reads that instead of a
 * second copy. Rows coalesce as the oracle'sCombined popovers do: one button for the shape
 * properties that travel together, one for the text ones, one for the selection's layer
 * actions. Width decides where duplicate and delete sit, exactly as measured there.
 */
import type { ShapeActions } from "./shapeActions.ts";

/** `WIDTH` (`Actions.tsx@1118751f:759`). */
export const MOBILE_ACTION_WIDTH = 32;
/** `GAP` (`Actions.tsx@1118751f:760`). */
export const MOBILE_ACTION_GAP = 6;

/** `MIN_ACTIONS = 9` — "7 actions + 2 for undo/redo" (`Actions.tsx@1118751f:753-755`). */
export const MOBILE_STRIP_MIN_ACTIONS = 9;
/** `MIN_WIDTH` (`Actions.tsx@1118751f:757-758`). */
export const MOBILE_STRIP_MIN_WIDTH =
  MOBILE_STRIP_MIN_ACTIONS * MOBILE_ACTION_WIDTH +
  (MOBILE_STRIP_MIN_ACTIONS - 1) * MOBILE_ACTION_GAP;
/** `ADDITIONAL_WIDTH` (`Actions.tsx@1118751f:761`). */
export const MOBILE_STRIP_SLOT_WIDTH = MOBILE_ACTION_WIDTH + MOBILE_ACTION_GAP;

/** What the strip can hold: stroke, background, the shape-trio popover, the arrow pair
 *  popover, the polygon toggle, the text popover, the figure popover, opacity and the
 *  layer popover — the oracle's left group, one button each. */
export type StripItem =
  | "stroke"
  | "background"
  | "shape properties"
  | "arrow properties"
  | "polygon"
  | "text"
  | "figure"
  | "opacity"
  | "layer actions";

export interface MobileActionBarPlan {
  /** The left group, in bar order — the properties the selection can act on. */
  left: readonly StripItem[];
  /** The right group: undo and redo always, duplicate and delete as room allows. */
  right: readonly (StripItem | "duplicate" | "delete" | "undo" | "redo")[];
  /** What stayed in the layer popover because the row could not hold it. */
  overflow: readonly ("duplicate" | "delete")[];
}

/** `showDeleteOutside` (`Actions.tsx@1118751f:771-773`): one slot past the minimum. */
export function deleteOutsideActions(width: number): boolean {
  return width >= MOBILE_STRIP_MIN_WIDTH + MOBILE_STRIP_SLOT_WIDTH;
}

/** `showDuplicateOutside` (`Actions.tsx@1118751f:774`): two slots past it. */
export function duplicateOutsideActions(width: number): boolean {
  return width >= MOBILE_STRIP_MIN_WIDTH + 2 * MOBILE_STRIP_SLOT_WIDTH;
}

export function mobileActionBarPlan(
  width: number,
  actions: ShapeActions,
): MobileActionBarPlan {
  const left: StripItem[] = [];
  if (actions.strokeColor) left.push("stroke");
  if (actions.backgroundColor) left.push("background");
  // `CombinedShapeProperties` (`Actions.tsx@1118751f` uses one popover for the rows a
  // shape shares; hidden entirely when none applies).
  if (actions.fill || actions.strokeWidth || actions.strokeStyle || actions.sloppiness) {
    left.push("shape properties");
  }
  if (actions.arrowType || actions.arrowheads) left.push("arrow properties");
  if (actions.polygon) left.push("polygon");
  // The font-family button and `CombinedTextProperties` as one, on the grounds that two
  // 32px buttons for one selection's typing is a row of near-identical squares — the
  // oracle's own reason for combining rows at all. A deliberate narrowing: every text
  // property stays reachable, only the second button's slot goes.
  if (actions.text || actions.textAlign || actions.verticalAlign || actions.wrap) {
    left.push("text");
  }
  if (actions.figureKind) left.push("figure");
  if (actions.opacity) left.push("opacity");
  if (actions.layers || actions.mirror || actions.group || actions.align || actions.distribute) {
    left.push("layer actions");
  }

  const promoDelete = deleteOutsideActions(width);
  const promoDuplicate = duplicateOutsideActions(width);
  const right: MobileActionBarPlan["right"] = ["undo", "redo"];
  if (promoDuplicate) right.push("duplicate");
  if (promoDelete) right.push("delete");

  return {
    left,
    right,
    overflow: [
      ...(promoDuplicate ? [] : (["duplicate"] as const)),
      ...(promoDelete ? [] : (["delete"] as const)),
    ],
  };
}
