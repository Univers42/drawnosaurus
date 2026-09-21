import type { DrawElement, DrawElementType } from "@osionos/draw-engine/types";
import type { ExtendedTool } from "./tools.ts";

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
type Kind = DrawElementType | ExtendedTool;

/**
 * Tools that stand in for an element type when the panel asks about them.
 *
 * A sticky note is a rectangle carrying a label. The auto-shape tool does not know yet
 * what it will draw, and answering as a rectangle offers every control it might need —
 * better than offering none for a tool that genuinely draws.
 *
 * Only these two. The laser and the lasso leave no element behind, and an image, an embed
 * or a frame takes none of the stroke and fill styling, so mapping any of them to a
 * rectangle would offer a background and a fill style that do nothing.
 */
const asElementKind = (kind: Kind): Kind =>
  kind === "sticky" || kind === "autoshape" ? "rectangle" : kind;

const hasBackground = (kind: Kind): boolean =>
  ["rectangle", "ellipse", "diamond", "line", "freedraw"].includes(asElementKind(kind));

const hasFillStyle = hasBackground;

const hasStrokeColor = (kind: Kind): boolean =>
  ["rectangle", "ellipse", "diamond", "freedraw", "arrow", "line", "text", "embed"].includes(
    asElementKind(kind),
  );

const hasStrokeWidth = (kind: Kind): boolean =>
  ["rectangle", "ellipse", "diamond", "freedraw", "arrow", "line", "embed"].includes(
    asElementKind(kind),
  );

/** Freehand strokes and text have no dash pattern to choose. */
const hasStrokeStyle = (kind: Kind): boolean =>
  ["rectangle", "ellipse", "diamond", "arrow", "line", "embed"].includes(asElementKind(kind));

const hasRoughness = hasStrokeStyle;

/** Notably **not** an ellipse: it has no corners to round. */
const canChangeRoundness = (kind: Kind): boolean =>
  ["rectangle", "diamond", "line", "image", "embed"].includes(asElementKind(kind));

const canHaveArrowheads = (kind: Kind): boolean => asElementKind(kind) === "arrow";

const isTextKind = (kind: Kind): boolean => asElementKind(kind) === "text";

/**
 * Everything that can be made see-through.
 *
 * Written as an allow-list rather than as "not a frame", because these predicates are
 * also asked about the *active tool* — and `select`, `hand` and `eraser` are not frames
 * either, so a deny-list would answer yes for all of them.
 */
const hasOpacity = (kind: Kind): boolean =>
  [
    "rectangle",
    "ellipse",
    "diamond",
    "line",
    "arrow",
    "freedraw",
    "text",
    "image",
    "embed",
  ].includes(asElementKind(kind));

/**
 * Tools that create something, as opposed to selecting, panning or erasing.
 *
 * The lasso is a *selection* tool despite being drawn: Excalidraw's
 * `showSelectedShapeActions` excludes it alongside `selection`, because there is nothing
 * for a stroke colour or a fill style to act on while you are choosing what to act on.
 */
export const isDrawingTool = (tool: ExtendedTool): boolean =>
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

/** Whether a colour paints nothing, so a fill style would have nothing to apply to. */
export const isTransparent = (color: string): boolean => {
  const c = color.trim().toLowerCase();
  if (c === "transparent" || c === "") return true;
  if (c.length === 9 && c.startsWith("#")) return c.slice(7) === "00";
  if (c.length === 5 && c.startsWith("#")) return c.slice(4) === "0";
  return false;
};

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
  arrowheads: boolean;
  text: boolean;
  opacity: boolean;
  /** Actions on things that exist: z-order, mirror, group, align. */
  layers: boolean;
  mirror: boolean;
  group: boolean;
  align: boolean;
  distribute: boolean;
}

export function getShapeActions(
  activeTool: ExtendedTool,
  selected: readonly Pick<DrawElement, "type" | "backgroundColor">[],
  /** The style that would be applied to the next thing drawn. */
  nextBackgroundColor: string,
): ShapeActions {
  const forToolOrSelection = (predicate: (kind: Kind) => boolean): boolean =>
    predicate(activeTool) || selected.some((element) => predicate(element.type));

  const hasSelection = selected.length > 0;

  // Excalidraw's `showSelectedShapeActions`: a drawing tool is active, so defaults can
  // be set before drawing, or something is selected. The select tool over an empty
  // canvas shows nothing — there is nothing for the controls to act on.
  const visible = isDrawingTool(activeTool) || hasSelection;

  return {
    visible,
    strokeColor: forToolOrSelection(hasStrokeColor),
    backgroundColor: forToolOrSelection(hasBackground),
    // A fill style only means something once there is a fill to style.
    fill:
      (hasFillStyle(activeTool) && !isTransparent(nextBackgroundColor)) ||
      selected.some(
        (element) => hasFillStyle(element.type) && !isTransparent(element.backgroundColor),
      ),
    strokeWidth: forToolOrSelection(hasStrokeWidth),
    strokeStyle: forToolOrSelection(hasStrokeStyle),
    sloppiness: forToolOrSelection(hasRoughness),
    roundness: forToolOrSelection(canChangeRoundness),
    arrowheads: forToolOrSelection(canHaveArrowheads),
    text: activeTool === "text" || selected.some((element) => isTextKind(element.type)),
    opacity: forToolOrSelection(hasOpacity),
    layers: hasSelection,
    mirror: hasSelection,
    group: hasSelection,
    align: selected.length > 1,
    distribute: selected.length > 2,
  };
}
