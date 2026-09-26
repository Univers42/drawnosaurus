/**
 * What every fuzzed Mermaid case must satisfy once it is on the board. Pure: each takes
 * the elements the engine placed (and, for positions, what the converter handed it) and
 * returns what is wrong, as sentences, empty when nothing is.
 */
import type { Case, Conversion } from "./generators.ts";

/** An element as `exportJson` writes it, the fields the checks read. */
export interface Placed {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  boundTextId?: string | null;
  startBinding?: string | null;
  endBinding?: string | null;
  points?: [number, number][];
  groupIds?: string[];
  /** `exportJson`'s data URL, reduced in the page to whether there was one. */
  hasPicture?: boolean;
}

const SHAPES = new Set(["rectangle", "diamond", "ellipse"]);
/** Slack for float noise in a laid-out box, in world units. */
const EPSILON = 1;

const normalise = (text: string): string => text.replace(/\s+/g, " ").trim();

export function finiteNumbers(elements: Placed[]): string[] {
  const failures: string[] = [];
  for (const element of elements) {
    const numbers = [element.x, element.y, element.width, element.height, element.angle ?? 0];
    for (const [x, y] of element.points ?? []) numbers.push(x, y);
    if (numbers.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      failures.push(`${element.type} ${element.id} has a non-finite number`);
    }
  }
  return failures;
}

const source = (text: Placed): string => text.originalText ?? text.text ?? "";

/**
 * The shape carrying each declared node's label, found by that label's text — the whole of
 * it, or one of its lines: a class's label is its stereotype above its name.
 */
function shapesByLabel(elements: Placed[]): Map<string, Placed> {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const shapes = new Map<string, Placed>();
  for (const text of elements) {
    if (text.type !== "text" || !text.containerId) continue;
    const container = byId.get(text.containerId);
    if (!container || !SHAPES.has(container.type)) continue;
    for (const key of [source(text), ...source(text).split("\n")]) {
      shapes.set(normalise(key), container);
    }
  }
  return shapes;
}

/** Each arrow label's text: what a type whose arrows bind nothing is found by. */
function arrowLabels(elements: Placed[]): Set<string> {
  const arrows = new Set(elements.filter((e) => e.type === "arrow").map((e) => e.id));
  return new Set(
    elements
      .filter((e) => e.type === "text" && e.containerId && arrows.has(e.containerId))
      .map((e) => normalise(source(e))),
  );
}

export function coverage(kase: Case, elements: Placed[]): string[] {
  const failures: string[] = [];
  const shapes = shapesByLabel(elements);
  const missing = kase.nodes.filter((node) => !shapes.has(normalise(node)));
  if (missing.length > 0) {
    failures.push(`${missing.length} node(s) with no shape: ${missing.slice(0, 3).join(" | ")}`);
  }
  const arrows = elements.filter((element) => element.type === "arrow");
  for (const [from, to] of kase.edges) {
    const start = shapes.get(normalise(kase.nodes[from]!));
    const end = shapes.get(normalise(kase.nodes[to]!));
    if (!start || !end) continue;
    const bound = arrows.some(
      (arrow) => arrow.startBinding === start.id && arrow.endBinding === end.id,
    );
    if (!bound) failures.push(`no arrow bound ${kase.nodes[from]} → ${kase.nodes[to]}`);
  }
  const labels = arrowLabels(elements);
  const unlabelled = kase.messages.filter((message) => !labels.has(normalise(message)));
  if (unlabelled.length > 0) {
    failures.push(`${unlabelled.length} arrow label(s) missing: ${unlabelled.slice(0, 3).join(" | ")}`);
  }
  return failures;
}

const overlapArea = (a: Placed, b: Placed): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const contains = (outer: Placed, inner: Placed): boolean =>
  inner.x >= outer.x - EPSILON &&
  inner.y >= outer.y - EPSILON &&
  inner.x + inner.width <= outer.x + outer.width + EPSILON &&
  inner.y + inner.height <= outer.y + outer.height + EPSILON;

/** No two declared nodes' shapes overlap — a subgraph around them is not a node. */
export function noOverlaps(kase: Case, elements: Placed[]): string[] {
  const shapes = shapesByLabel(elements);
  const nodes = kase.nodes
    .map((node) => shapes.get(normalise(node)))
    .filter((shape): shape is Placed => shape !== undefined);
  const failures: string[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (overlapArea(a, b) > EPSILON && !contains(a, b) && !contains(b, a)) {
        failures.push(`nodes overlap: ${a.id} and ${b.id}`);
      }
    }
  }
  return failures.slice(0, 5);
}

/** Every shape's label lies inside it. */
export function labelsFit(elements: Placed[]): string[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const failures: string[] = [];
  for (const text of elements) {
    if (text.type !== "text" || !text.containerId) continue;
    const container = byId.get(text.containerId);
    if (!container || !SHAPES.has(container.type)) continue;
    if (!contains(container, text)) {
      failures.push(`label "${normalise(source(text))}" spills out of its ${container.type}`);
    }
  }
  return failures.slice(0, 5);
}

/**
 * Nodes stay where Mermaid laid them out. The converter takes each position from
 * Mermaid's own SVG; the engine may grow a shape to hold its label, but must not move it.
 * `converted` is the converter's output, `placed` the engine's, both keyed by label.
 */
export function positionsKept(kase: Case, converted: Placed[], placed: Placed[]): string[] {
  const before = shapesByLabel(converted);
  const after = shapesByLabel(placed);
  const pairs = kase.nodes
    .map((node) => [before.get(normalise(node)), after.get(normalise(node))] as const)
    .filter((pair): pair is readonly [Placed, Placed] => !!pair[0] && !!pair[1]);
  if (pairs.length === 0) return [];
  // The whole diagram moves to where it was inserted: compare against that one shift.
  const dx = pairs[0]![1].x - pairs[0]![0].x;
  const dy = pairs[0]![1].y - pairs[0]![0].y;
  const failures: string[] = [];
  for (const [from, to] of pairs) {
    const centreX = (shape: Placed) => shape.x + shape.width / 2;
    if (Math.abs(centreX(to) - centreX(from) - dx) > EPSILON || Math.abs(to.y - from.y - dy) > EPSILON) {
      failures.push(`node ${to.id} moved from Mermaid's layout`);
    }
  }
  return failures.slice(0, 5);
}

/** A picture and its badge, and nothing else. */
export function picture(elements: Placed[]): string[] {
  const images = elements.filter((element) => element.type === "image");
  const badges = elements.filter((element) => element.type === "text");
  if (images.length !== 1 || !images[0]!.hasPicture) return ["expected exactly one picture"];
  if (badges.length !== 1) return ["expected exactly one badge"];
  if (images[0]!.groupIds?.[0] === undefined || images[0]!.groupIds[0] !== badges[0]!.groupIds?.[0]) {
    return ["the badge is not grouped with its picture"];
  }
  return [];
}

export function check(
  conversion: Conversion,
  kase: Case,
  converted: Placed[],
  placed: Placed[],
): string[] {
  const failures = finiteNumbers(placed);
  if (conversion === "fallback") return [...failures, ...picture(placed)];
  return [
    ...failures,
    ...coverage(kase, placed),
    ...noOverlaps(kase, placed),
    ...labelsFit(placed),
    ...positionsKept(kase, converted, placed),
  ];
}
