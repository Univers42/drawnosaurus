import { z } from "zod";
import {
  MAX_COLOR_LENGTH,
  MAX_FONT_FAMILY,
  MAX_GROUP_DEPTH,
  MAX_ID_LENGTH,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_LINE_HEIGHT,
  MAX_POINTS_PER_ELEMENT,
  MAX_TEXT_LENGTH,
  MAX_URL_LENGTH,
  MIN_LINE_HEIGHT,
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
  "stickynote",
] as const;

export const FILL_STYLES = ["hachure", "cross-hatch", "solid", "zigzag"] as const;
export const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
export const ARROWHEADS = ["none", "arrow", "triangle", "dot", "diamond", "bar"] as const;
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
/** How an arrow end sits on its shape: exactly on its anchor, or a gap clear of the outline. */
export const BIND_MODES = ["inside", "orbit"] as const;

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

/**
 * Where on a shape an arrow end is anchored: a ratio of the shape's unrotated width and
 * height, `[0.5, 0.5]` its centre. Bounded as the engine clamps it
 * (`FIXED_POINT_BOUND`), so a document cannot put an arrow end unboundedly far away.
 */
const anchorRatio = finite.min(-10).max(10);
const fixedPoint = z.tuple([anchorRatio, anchorRatio]);

/**
 * An image's picture: a base64 `data:image/…` URL and nothing else.
 *
 * Only ever decoded by an `<img>` and drawn into a canvas, where an SVG's scripts do not
 * run; the pattern still refuses anything that is not a picture, so a crafted document
 * cannot use the field to carry a `javascript:` or remote URL into the page.
 */
const imageDataUrl = z
  .string()
  .max(MAX_IMAGE_DATA_URL_LENGTH)
  .regex(/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/, {
    message: "must be a base64 data:image URL",
  });

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
  // An explicit corner radius from the in-place handle. Optional and undefaulted for the
  // same reason as the text fields below: every rounded shape saved before this existed
  // uses the adaptive corner, and stamping a value onto them on the way through the server
  // would change how every one of them looks.
  cornerRadius: finite.min(0).max(100_000).optional(),

  seed: finite,
  points: z.array(point).max(MAX_POINTS_PER_ELEMENT).optional(),

  startBinding: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  endBinding: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  // Where each bound end sits on its shape, and how. Optional and undefaulted: an arrow
  // saved before anchors existed carries neither, which the engine reads as the centre in
  // orbit — exactly how every such arrow was always drawn.
  startFixedPoint: fixedPoint.optional(),
  endFixedPoint: fixedPoint.optional(),
  startBindMode: z.enum(BIND_MODES).optional(),
  endBindMode: z.enum(BIND_MODES).optional(),
  startArrowhead: z.enum(ARROWHEADS).optional(),
  endArrowhead: z.enum(ARROWHEADS).optional(),

  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  // The text model, all optional and undefaulted like the alignments below: a text saved
  // before them carries none, and the engine reads absent as what it always drew — `text`
  // is the source, the system font, a line height of 1.25, a label wrapped in its shape.
  // `originalText` is the source before wrapping (`text` stays what is drawn); `fontFamily`
  // is Excalidraw's numeric id; `lineHeight` a multiple of the font size; `wrap: false`
  // keeps a label's hard lines and widens its shape instead.
  originalText: z.string().max(MAX_TEXT_LENGTH).optional(),
  fontFamily: finiteInt.min(1).max(MAX_FONT_FAMILY).optional(),
  lineHeight: finite.min(MIN_LINE_HEIGHT).max(MAX_LINE_HEIGHT).optional(),
  wrap: z.boolean().optional(),
  fontSize: finite.min(1).max(1000).optional(),
  // Optional rather than defaulted, and the distinction is load-bearing: absent means
  // nobody chose, which the engine resolves through the element's role — free text reads
  // from the left, a label centres in its shape. Giving either a `.default()` here would
  // stamp a value onto every element that passes through the server and silently
  // re-align every label saved before these fields existed.
  textAlign: z.enum(TEXT_ALIGNS).optional(),
  verticalAlign: z.enum(VERTICAL_ALIGNS).optional(),
  // `false` for a column dragged out with the text tool, which keeps its width and wraps
  // inside it. Optional and undefaulted for the same reason as the alignments: every text
  // saved before this field existed sized itself to its glyphs, and stamping `true` onto
  // them on the way through the server would write a choice nobody made.
  autoResize: z.boolean().optional(),
  containerId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  boundTextId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  // The groups this element is in, **innermost first**. The array *is* the nesting:
  // there is no group entity and no parent pointer, just ids that several elements
  // share. Mirrors the engine's `group_ids`; see `docs/reference/groups.md`.
  groupIds: z.array(z.string().max(MAX_ID_LENGTH)).max(MAX_GROUP_DEPTH).optional(),
  // The pre-array spelling, still accepted so boards saved before groups could nest keep
  // loading. The engine folds it into `groupIds` on the way in and writes only the array
  // back, so a document is in the old shape at most once.
  groupId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  locked: z.boolean().optional(),
  // The frame an element belongs to, and a frame's label. Missing here, both were
  // stripped on the way in: after a reload nothing was inside any frame, so moving a
  // frame left its contents behind, and every frame had lost its name.
  frameId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  name: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
  // The picture an image element shows. Without it here zod stripped it on the way in,
  // so every image saved as an empty frame and came back after a reload as the grey
  // placeholder.
  dataUrl: imageDataUrl.optional(),
  // The page an embed shows — a video, a document. The same story as `dataUrl`: absent
  // from this schema, it was stripped, and every embed came back from the server as an
  // empty box, for whoever opened the board next. Bounded and nothing more: the engine
  // re-checks it against its list of providers before anything is framed
  // (`scene/embed.rs`), so this is not where a page is let in.
  embedUrl: z.string().max(MAX_URL_LENGTH).nullable().optional(),

  // The sticky note's model, all optional and undefaulted like the text fields above: every
  // element saved before the note was native carries none, and must come back byte for byte.
  // `baseHeight` is the height the user set, which a note grows above to fit its label and
  // never shrinks below; `created` is when a note was drawn (its footer's date), `null` when
  // unknown as the oracle writes it; `baseFontSize` is the size a note's label was given, the
  // ceiling the auto-fit shrinks below.
  baseHeight: finite.min(0).max(1_000_000).optional(),
  created: finite.nullable().optional(),
  baseFontSize: finite.min(1).max(1000).nullable().optional(),

  // The reconciliation stamp. `version` counts edits, `versionNonce` is random
  // per edit and breaks ties between concurrent writers.
  version: finiteInt.min(1),
  versionNonce: finiteInt,
  updated: finite,
  isDeleted: z.boolean(),
});

export type DrawElementDto = z.infer<typeof drawElementSchema>;
export type DrawElementType = (typeof DRAW_ELEMENT_TYPES)[number];
