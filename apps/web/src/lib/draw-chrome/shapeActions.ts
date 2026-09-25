import type { ColorDomain, DrawElementType, DrawTool } from "@osionos/draw-engine/types";
import { isTransparent } from "./colors.ts";

/**
 * Which style controls are relevant right now.
 *
 * Transcribed from Excalidraw's `shapeActionPredicates.ts` and `element/comparisons.ts`
 * at the SHA pinned in `scripts/oracle-sha.txt`. Keeping it here as one pure function,
 * as they do, is the point: the panel used to render every control for every selection,
 * so an arrow offered a fill style it cannot have and a line offered corner rounding it
 * has no corners for. Scattering `{#if}` conditions through the markup is how those
 * answers drift apart.
 *
 * A property is relevant when it applies to the **active tool** — so it can be set
 * before drawing anything — or to **any selected element**. That is
 * `forToolOrSelection`, and it is why picking the rectangle tool shows a fill style with
 * nothing selected at all.
 */

/** An element type or a tool name; the predicates accept either, as Excalidraw's do. */
type Kind = DrawElementType | DrawTool;

/**
 * Tools that stand in for an element type when the panel asks about them.
 *
 * The auto-shape tool does not know yet what it will draw, and answering as a rectangle
 * offers every control it might need — better than offering none for a tool that
 * genuinely draws.
 *
 * Only this one. The laser and the lasso leave no element behind, and an image, an embed
 * or a frame takes none of the stroke and fill styling, so mapping any of them to a
 * rectangle would offer a background and a fill style that do nothing. The sticky note
 * tool is named after its element, so it answers as itself.
 */
const asElementKind = (kind: Kind): Kind => (kind === "autoshape" ? "rectangle" : kind);

/**
 * `bucketfill` is here as a **tool**, never as an element type — the paint it leaves
 * behind is a `line`, which is in this list on its own account. Excalidraw carries the
 * same entry with the same comment (`element/comparisons.ts:12-13`), because a bucket
 * with no background control is a bucket whose colour cannot be chosen: the panel is
 * gated row by row on these predicates, so the tool arrived to an empty box and every
 * fill came out the one hardcoded fallback shade.
 */
const hasBackground = (kind: Kind): boolean =>
  [
    "rectangle",
    "stickynote",
    "embed",
    "ellipse",
    "diamond",
    "line",
    "freedraw",
    "bucketfill",
  ].includes(asElementKind(kind));

/** A note's paper is always solid: it takes a colour and no fill pattern (`:16-17`). */
const hasFillStyle = (kind: Kind): boolean => hasBackground(kind) && kind !== "stickynote";

const hasStrokeColor = (kind: Kind): boolean =>
  [
    "rectangle",
    "stickynote",
    "ellipse",
    "diamond",
    "freedraw",
    "arrow",
    "line",
    "text",
    "embed",
  ].includes(asElementKind(kind));

const hasStrokeWidth = (kind: Kind): boolean =>
  ["rectangle", "ellipse", "diamond", "freedraw", "arrow", "line", "embed"].includes(
    asElementKind(kind),
  );

/** Freehand strokes and text have no dash pattern to choose. */
const hasStrokeStyle = (kind: Kind): boolean =>
  ["rectangle", "ellipse", "diamond", "arrow", "line", "embed"].includes(asElementKind(kind));

/** A note has no stroke to dash, but its paper's outline is as sloppy as a rectangle's. */
const hasRoughness = (kind: Kind): boolean => hasStrokeStyle(kind) || kind === "stickynote";

/** Notably **not** an ellipse: it has no corners to round. */
const canChangeRoundness = (kind: Kind): boolean =>
  ["rectangle", "stickynote", "diamond", "line", "image", "embed"].includes(asElementKind(kind));

const canHaveArrowheads = (kind: Kind): boolean => asElementKind(kind) === "arrow";

/** `toolIsArrow` (`shapeActionPredicates.ts@1118751f:147`): the same test, named for its row. */
const isArrowKind = canHaveArrowheads;

const isTextKind = (kind: Kind): boolean => asElementKind(kind) === "text";

/**
 * Tools that create something, as opposed to selecting, panning or erasing.
 *
 * The lasso is a *selection* tool despite being drawn: Excalidraw's
 * `showSelectedShapeActions` excludes it alongside `selection`, because there is nothing
 * for a stroke colour or a fill style to act on while you are choosing what to act on.
 */
export const isDrawingTool = (tool: DrawTool): boolean =>
  tool !== "select" &&
  tool !== "lasso" &&
  tool !== "hand" &&
  tool !== "eraser" &&
  // The laser leaves nothing behind, so there is nothing for a style to apply to. A
  // panel of stroke widths hanging over the board while you present is noise.
  tool !== "laser" &&
  // A frame has a fixed appearance — Excalidraw's shape actions exclude frames
  // entirely — so there is nothing to offer while the frame tool is active either.
  tool !== "frame" &&
  // The image tool opens a file picker and is gone again; a panel that flashes up for
  // the length of a dialog is noise. A *selected* image still shows one, because that
  // is driven by the selection rather than by the tool.
  tool !== "image" &&
  // Same as the image tool: it opens a dialog and is gone. A *selected* embed still
  // shows a panel, because that is driven by the selection.
  tool !== "embed";

