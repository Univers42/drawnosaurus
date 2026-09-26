/**
 * Seeded definitions of every type the converter takes as a picture of Mermaid's own SVG.
 * Nothing in them must come out as a shape, so each case declares no node and no edge:
 * what the checks hold them to is one picture and its badge. What varies is what could
 * break the render — sizes up to 200 items, unicode where the grammar quotes it, and each
 * type's own constructs.
 */
import type { Case, Generator } from "./generators.ts";
import { nodeCount } from "./generators.ts";
import { ident, label, plain, seeded, written, type Random } from "./random.ts";

const picture = (lines: string[]): Case => ({
  source: lines.join("\n"),
  nodes: [],
  edges: [],
  messages: [],
});

/** A label for a quoted string: unicode, and never the quote that would close it. */
const quoted = (random: Random): string => written(label(random));

const day = (offset: number): string => {
  const date = new Date(Date.UTC(2026, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
};

export const gantt: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["gantt", `  title ${plain(random)}`, "  dateFormat YYYY-MM-DD"];
  if (random.chance(0.3)) lines.push("  excludes weekends");
  for (let i = 0; i < count; i += 1) {
    if (i === 0 || random.chance(0.15)) lines.push(`  section ${plain(random)} ${i}`);
    const tag = random.pick(["", "done, ", "active, ", "crit, ", "milestone, "]);
    const when =
      i > 0 && random.chance(0.5)
        ? `after ${ident("t", random.int(0, i - 1))}, ${random.int(1, 9)}d`
        : `${day(random.int(0, 120))}, ${random.int(1, 9)}d`;
    lines.push(`  ${plain(random)} ${i} :${tag}${ident("t", i)}, ${when}`);
  }
  return picture(lines);
};

export const pie: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = [random.chance(0.3) ? `pie showData title ${plain(random)}` : "pie"];
  for (let i = 0; i < count; i += 1) {
    lines.push(`  "${quoted(random)} ${i}" : ${(random.next() * 100 + 0.01).toFixed(2)}`);
  }
  return picture(lines);
};

const MINDMAP_SHAPES = [(t: string) => `[${t}]`, (t: string) => `(${t})`, (t: string) => `((${t}))`, (t: string) => `))${t}((`, (t: string) => `)${t}(`, (t: string) => `{{${t}}}`];

export const mindmap: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["mindmap", `  root((${plain(random)}))`];
  // Each node one level below some earlier node's, so the indentation is always a tree.
  const depths = [1];
  for (let i = 1; i < count; i += 1) {
    const depth = Math.min(random.int(2, depths.at(-1)! + 1), 6);
    depths.push(depth);
    const shape = random.chance(0.5) ? random.pick(MINDMAP_SHAPES) : (t: string) => ` ${t}`;
    lines.push(`${"  ".repeat(depth)}${ident("m", i)}${shape(`${plain(random)} ${i}`)}`);
  }
  return picture(lines);
};

export const timeline: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["timeline", `  title ${plain(random)}`];
  for (let i = 0; i < count; i += 1) {
    if (random.chance(0.1)) lines.push(`  section ${plain(random)} ${i}`);
    const events = Array.from({ length: random.int(1, 3) }, () => label(random));
    lines.push(`  ${2000 + i} : ${events.map(written).join(" : ")}`);
  }
  return picture(lines);
};

