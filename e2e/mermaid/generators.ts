/**
 * Seeded Mermaid definitions, one generator per diagram type. Each case carries what it
 * declared — its nodes' labels and its edges — so the checks know what must come out
 * without parsing Mermaid themselves.
 *
 * Every label ends in its own index, so a label names exactly one node however often the
 * random words repeat.
 */
import { ident, label, seeded, written, type Random } from "./random.ts";

export interface Case {
  source: string;
  /** Each declared node's label; each must come out as a shape carrying that text. */
  nodes: string[];
  /** Declared edges, by index into `nodes`; each must come out as an arrow between them. */
  edges: [number, number][];
  /** Arrow labels declared; each must come out on some arrow — how a sequence's messages,
   *  which bind nothing, are found. */
  messages: string[];
}

export type Generator = (seed: number) => Case;

/**
 * How the oracle's converter takes a type (`@excalidraw/mermaid-to-excalidraw@2.2.2`'s
 * `graphToExcalidraw`): `native` as shapes and arrows, `fallback` as one picture of
 * Mermaid's own SVG.
 */
export type Conversion = "native" | "fallback";

/** Mostly small diagrams, now and then a big one, up to 200 nodes. */
export function nodeCount(random: Random): number {
  const roll = random.next();
  if (roll < 0.7) return random.int(1, 20);
  if (roll < 0.95) return random.int(21, 80);
  return random.int(81, 200);
}

const unique = (random: Random, index: number): string => `${label(random)} ${index}`;

/** Flowchart shapes, the classic brackets and the v11 `@{ shape }` form. */
const FLOWCHART_SHAPES: ((text: string) => string)[] = [
  (t) => `["${t}"]`,
  (t) => `("${t}")`,
  (t) => `(["${t}"])`,
  (t) => `[["${t}"]]`,
  (t) => `[("${t}")]`,
  (t) => `(("${t}"))`,
  (t) => `>"${t}"]`,
  (t) => `{"${t}"}`,
  (t) => `{{"${t}"}}`,
  (t) => `[/"${t}"/]`,
  (t) => `[\\"${t}"\\]`,
  (t) => `[/"${t}"\\]`,
  (t) => `[\\"${t}"/]`,
  (t) => `((("${t}")))`,
  (t) => `@{ shape: ${["rect", "rounded", "stadium", "diamond", "circle", "hex", "cyl", "doc"][t.length % 8]}, label: "${t}" }`,
];

const FLOWCHART_LINKS = ["-->", "---", "-.->", "==>", "--o", "--x", "<-->", "-.-", "===", "~~~"];

export const flowchart: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const nodes = Array.from({ length: count }, (_, i) => unique(random, i));
  const lines = [`flowchart ${random.pick(["TD", "TB", "BT", "LR", "RL"])}`];

  // Nodes, some of them inside subgraphs nested up to three deep.
  let depth = 0;
  let subgraphs = 0;
  for (let i = 0; i < count; i += 1) {
    if (depth < 3 && random.chance(0.06)) {
      lines.push(`${"  ".repeat(depth)}subgraph ${ident("S", subgraphs)} ["${written(label(random))}"]`);
      subgraphs += 1;
      depth += 1;
      if (random.chance(0.3)) lines.push(`${"  ".repeat(depth)}direction ${random.pick(["TB", "LR"])}`);
    }
    lines.push(`${"  ".repeat(depth)}${ident("n", i)}${random.pick(FLOWCHART_SHAPES)(written(nodes[i]!))}`);
    if (depth > 0 && random.chance(0.15)) {
      depth -= 1;
      lines.push(`${"  ".repeat(depth)}end`);
    }
  }
  while (depth > 0) {
    depth -= 1;
    lines.push(`${"  ".repeat(depth)}end`);
  }

  const edges = randomEdges(random, count);
  // Only what is drawn must come out. `~~~` is an invisible link: Mermaid lays it out but
  // draws nothing. A node linked to itself the converter drops, label and all — its parser
  // finds no path for it among Mermaid's (`parseMermaidFlowChartDiagram`), so the oracle
  // shows nothing either; it is generated anyway, so a loop is proven not to break the rest.
  const drawn: [number, number][] = [];
  const messages: string[] = [];
  for (const [from, to] of edges) {
    const link = random.pick(FLOWCHART_LINKS);
    const text = random.chance(0.25) && link !== "~~~" ? label(random) : "";
    lines.push(`${ident("n", from)} ${link}${text ? `|"${written(text)}"|` : ""} ${ident("n", to)}`);
    if (link === "~~~" || from === to) continue;
    drawn.push([from, to]);
    if (text) messages.push(text);
  }

  // Styles: a class or two, and a direct style now and then.
  if (random.chance(0.4)) {
    lines.push("classDef hot fill:#ffc9c9,stroke:#e03131,stroke-width:3px");
    lines.push(`class ${ident("n", random.int(0, count - 1))} hot`);
  }
  if (random.chance(0.3)) {
    lines.push(`style ${ident("n", random.int(0, count - 1))} fill:#a5d8ff,stroke-dasharray: 5 5`);
  }

  return { source: lines.join("\n"), nodes, edges: drawn, messages };
};