export interface ShapeActions {
  /** Whether the panel should be on screen at all. */
  visible: boolean;
  strokeColor: boolean;
  backgroundColor: boolean;
  fill: boolean;
  strokeWidth: boolean;
  strokeStyle: boolean;
  sloppiness: boolean;
  roundness: boolean;
  /** Sharp or curved, for arrows and the arrow tool. */
  arrowType: boolean;
  arrowheads: boolean;
  /** Close a selected line into a filled shape, or open it back up. */
  polygon: boolean;
  /** The font family and size rows. */
  text: boolean;
  textAlign: boolean;
  verticalAlign: boolean;
  /**
   * Whether text wraps: a free text's fixed width, a label's wrapping in its shape. Not a
   * row of the oracle's — its free text wraps once a side handle sets a width, and its
   * labels always wrap — so shown only for a selection that holds either.
   */
  wrap: boolean;
  opacity: boolean;
  /** Actions on things that exist: z-order, mirror, group, align. */
  layers: boolean;
  mirror: boolean;
  group: boolean;
  align: boolean;
  distribute: boolean;
}

/**
 * What the predicates need to know about the selection — the engine's `selectionStyle()`
 * carries all of it, so the panel asks once per revision instead of walking elements.
 *
 * `kinds` are the oracle's *target* elements: the selection plus the labels its shapes
 * carry (`getTargetElements`). Once a shape has a label the shape is the only thing a
 * click can select, so asking only about the selection would leave the text rows
 * unreachable for every label on the board — the case they exist for.
 */
export interface SelectionFacts {
  count: number;
  kinds: readonly DrawElementType[];
  /** The kinds whose background paints something. */
  filledKinds: readonly DrawElementType[];
  /** `suppportsHorizontalAlign` (`packages/element/src/textElement.ts@1118751f:462-477`). */
  textAlignable: boolean;
  /** `shouldAllowVerticalAlign` (`textElement.ts@1118751f:446-460`). */
  verticalAlignable: boolean;
  /** Whether align and distribute would move anything, counted in units by the engine. */
  canAlign: boolean;
  canDistribute: boolean;
  /** A free text is selected. */
  hasFreeText: boolean;
  /** A label is selected, or carried by a selected shape. */
  hasLabel: boolean;
  /**
   * Whose colours a background pick sets. Not `regular` means it lands on a note — a
   * note's label passes the pick on to its note, though the label has no fill itself.
   */
  backgroundDomain: ColorDomain;
  /**
   * Whether the polygon toggle would do anything: a line with at least four points, and
   * only lines (`actionLinearEditor.tsx@1118751f:127-138`). Not folded into `kinds` like
   * the other predicates because it depends on point count, which those booleans don't
   * carry — read off `SelectionStyle.canTogglePolygon`, the engine's own one-pass answer.
   */
  canTogglePolygon: boolean;
}

export function getShapeActions(
  activeTool: DrawTool,
  selection: SelectionFacts,
  /** The style that would be applied to the next thing drawn. */
  nextBackgroundColor: string,
): ShapeActions {
  const { kinds } = selection;
  const forToolOrSelection = (predicate: (kind: Kind) => boolean): boolean =>
    predicate(activeTool) || kinds.some((kind) => predicate(kind));

  const hasSelection = selection.count > 0;
  // `canChangeStrokeColor` (`shapeActionPredicates.ts@1118751f:41-62`): the tool only
  // counts while the selection is not all images or all frames.
  const commonKind = kinds.length === 1 ? kinds[0] : null;

  // Excalidraw's `showSelectedShapeActions`: a drawing tool is active, so defaults can
  // be set before drawing, or something is selected. The select tool over an empty
  // canvas shows nothing — there is nothing for the controls to act on.
  const visible = isDrawingTool(activeTool) || hasSelection;

  return {
    visible,
    strokeColor:
      (hasStrokeColor(activeTool) && commonKind !== "image" && commonKind !== "frame") ||
      kinds.some(hasStrokeColor),
    // `canChangeBackgroundColor` (`shapeActionPredicates.ts@1118751f:64-78`): a note's
    // label, the target while it is typed, keeps the picker because its note takes it.
    backgroundColor: forToolOrSelection(hasBackground) || selection.backgroundDomain !== "regular",
    // A fill style only means something once there is a fill to style — except for the
    // bucket, which never paints transparent because it falls back to a real colour when
    // none is chosen. Without this the fill row is hidden exactly when nothing has been
    // picked yet, which is every first use of the tool.
    fill:
      activeTool === "bucketfill" ||
      (hasFillStyle(activeTool) && !isTransparent(nextBackgroundColor)) ||
      selection.filledKinds.some(hasFillStyle),
    strokeWidth: forToolOrSelection(hasStrokeWidth),
    strokeStyle: forToolOrSelection(hasStrokeStyle),
    sloppiness: forToolOrSelection(hasRoughness),
    roundness: forToolOrSelection(canChangeRoundness),
    arrowType: forToolOrSelection(isArrowKind),
    arrowheads: forToolOrSelection(canHaveArrowheads),
    // Selection-only, like `align`/`distribute` above: the tool has no points yet for
    // "four or more" to ask about, so there is nothing to offer before something is drawn.
    polygon: selection.canTogglePolygon,
    text: activeTool === "text" || kinds.some(isTextKind),
    textAlign: activeTool === "text" || selection.textAlignable,
    verticalAlign: selection.verticalAlignable,
    wrap: selection.hasFreeText || selection.hasLabel,
    // `shapeActionPredicates.ts@1118751f:157`: every selection, a frame included, and
    // every tool but the auto-shape one. The panel's own visibility rules out the tools
    // that draw nothing.
    opacity: activeTool !== "autoshape" || hasSelection,
    layers: hasSelection,
    mirror: hasSelection,
    group: hasSelection,
    align: selection.canAlign,
    distribute: selection.canDistribute,
  };
}
