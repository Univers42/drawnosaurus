/**
 * Mermaid's diagrams as this board's elements, the oracle's way. The oracle hands a
 * definition to `@excalidraw/mermaid-to-excalidraw` (`TTDDialog/common.ts@1118751f:70-110`),
 * which parses it and lays it out with Mermaid itself, then returns element *skeletons*:
 * shapes with a `label`, arrows whose `start`/`end` name the shape they leave and reach,
 * frames listing their `children`, and — for every diagram type it cannot take apart —
 * one image of Mermaid's own SVG. This turns those skeletons into elements, as
 * `convertToExcalidrawElements` does (`packages/element/src/transform.ts@1118751f`).
 *
 * Texts come out unmeasured, size 0: the engine's `insertJson` lays each out in the
 * board's fonts and grows a shape that no longer holds its label, the oracle's
 * `redrawTextBoundingBox`. The skeletons are a third party's output, so every number is
 * checked: nothing lands at NaN.
 */
import type { DrawElementDto } from "@drawnosaurus/contract";
import {
  MAX_COLOR_LENGTH,
  MAX_IMAGE_DATA_URL_LENGTH,
  WIRE_ARROWHEADS,
} from "@drawnosaurus/contract";

/** What of a skeleton this reads — the fields the converter's own output carries. */
export interface Skeleton {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  textAlign?: string;
  verticalAlign?: string;
  label?: {
    text?: string;
    fontSize?: number;
    strokeColor?: string;
    textAlign?: string;
    verticalAlign?: string;
  };
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roundness?: { type: number } | null;
  groupIds?: string[];
  points?: [number, number][];
  start?: { id?: string };
  end?: { id?: string };
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  name?: string;
  children?: string[];
  fileId?: string;
}

export interface SkeletonResult {
  elements: Skeleton[];
  files?: Record<string, { dataURL?: string }>;
}

/** What a badge says under a diagram that came in as a picture (see `badge`). */
export const NOT_EDITABLE = "Mermaid diagram · image, not editable";

/** Padding a frame keeps around its children when it has no box of its own (`transform.ts@1118751f`, `PADDING`). */
const FRAME_PADDING = 10;
const BADGE_FONT_SIZE = 14;
const BADGE_GAP = 8;
/** The engine's rounded corner — any skeleton roundness is "round" here. */
const ROUND = 8;
const INK = "#1e1e1e";
const BINDABLE: ReadonlySet<string> = new Set(["rectangle", "diamond", "ellipse"]);
export class SkeletonError extends Error {}

function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SkeletonError(`${what} is not a finite number: ${String(value)}`);
  }
  return value;
}

function colour(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_COLOR_LENGTH
    ? value
    : fallback;
}

/** Legacy spellings included — the ER converter writes `crowfoot_*`, and the engine
 *  reads them as their modern names. */
const ARROWHEAD_SET: ReadonlySet<string> = new Set(WIRE_ARROWHEADS);

type Arrowhead = NonNullable<DrawElementDto["endArrowhead"]>;