/** Edges for `count` nodes: a spanning chain for connectedness, then extras — loops among them. */
function randomEdges(random: Random, count: number): [number, number][] {
  const edges: [number, number][] = [];
  for (let i = 1; i < count; i += 1) {
    if (random.chance(0.85)) edges.push([random.int(0, i - 1), i]);
  }
  for (let extra = random.int(0, Math.ceil(count / 4)); extra > 0; extra -= 1) {
    edges.push([random.int(0, count - 1), random.int(0, count - 1)]);
  }
  return edges;
}

/** Every message arrow the converter draws (`SEQUENCE_ARROW_TYPES`). */
const SEQUENCE_ARROWS = ["->", "-->", "->>", "-->>", "-x", "--x", "-)", "--)"];
const SEQUENCE_BLOCKS = ["loop", "opt", "alt", "par", "critical", "break", "rect rgb(233, 236, 239)"];

/**
 * Participants and actors, messages of every drawn kind between them, notes, boxes,
 * activations, and loop/alt/par blocks nested two deep. A participant is a labelled box
 * (twice: top and bottom); an actor is a figure whose name is not a box's label, so only
 * participants are counted as nodes. Messages bind nothing: each is found by its text.
 */
export const sequence: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["sequenceDiagram"];
  if (random.chance(0.3)) lines.push("autonumber");
  const nodes: string[] = [];
  const ids: string[] = [];
  let boxed = false;
  for (let i = 0; i < count; i += 1) {
    if (!boxed && random.chance(0.05)) {
      lines.push(`box Group ${written(label(random))}`);
      boxed = true;
    }
    const name = unique(random, i);
    const actor = random.chance(0.15);
    lines.push(`${actor ? "actor" : "participant"} ${ident("p", i)} as ${written(name)}`);
    if (!actor) nodes.push(name);
    ids.push(ident("p", i));
    if (boxed && random.chance(0.3)) {
      lines.push("end");
      boxed = false;
    }
  }
  if (boxed) lines.push("end");

  const messages: string[] = [];
  // Each open block, and whether its current section has had a message yet: Mermaid lays
  // an empty one out at NaN, and everything after it, so its own SVG loses them — never
  // left empty here (`skeleton.test`'s own case covers what that does to an import).
  const open: { block: string; filled: boolean }[] = [];
  const active: string[] = [];
  const message = (m: number) => {
    const text = `${label(random)} m${m}`;
    lines.push(`${random.pick(ids)}${random.pick(SEQUENCE_ARROWS)}${random.pick(ids)}: ${written(text)}`);
    messages.push(text);
    for (const block of open) block.filled = true;
  };
  const total = random.int(count > 1 ? 1 : 0, count * 2);
  for (let m = 0; m < total; m += 1) {
    const roll = random.next();
    if (roll < 0.05 && open.length < 2) {
      const block = random.pick(SEQUENCE_BLOCKS);
      lines.push(block.startsWith("rect") ? block : `${block} ${written(label(random))}`);
      open.push({ block, filled: false });
    } else if (roll < 0.08 && open.at(-1)?.filled) {
      const top = open.at(-1)!;
      const middle = { alt: "else", par: "and", critical: "option" }[top.block];
      if (middle && random.chance(0.5)) {
        lines.push(`${middle} ${written(label(random))}`);
        top.filled = false;
      } else {
        lines.push("end");
        open.pop();
      }
    } else if (roll < 0.12) {
      const text = `${label(random)} note${m}`;
      const at = random.pick(ids);
      const where = random.pick([`right of ${at}`, `left of ${at}`, `over ${at}`, `over ${at},${random.pick(ids)}`]);
      lines.push(`Note ${where}: ${written(text)}`);
      nodes.push(text);
    } else if (roll < 0.15) {
      const who = random.pick(ids);
      lines.push(`activate ${who}`);
      active.push(who);
    } else if (roll < 0.18 && active.length > 0) {
      lines.push(`deactivate ${active.pop()}`);
    } else {
      message(m);
    }
  }
  for (; open.length > 0; open.pop()) {
    if (!open.at(-1)!.filled) message(total);
    lines.push("end");
  }
  while (active.length > 0) lines.push(`deactivate ${active.pop()}`);
  return { source: lines.join("\n"), nodes, edges: [], messages };
};

