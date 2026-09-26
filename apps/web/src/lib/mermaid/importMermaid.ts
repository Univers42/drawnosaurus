/**
 * A Mermaid definition as elements, through the oracle's own converter
 * (`@excalidraw/mermaid-to-excalidraw`, the version the oracle pins). Loaded the first time
 * a diagram is converted: it carries Mermaid, which nothing else on the board needs.
 */
import type { DrawElementDto } from "@drawnosaurus/contract";
import { skeletonToElements, type SkeletonResult } from "./skeleton.ts";

type Parse = (definition: string) => Promise<SkeletonResult>;

let parser: Promise<Parse> | null = null;

function load(): Promise<Parse> {
  parser ??= import("@excalidraw/mermaid-to-excalidraw").then(
    (lib) => lib.parseMermaidToExcalidraw as unknown as Parse,
  );
  return parser;
}

/**
 * `definition`'s diagram as elements. A definition that fails is tried once more with its
 * double quotes as single ones, and its first error is the one thrown — so a line and
 * column in it still point into what was typed (`TTDDialog/common.ts@1118751f:73-94`).
 */
export async function mermaidToElements(definition: string): Promise<DrawElementDto[]> {
  const parse = await load();
  let result: SkeletonResult;
  try {
    result = await parse(definition);
  } catch (error) {
    if (!definition.includes('"')) throw error;
    try {
      result = await parse(definition.replace(/"/g, "'"));
    } catch {
      throw error;
    }
  }
  return skeletonToElements(result, { lifelines: diagramType(definition) === "sequenceDiagram" });
}

/**
 * The keyword that names `definition`'s diagram type — its first word once the front
 * matter (`---` … `---`), `%%{…}%%` directives and `%%` comments Mermaid allows ahead of
 * it are skipped.
 */
export function diagramType(definition: string): string {
  const body = definition
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---[^\n]*/, "")
    .replace(/%%\{[\s\S]*?\}%%/g, "");
  const line = body.split(/\r?\n/).find((l) => l.trim() !== "" && !l.trim().startsWith("%%"));
  return line?.trim().split(/[\s;:]/)[0] ?? "";
}

/** `elements` as the scene document `engine.insertJson` places. */
export function sceneJson(elements: readonly DrawElementDto[]): string {
  return JSON.stringify({ type: "osidraw", version: 1, elements });
}

/** The diagram keywords the oracle's paste looks for (`mermaid.ts@1118751f`). */
const DIAGRAM_KEYWORDS = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "C4Context",
  "mindmap",
  "timeline",
  "zenuml",
  "sankey",
  "xychart",
  "block",
];

const MERMAID_START = new RegExp(
  `^(?:%%{.*?}%%[\\s\\n]*)?\\b(?:${DIAGRAM_KEYWORDS.map((x) => `\\s*${x}(-beta)?`).join("|")})\\b`,
);

/** Whether pasted text may be a Mermaid definition — the oracle's `isMaybeMermaidDefinition`. */
export function looksLikeMermaid(text: string): boolean {
  return MERMAID_START.test(text.trim());
}
