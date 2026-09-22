import { z } from "zod";
import {
  MAX_COLOR_LENGTH,
  MAX_ID_LENGTH,
  MAX_POINTS_PER_ELEMENT,
  MAX_TEXT_LENGTH,
} from "./limits.ts";

/**
 * Wire schema for a draw element, mirroring `engine/src/types.ts`.
 *
 * The engine is the source of truth for the shape; this is the validating gate in
 * front of it. A new element type or style has to land here before the API will
 * store it, which is deliberate: unknown geometry should fail loudly at the
 * boundary, not surface as a blank shape three sessions later.
 *
 * Unknown keys are stripped rather than rejected (zod's default), so an engine
 * that starts emitting an extra field keeps working against an older API.
 */

export const DRAW_ELEMENT_TYPES = [
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "arrow",
  "freedraw",
  "text",
  "image",
  "frame",
  "embed",
] as const;

export const FILL_STYLES = ["hachure", "cross-hatch", "solid", "zigzag"] as const;
export const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
export const ARROWHEADS = ["none", "arrow", "triangle", "dot", "diamond", "bar"] as const;
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;

/**
 * Rejects NaN and both infinities. Written as a refine rather than `.finite()`
 * because that helper's status differs across zod majors, and a NaN coordinate
 * reaching the renderer blanks the whole canvas.
 */
const finite = z.number().refine((value) => Number.isFinite(value), {
  message: "must be a finite number",
});

const finiteInt = finite.refine((value) => Number.isInteger(value), {
  message: "must be an integer",
});

/**
 * Colors are drawn into a canvas, never interpolated into HTML or CSS text, so
 * there is no injection sink to defend — only length, to keep a 4MB string out of
 * the database.
 */
const color = z.string().min(1).max(MAX_COLOR_LENGTH);

const point = z.tuple([finite, finite]);

export const drawElementSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  type: z.enum(DRAW_ELEMENT_TYPES),

  x: finite,
  y: finite,
  width: finite,
  height: finite,
  angle: finite,

  strokeColor: color,
  backgroundColor: color,
  fillStyle: z.enum(FILL_STYLES),
  strokeWidth: finite.min(0).max(100),
  strokeStyle: z.enum(STROKE_STYLES),
  roughness: finite.min(0).max(10),
  opacity: finite.min(0).max(100),
  roundness: finite.nullable(),

  seed: finite,
  points: z.array(point).max(MAX_POINTS_PER_ELEMENT).optional(),

  startBinding: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  endBinding: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  startArrowhead: z.enum(ARROWHEADS).optional(),
  endArrowhead: z.enum(ARROWHEADS).optional(),

  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  fontSize: finite.min(1).max(1000).optional(),
  // Optional rather than defaulted, and the distinction is load-bearing: absent means
  // nobody chose, which the engine resolves through the element's role — free text reads
  // from the left, a label centres in its shape. Giving either a `.default()` here would
  // stamp a value onto every element that passes through the server and silently
  // re-align every label saved before these fields existed.
  textAlign: z.enum(TEXT_ALIGNS).optional(),
  verticalAlign: z.enum(VERTICAL_ALIGNS).optional(),
  containerId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  boundTextId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  groupId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  locked: z.boolean().optional(),

  // The reconciliation stamp. `version` counts edits, `versionNonce` is random
  // per edit and breaks ties between concurrent writers.
  version: finiteInt.min(1),
  versionNonce: finiteInt,
  updated: finite,
  isDeleted: z.boolean(),
});

export type DrawElementDto = z.infer<typeof drawElementSchema>;
export type DrawElementType = (typeof DRAW_ELEMENT_TYPES)[number];