const CLASS_RELATIONS = ["<|--", "*--", "o--", "-->", "--", "..>", "..|>", ".."];
const CLASS_MEMBERS = ["+String name", "-int count", "#List~int~ items", "~bool ready$", "+run(int x) bool", "-reset()*", "+size() int"];

/**
 * Classes with labels, members and annotations, some in namespaces; relations of every
 * kind, some labelled, some with cardinalities, some a class to itself.
 */
export const classDiagram: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const nodes = Array.from({ length: count }, (_, i) => unique(random, i));
  const lines = ["classDiagram"];
  if (random.chance(0.3)) lines.push(`direction ${random.pick(["TB", "BT", "LR", "RL"])}`);
  let spaced = false;
  let namespaces = 0;
  for (let i = 0; i < count; i += 1) {
    if (!spaced && random.chance(0.05)) {
      lines.push(`namespace ${ident("N", namespaces)} {`);
      namespaces += 1;
      spaced = true;
    }
    const members = Array.from({ length: random.int(0, 3) }, () => random.pick(CLASS_MEMBERS));
    const head = `class ${ident("C", i)}["${written(nodes[i]!)}"]`;
    if (members.length === 0) lines.push(head);
    else lines.push(`${head} {`, ...members.map((member) => `  ${member}`), "}");
    if (spaced && random.chance(0.3)) {
      lines.push("}");
      spaced = false;
    }
  }
  if (spaced) lines.push("}");
  for (let i = 0; i < count; i += 1) {
    if (random.chance(0.08)) {
      lines.push(`<<${random.pick(["interface", "abstract", "service", "enumeration"])}>> ${ident("C", i)}`);
    }
  }
  const messages: string[] = [];
  const edges = randomEdges(random, count);
  for (const [from, to] of edges) {
    const text = random.chance(0.3) ? label(random) : "";
    const cardinality = random.chance(0.2);
    lines.push(
      `${ident("C", from)}${cardinality ? ' "1"' : ""} ${random.pick(CLASS_RELATIONS)}${cardinality ? ' "*"' : ""} ${ident("C", to)}${text ? ` : ${written(text)}` : ""}`,
    );
    if (text) messages.push(text);
  }
  if (random.chance(0.3)) lines.push(`style ${ident("C", random.int(0, count - 1))} fill:#a5d8ff,stroke:#1971c2`);
  return { source: lines.join("\n"), nodes, edges, messages };
};

/**
 * States, some inside composite states two deep, with transitions inside each scope,
 * start and end markers, forks and choices, notes. A state to itself is generated and not
 * expected: the converter finds no path for it (`parseStateEdge`), as for a flowchart.
 */
