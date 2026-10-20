/**
 * The tablet's compact style panel.
 *
 * Port of the oracle's `CompactShapeActions` (`packages/excalidraw/components/Actions.tsx
 * @1118751f:612-724`), which its own comment calls "the collapsed, popover-driven layout
 * used on tablets and on desktop when the UI is in 'compact' mode". The oracle reaches
 * that panel through `deriveStylesPanelMode`
 * (`packages/common/src/editorInterface.ts@1118751f:152-164`): a phone gets `mobile`, a
 * tablet gets `compact`, and only the desktop chooses for itself.
 *
 * The panel is a column of icon buttons, one per group of controls, each opening a
 * popover (`Actions.scss@1118751f:95-179`): 32px buttons in a column with an 8px gap,
 * the rows that travel together coalesced into one popover — the oracle's own reason for
 * combining them (`CombinedShapeProperties`, `CombinedArrowProperties`,
 * `CombinedTextProperties`, `CombinedExtraActions`).
 *
 * This module is the plan: which controls a selection shows, and in which order. The
 * order is the oracle's, because the order is the panel. The predicates are this chrome's
 * own (`shapeActions.ts` answers the same questions the oracle's
 * `getShapeActionPredicates` does), so the panel and the inspector cannot disagree about
 * what applies.
 */
import type { ShapeActions } from "./shapeActions.ts";

/**
 * The controls the column can hold, in the oracle's order.
 *
 * | the oracle's                     | here               | what it opens                        |
 * | -------------------------------- | ------------------ | ------------------------------------ |
 * | `changeStrokeColor`              | `stroke`           | the stroke colour picker             |
 * | `changeBackgroundColor`          | `background`       | the background colour picker         |
 * | `CombinedShapeProperties`        | `shape properties` | fill, width, stroke style, edges…   |
 * | `CombinedArrowProperties`        | `arrow properties` | the arrow's type and its heads       |
 * | `changeFontFamily`               | `font family`      | the font list                        |
 * | `CombinedTextProperties`         | `text properties`  | size, alignment, vertical alignment  |
 * | `duplicateSelection`             | `duplicate`        | —                                   |
 * | `deleteSelectedElements`         | `delete`           | —                                   |
 * | `CombinedExtraActions`           | `actions`          | layers, alignment, grouping          |
 */
export type TabletAction =
  | "stroke"
  | "background"
  | "shape properties"
  | "arrow properties"
  | "font family"
  | "text properties"
  | "duplicate"
  | "delete"
  | "actions";

/**
 * The plan for one selection.
 *
 * `selected` is whether there is a selection at all: the oracle's duplicate, delete and
 * extra-actions buttons hang off `predicates.showExtraActions`, which is a selection's
 * own (`Actions.tsx@1118751f:702-721`). With a drawing tool in hand and nothing selected,
 * the panel still shows the colours, which act on the next shape.
 */
export function tabletActionPlan(actions: ShapeActions, selected: boolean): TabletAction[] {
  const plan: TabletAction[] = [];

  // Stroke colour, then background colour (`Actions.tsx@1118751f:637-652`).
  if (actions.strokeColor) plan.push("stroke");
  if (actions.backgroundColor) plan.push("background");

  // `CombinedShapeProperties` (`Actions.tsx@1118751f:661-667`): one popover for the rows
  // a shape shares — the fill style, the stroke width, the stroke style, the sloppiness,
  // the roundness and the opacity (`:290-306`). The oracle renders the button whatever
  // the popover then holds; this one is not there when the popover would be empty,
  // because a button that opens nothing is a button that does not work.
  if (
    actions.fill ||
    actions.strokeWidth ||
    actions.strokeStyle ||
    actions.sloppiness ||
    actions.roundness ||
    actions.opacity
  ) {
    plan.push("shape properties");
  }

  // `CombinedArrowProperties` (`Actions.tsx@1118751f:669-677`).
  if (actions.arrowType || actions.arrowheads) plan.push("arrow properties");

  // The family is its own button and the rest of the typing travels together
  // (`Actions.tsx@1118751f:686-699`).
  if (actions.text) plan.push("font family");
  if (actions.text || actions.textAlign || actions.verticalAlign || actions.wrap) {
    plan.push("text properties");
  }

  // The selection's own actions (`Actions.tsx@1118751f:702-721`).
  if (selected) {
    plan.push("duplicate");
    plan.push("delete");
    plan.push("actions");
  }

  return plan;
}