/** A skeleton's arrowhead: `null` is none, absent is `fallback`, anything unknown an arrow. */
function arrowhead(value: string | null | undefined, fallback: Arrowhead): Arrowhead {
  if (value === undefined) return fallback;
  if (value === null) return "none";
  return ARROWHEAD_SET.has(value) ? (value as Arrowhead) : "arrow";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

let minted = 0;
const mint = (): string => `mermaid-${Date.now().toString(36)}-${(minted++).toString(36)}`;
const nonce = (): number => Math.floor(Math.random() * 0x7fffffff);

function base(type: DrawElementDto["type"], skeleton: Skeleton): DrawElementDto {
  return {
    id: mint(),
    type,
    x: finite(skeleton.x ?? 0, `${skeleton.type}.x`),
    y: finite(skeleton.y ?? 0, `${skeleton.type}.y`),
    width: finite(skeleton.width ?? 0, `${skeleton.type}.width`),
    height: finite(skeleton.height ?? 0, `${skeleton.type}.height`),
    angle: 0,
    strokeColor: colour(skeleton.strokeColor, INK),
    backgroundColor: colour(skeleton.backgroundColor, "transparent"),
    fillStyle: oneOf(skeleton.fillStyle, ["hachure", "cross-hatch", "solid", "zigzag"], "solid"),
    strokeWidth: finite(skeleton.strokeWidth ?? 2, `${skeleton.type}.strokeWidth`),
    strokeStyle: oneOf(skeleton.strokeStyle, ["solid", "dashed", "dotted"], "solid"),
    roughness: 1,
    opacity: 100,
    roundness: skeleton.roundness ? ROUND : null,
    seed: nonce(),
    groupIds: skeleton.groupIds?.length ? [...skeleton.groupIds] : undefined,
    version: 1,
    versionNonce: nonce(),
    updated: Date.now(),
    isDeleted: false,
  };
}

function text(
  source: string,
  at: { x: number; y: number },
  style: {
    fontSize?: number;
    strokeColor?: string;
    textAlign?: string;
    verticalAlign?: string;
    groupIds?: string[];
  },
  defaults: { textAlign: "left" | "center"; verticalAlign: "top" | "middle" },
): DrawElementDto {
  return {
    ...base("text", { type: "text", x: at.x, y: at.y, groupIds: style.groupIds }),
    strokeColor: colour(style.strokeColor, INK),
    text: source,
    originalText: source,
    fontSize: finite(style.fontSize ?? 20, "text.fontSize"),
    textAlign: oneOf(style.textAlign, ["left", "center", "right"] as const, defaults.textAlign),
    verticalAlign: oneOf(
      style.verticalAlign,
      ["top", "middle", "bottom"] as const,
      defaults.verticalAlign,
    ),
  };
}

/** A linear skeleton's points: its own, or a straight run across its box. */
function points(skeleton: Skeleton): [number, number][] {
  const own = skeleton.points;
  if (own && own.length >= 2) {
    return own.map(([x, y], i) => [
      finite(x, `${skeleton.type}.points[${i}].x`),
      finite(y, `${skeleton.type}.points[${i}].y`),
    ]);
  }
  return [
    [0, 0],
    [finite(skeleton.width ?? 0, "width"), finite(skeleton.height ?? 0, "height")],
  ];
}

function extent(pts: [number, number][]): { width: number; height: number } {
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** The picture and, grouped with it, the badge that says it cannot be edited as shapes. */
function picture(skeleton: Skeleton, dataURL: string): DrawElementDto[] {
  if (dataURL.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new SkeletonError("the diagram's picture is too large to put on the board");
  }
  const group = mint();
  const image: DrawElementDto = {
    ...base("image", skeleton),
    strokeColor: "transparent",
    dataUrl: dataURL,
    groupIds: [group],
  };
  const badge = text(
    NOT_EDITABLE,
    { x: image.x, y: image.y + image.height + BADGE_GAP },
    { fontSize: BADGE_FONT_SIZE, strokeColor: "#868e96", groupIds: [group] },
    { textAlign: "left", verticalAlign: "top" },
  );
  return [image, badge];
}

/**
 * A converter's text as it was written. The converter hides each entity code (`#lt;`,
 * `#9829;`) from Mermaid's parser behind a placeholder and turns most back, but not a
 * class relation's title (`parser/class.js`, `parseRelations`), which the oracle then shows
 * as `xﬂ°lt¶ßy`. Divergence: this turns it back, as the converter does everywhere else.
 */
export function restoreEntities(source: string): string {
  return source
    .replace(/ﬂ°°(\d+)¶ß/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/ﬂ°(\w+)¶ß/g, (_, name: string) => NAMED_ENTITIES[name] ?? `#${name};`);
}

/** The entity names a definition is likeliest to use; any other is left as it was typed. */
const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  hellip: "…",
  infin: "∞",
  larr: "←",
  rarr: "→",
  harr: "↔",
  check: "✓",
  times: "×",
  deg: "°",
  copy: "©",
};

/**
 * `result`'s skeletons as elements: shapes first with their labels just above them, then
 * the arrows between them, then frames around what they hold.
 *
 * A skeleton with nowhere finite to go is left out and the rest kept: Mermaid lays out an
 * empty sequence block at NaN, and what follows it too, so its own SVG loses the same
 * parts. Throws `SkeletonError` only when nothing at all could be placed.
 *
 * `lifelines`: the skeletons are a sequence diagram's, whose arrows are messages between
 * lifelines and are left unbound (see the arrow case below).
 */
export function skeletonToElements(
  result: SkeletonResult,
  options: { lifelines?: boolean } = {},
): DrawElementDto[] {
  const out: DrawElementDto[] = [];
  // Every skeleton that has an id, first come first kept: what a frame lists, and what an
  // arrow's `start`/`end` names — which it binds to only if it is a shape.
  const byId = new Map<string, DrawElementDto>();
  const bindable = (id: string | undefined) => {
    const target = id === undefined ? undefined : byId.get(id);
    return target && BINDABLE.has(target.type) ? target : undefined;
  };
  const labelled = (container: DrawElementDto, skeleton: Skeleton): DrawElementDto[] => {
    const source = skeleton.label?.text;
    if (!source) return [container];
    const bound = text(
      restoreEntities(source),
      { x: container.x, y: container.y },
      { ...skeleton.label, groupIds: container.groupIds },
      { textAlign: "center", verticalAlign: "middle" },
    );
    bound.containerId = container.id;
    container.boundTextId = bound.id;
    return [container, bound];
  };

  /** One skeleton's elements, the first of them the one its id names. */
  const convert = (skeleton: Skeleton): DrawElementDto[] => {
    switch (skeleton.type) {
      case "rectangle":
      case "diamond":
      case "ellipse":
        return labelled(base(skeleton.type, skeleton), skeleton);
      case "text": {
        const at = { x: finite(skeleton.x ?? 0, "text.x"), y: finite(skeleton.y ?? 0, "text.y") };
        const source = restoreEntities(skeleton.text ?? "");
        return [text(source, at, skeleton, { textAlign: "left", verticalAlign: "top" })];
      }
      case "arrow":
      case "line": {
        const pts = points(skeleton);
        const linear: DrawElementDto = {
          ...base(skeleton.type, skeleton),
          ...extent(pts),
          points: pts,
          startArrowhead: arrowhead(skeleton.startArrowhead, "none"),
          endArrowhead: arrowhead(
            skeleton.endArrowhead,
            skeleton.type === "arrow" ? "arrow" : "none",
          ),
        };
        if (skeleton.type === "line") return [linear];
        // A sequence diagram's messages run between lifelines. The converter binds each to
        // the box atop its lifeline, and the engine routes a bound end onto its shape, so a
        // bound message would jump up to the boxes: left unbound, it stays where Mermaid
        // drew it. Divergence: the oracle binds it anyway and keeps its points until a box
        // moves (`bindLinearElementToElement`, `transform.ts@1118751f`). Anywhere else the
        // routing is what we want — it also mends an edge the converter placed away from
        // its shapes, as it does in a class diagram with namespaces.
        if (!options.lifelines) {
          const start = bindable(skeleton.start?.id);
          const end = bindable(skeleton.end?.id);
          if (start) linear.startBinding = start.id;
          if (end) linear.endBinding = end.id;
        }
        return labelled(linear, skeleton);
      }
      case "image": {
        const dataURL = skeleton.fileId ? result.files?.[skeleton.fileId]?.dataURL : undefined;
        if (!dataURL) throw new SkeletonError("an image skeleton with no picture");
        return picture(skeleton, dataURL);
      }
      default:
        throw new SkeletonError(`unknown skeleton type "${skeleton.type}"`);
    }
  };

  const frames: Skeleton[] = [];
  let refused: SkeletonError | null = null;
  for (const skeleton of result.elements) {
    if (skeleton.type === "frame") {
      frames.push(skeleton);
      continue;
    }
    let elements: DrawElementDto[];
    try {
      elements = convert(skeleton);
    } catch (error) {
      if (!(error instanceof SkeletonError)) throw error;
      refused ??= error;
      continue;
    }
    if (skeleton.id && !byId.has(skeleton.id)) byId.set(skeleton.id, elements[0]!);
    out.push(...elements);
  }
  if (out.length === 0 && refused) throw refused;

  for (const skeleton of frames) {
    const children = (skeleton.children ?? [])
      .map((id) => byId.get(id))
      .filter((child): child is DrawElementDto => child !== undefined);
    if (children.length === 0) continue;
    const minX = Math.min(...children.map((c) => c.x)) - FRAME_PADDING;
    const minY = Math.min(...children.map((c) => c.y)) - FRAME_PADDING;
    const maxX = Math.max(...children.map((c) => c.x + c.width)) + FRAME_PADDING;
    const maxY = Math.max(...children.map((c) => c.y + c.height)) + FRAME_PADDING;
    const frame: DrawElementDto = {
      ...base("frame", {
        type: "frame",
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      }),
      name: skeleton.name ?? null,
    };
    const inside = new Set(children.map((child) => child.id));
    for (const element of out) {
      if (inside.has(element.id) || (element.containerId && inside.has(element.containerId))) {
        element.frameId = frame.id;
      }
    }
    // A frame sits under what it holds, as the oracle orders a frame before its children.
    out.unshift(frame);
  }
  return out;
}