export const state: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const nodes = Array.from({ length: count }, (_, i) => unique(random, i));
  const lines = ["stateDiagram-v2"];
  if (random.chance(0.3)) lines.push(`direction ${random.pick(["TB", "LR"])}`);
  const edges: [number, number][] = [];
  const messages: string[] = [];
  let composites = 0;
  let pseudo = 0;

  // One scope: its states declared, then transitions among them only.
  const scope = (members: number[], depth: number) => {
    const pad = "  ".repeat(depth);
    const inside: number[] = [];
    for (const i of members) {
      lines.push(`${pad}state "${written(nodes[i]!)}" as ${ident("s", i)}`);
      inside.push(i);
    }
    if (inside.length === 0) return;
    if (random.chance(0.7)) lines.push(`${pad}[*] --> ${ident("s", inside[0]!)}`);
    for (const [a, b] of randomEdges(random, inside.length)) {
      const [from, to] = [inside[a]!, inside[b]!];
      const text = random.chance(0.3) ? label(random) : "";
      lines.push(`${pad}${ident("s", from)} --> ${ident("s", to)}${text ? ` : ${written(text)}` : ""}`);
      if (from === to) continue;
      edges.push([from, to]);
      if (text) messages.push(text);
    }
    if (inside.length > 2 && random.chance(0.2)) {
      const kind = random.pick(["fork", "join", "choice"]);
      const id = ident("x", pseudo);
      pseudo += 1;
      lines.push(`${pad}state ${id} <<${kind}>>`);
      lines.push(`${pad}${ident("s", inside[0]!)} --> ${id}`, `${pad}${id} --> ${ident("s", inside[1]!)}`);
      lines.push(`${pad}${id} --> ${ident("s", inside[2]!)}`);
    }
    if (random.chance(0.5)) lines.push(`${pad}${ident("s", inside.at(-1)!)} --> [*]`);
    if (random.chance(0.1)) {
      lines.push(`${pad}note right of ${ident("s", inside[0]!)} : ${written(label(random))}`);
    }
  };

  // Split the states: most at the top, runs of them into composites nested up to two deep.
  const top: number[] = [];
  let i = 0;
  while (i < count) {
    if (random.chance(0.08) && count - i > 1) {
      const size = random.int(1, Math.min(12, count - i));
      const members = Array.from({ length: size }, (_, k) => i + k);
      i += size;
      const id = ident("K", composites);
      composites += 1;
      lines.push(`state ${id} {`);
      if (members.length > 3 && random.chance(0.3)) {
        const nested = members.splice(0, random.int(1, members.length - 1));
        lines.push(`  state ${ident("K", composites)} {`);
        composites += 1;
        scope(nested, 2);
        lines.push("  }");
      }
      scope(members, 1);
      lines.push("}");
    } else {
      top.push(i);
      i += 1;
    }
  }
  scope(top, 0);
  return { source: lines.join("\n"), nodes, edges, messages };
};

const ER_ENDS_LEFT = ["|o", "||", "}o", "}|"];
const ER_ENDS_RIGHT = ["o|", "||", "o{", "|{"];
const ER_ATTRIBUTES = ["string name", "int id PK", "int owner FK", "string email UK", 'float total "in euros"', "date created"];

/** Entities with aliases and attributes; relationships of every cardinality, each labelled. */
export const er: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const nodes = Array.from({ length: count }, (_, i) => unique(random, i));
  const lines = ["erDiagram"];
  for (let i = 0; i < count; i += 1) {
    const attributes = Array.from({ length: random.int(0, 4) }, () => random.pick(ER_ATTRIBUTES));
    lines.push(`${ident("E", i)}["${written(nodes[i]!)}"] {`, ...attributes.map((a) => `  ${a}`), "}");
  }
  const messages: string[] = [];
  const edges = randomEdges(random, count);
  for (const [from, to] of edges) {
    const text = label(random);
    const line = random.pick(["--", ".."]);
    lines.push(
      `${ident("E", from)} ${random.pick(ER_ENDS_LEFT)}${line}${random.pick(ER_ENDS_RIGHT)} ${ident("E", to)} : "${written(text)}"`,
    );
    messages.push(text);
  }
  return { source: lines.join("\n"), nodes, edges, messages };
};