export const gitGraph: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = [random.chance(0.3) ? `gitGraph ${random.pick(["LR:", "TB:", "BT:"])}` : "gitGraph"];
  // Commits each branch has of its own. Mermaid refuses to branch from nothing, and to merge
  // into a branch still sitting on its parent's head ("cannot merge main into itself").
  const own = new Map([["main", 1]]);
  lines.push('  commit id: "root"');
  let on = "main";
  const commit = (id: string) => {
    const type = random.pick(["", " type: HIGHLIGHT", " type: REVERSE"]);
    const tag = random.chance(0.1) ? ` tag: "v${id}"` : "";
    lines.push(`  commit id: "${id}"${type}${tag}`);
    own.set(on, own.get(on)! + 1);
  };
  for (let i = 0; i < count; i += 1) {
    const roll = random.next();
    const others = [...own.keys()].filter((b) => b !== on);
    if (roll < 0.15) {
      on = ident("b", own.size);
      lines.push(`  branch ${on}`);
      own.set(on, 0);
    } else if (roll < 0.3 && others.length > 0) {
      on = random.pick(others);
      lines.push(`  checkout ${on}`);
    } else if (roll < 0.4 && others.length > 0 && own.get(on)! > 0) {
      // The branch merged gets a commit its target lacks, so the merge has something to do.
      const into = on;
      const from = random.pick(others);
      lines.push(`  checkout ${from}`);
      on = from;
      commit(`c${i}a`);
      lines.push(`  checkout ${into}`, `  merge ${from}`);
      on = into;
    } else {
      commit(`c${i}`);
    }
  }
  return picture(lines);
};

export const journey: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["journey", `  title ${plain(random)}`];
  for (let i = 0; i < count; i += 1) {
    if (i === 0 || random.chance(0.2)) lines.push(`  section ${plain(random)} ${i}`);
    const people = Array.from({ length: random.int(1, 3) }, () => random.pick(["Me", "Cat", "Ops"]));
    lines.push(`    ${plain(random)} ${i}: ${random.int(1, 5)}: ${people.join(", ")}`);
  }
  return picture(lines);
};

export const quadrant: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = [
    "quadrantChart",
    `  title ${plain(random)}`,
    "  x-axis Low reach --> High reach",
    "  y-axis Low effort --> High effort",
    ...[1, 2, 3, 4].map((q) => `  quadrant-${q} ${plain(random)}`),
  ];
  for (let i = 0; i < count; i += 1) {
    // The grammar reads a coordinate as `1` or `0.…`; `1.00` is a lexical error.
    const at = () => (random.next() * 0.99).toFixed(2);
    lines.push(`  Point ${i}: [${at()}, ${at()}]`);
  }
  return picture(lines);
};

export const sankey: Generator = (seed) => {
  const random = seeded(seed);
  const count = Math.max(2, nodeCount(random));
  // ASCII only: the grammar's quoted field takes nothing else (`ESCAPED_TEXT`).
  const names = Array.from({ length: count }, (_, i) => `${plain(random)} ${i}`);
  const lines = ["sankey-beta", ""];
  // Flows only from an earlier node to a later one: a sankey has no cycles.
  for (let i = 1; i < count; i += 1) {
    lines.push(`"${names[random.int(0, i - 1)]}","${names[i]}",${random.int(1, 500)}`);
  }
  return picture(lines);
};

export const xychart: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const values = () => Array.from({ length: count }, () => random.int(0, 1000)).join(", ");
  const lines = [
    `xychart-beta${random.chance(0.3) ? " horizontal" : ""}`,
    `  title "${quoted(random)}"`,
    `  x-axis [${Array.from({ length: count }, (_, i) => `"${quoted(random)} ${i}"`).join(", ")}]`,
    `  y-axis "${quoted(random)}" 0 --> 1000`,
  ];
  if (random.chance(0.7)) lines.push(`  bar [${values()}]`);
  lines.push(`  line [${values()}]`);
  return picture(lines);
};

export const block: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["block-beta", `  columns ${random.int(1, 6)}`];
  for (let i = 0; i < count; i += 1) {
    const shape = random.pick([`["${quoted(random)}"]`, `("${quoted(random)}")`, `{"${quoted(random)}"}`, ""]);
    lines.push(`  ${ident("b", i)}${shape}`);
  }
  for (let i = 1; i < count; i += 1) {
    if (random.chance(0.3)) lines.push(`  ${ident("b", random.int(0, i - 1))} --> ${ident("b", i)}`);
  }
  return picture(lines);
};

