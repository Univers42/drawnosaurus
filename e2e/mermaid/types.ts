/**
 * Every Mermaid type the fuzzer covers, with how the oracle's converter takes it
 * (`@excalidraw/mermaid-to-excalidraw@2.2.2`'s `graphToExcalidraw`): `native` as shapes
 * and arrows, `fallback` as one picture of Mermaid's own SVG.
 */
import {
  classDiagram,
  er,
  flowchart,
  sequence,
  state,
  type Conversion,
  type Generator,
} from "./generators.ts";
import * as pictures from "./pictures.ts";

export const TYPES: Record<string, { conversion: Conversion; generate: Generator }> = {
  flowchart: { conversion: "native", generate: flowchart },
  sequence: { conversion: "native", generate: sequence },
  class: { conversion: "native", generate: classDiagram },
  state: { conversion: "native", generate: state },
  er: { conversion: "native", generate: er },
  gantt: { conversion: "fallback", generate: pictures.gantt },
  pie: { conversion: "fallback", generate: pictures.pie },
  mindmap: { conversion: "fallback", generate: pictures.mindmap },
  timeline: { conversion: "fallback", generate: pictures.timeline },
  gitGraph: { conversion: "fallback", generate: pictures.gitGraph },
  journey: { conversion: "fallback", generate: pictures.journey },
  quadrant: { conversion: "fallback", generate: pictures.quadrant },
  sankey: { conversion: "fallback", generate: pictures.sankey },
  xychart: { conversion: "fallback", generate: pictures.xychart },
  block: { conversion: "fallback", generate: pictures.block },
  architecture: { conversion: "fallback", generate: pictures.architecture },
  c4: { conversion: "fallback", generate: pictures.c4 },
  requirement: { conversion: "fallback", generate: pictures.requirement },
  kanban: { conversion: "fallback", generate: pictures.kanban },
  packet: { conversion: "fallback", generate: pictures.packet },
};