const ICONS = ["cloud", "database", "disk", "internet", "server"];

export const architecture: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["architecture-beta"];
  const groups = random.int(0, 3);
  for (let g = 0; g < groups; g += 1) lines.push(`  group ${ident("g", g)}(${random.pick(ICONS)})[${plain(random)}]`);
  for (let i = 0; i < count; i += 1) {
    const inside = groups > 0 && random.chance(0.5) ? ` in ${ident("g", random.int(0, groups - 1))}` : "";
    lines.push(`  service ${ident("s", i)}(${random.pick(ICONS)})[${plain(random)} ${i}]${inside}`);
  }
  const sides = ["L", "R", "T", "B"];
  for (let i = 1; i < count; i += 1) {
    if (random.chance(0.6)) {
      lines.push(`  ${ident("s", random.int(0, i - 1))}:${random.pick(sides)} -- ${random.pick(sides)}:${ident("s", i)}`);
    }
  }
  return picture(lines);
};

export const c4: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["C4Context", `  title ${plain(random)}`];
  const kinds = ["Person", "Person_Ext", "System", "System_Ext", "SystemDb", "SystemQueue"];
  let bounded = false;
  for (let i = 0; i < count; i += 1) {
    if (!bounded && random.chance(0.05)) {
      lines.push(`  Enterprise_Boundary(${ident("eb", i)}, "${quoted(random)}") {`);
      bounded = true;
    }
    lines.push(`  ${random.pick(kinds)}(${ident("e", i)}, "${quoted(random)} ${i}", "${quoted(random)}")`);
    if (bounded && random.chance(0.2)) {
      lines.push("  }");
      bounded = false;
    }
  }
  if (bounded) lines.push("  }");
  for (let i = 1; i < count; i += 1) {
    if (random.chance(0.5)) {
      lines.push(`  ${random.pick(["Rel", "BiRel"])}(${ident("e", random.int(0, i - 1))}, ${ident("e", i)}, "${quoted(random)}")`);
    }
  }
  return picture(lines);
};

export const requirement: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["requirementDiagram"];
  const kinds = ["requirement", "functionalRequirement", "performanceRequirement", "designConstraint"];
  for (let i = 0; i < count; i += 1) {
    if (random.chance(0.7)) {
      lines.push(
        `  ${random.pick(kinds)} ${ident("r", i)} {`,
        `    id: ${i}`,
        `    text: "${quoted(random)}"`,
        `    risk: ${random.pick(["low", "medium", "high"])}`,
        `    verifymethod: ${random.pick(["analysis", "inspection", "test", "demonstration"])}`,
        "  }",
      );
    } else {
      lines.push(`  element ${ident("r", i)} {`, `    type: "${quoted(random)}"`, "  }");
    }
  }
  const relations = ["contains", "copies", "derives", "satisfies", "verifies", "refines", "traces"];
  for (let i = 1; i < count; i += 1) {
    if (random.chance(0.6)) {
      lines.push(`  ${ident("r", random.int(0, i - 1))} - ${random.pick(relations)} -> ${ident("r", i)}`);
    }
  }
  return picture(lines);
};

export const kanban: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["kanban"];
  for (let i = 0; i < count; i += 1) {
    if (i === 0 || random.chance(0.2)) lines.push(`  ${ident("col", i)}[${plain(random)}]`);
    const meta = random.chance(0.3) ? `@{ priority: '${random.pick(["High", "Low", "Very High"])}' }` : "";
    lines.push(`    ${ident("k", i)}[${plain(random)} ${i}]${meta}`);
  }
  return picture(lines);
};

export const packet: Generator = (seed) => {
  const random = seeded(seed);
  const count = nodeCount(random);
  const lines = ["packet-beta"];
  let bit = 0;
  for (let i = 0; i < count; i += 1) {
    const width = random.int(1, 32);
    lines.push(`  ${bit}-${bit + width - 1}: "${quoted(random)}"`);
    bit += width;
  }
  return picture(lines);
};
