export type NodeShape = "rectangle" | "diamond" | "ellipse" | "rounded";

export interface ParsedNode {
  id: string;
  label: string;
  shape: NodeShape;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed";
}

export interface ParsedDiagram {
  direction: "TD" | "LR";
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

export function parseMermaidFlowchart(code: string): ParsedDiagram {
  const lines = code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("%%"));

  let direction: "TD" | "LR" = "TD";
  const nodeMap = new Map<string, { label: string; shape: NodeShape }>();
  const edges: ParsedEdge[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/;$/, "");
    if (/^(graph|flowchart)\s+(TD|TB|LR|RL)/i.test(line)) {
      direction = /LR|RL/i.test(line) ? "LR" : "TD";
      continue;
    }

    if (/\s*(-->|---|-.->|==>)\s*/.test(line)) {
      parseEdgeLine(line, nodeMap, edges);
    } else {
      parseSingleNode(line, nodeMap);
    }
  }

  const nodes = layoutNodes(nodeMap, edges, direction);
  return { direction, nodes, edges };
}

function parseSingleNode(
  raw: string,
  nodeMap: Map<string, { label: string; shape: NodeShape }>,
): void {
  const trimmed = raw.trim();
  let id = "";
  let label = "";
  let shape: NodeShape = "rectangle";

  const doubleParen = /^([a-zA-Z0-9_-]+)\s*\(\(\s*(.*?)\s*\)\)$/.exec(trimmed);
  const diamond = /^([a-zA-Z0-9_-]+)\s*\{\s*(.*?)\s*\}$/.exec(trimmed);
  const rounded = /^([a-zA-Z0-9_-]+)\s*\(\s*(.*?)\s*\)$/.exec(trimmed);
  const rect = /^([a-zA-Z0-9_-]+)\s*\[\s*(.*?)\s*\]$/.exec(trimmed);
  const plain = /^([a-zA-Z0-9_-]+)$/.exec(trimmed);

  if (doubleParen && doubleParen[1]) {
    id = doubleParen[1];
    label = doubleParen[2] || id;
    shape = "ellipse";
  } else if (diamond && diamond[1]) {
    id = diamond[1];
    label = diamond[2] || id;
    shape = "diamond";
  } else if (rounded && rounded[1]) {
    id = rounded[1];
    label = rounded[2] || id;
    shape = "rounded";
  } else if (rect && rect[1]) {
    id = rect[1];
    label = rect[2] || id;
    shape = "rectangle";
  } else if (plain && plain[1]) {
    id = plain[1];
    label = id;
    shape = "rectangle";
  }

  if (id) {
    const existing = nodeMap.get(id);
    if (existing && shape === "rectangle" && label === id) {
      return;
    }
    nodeMap.set(id, { label, shape });
  }
}

function parseEdgeLine(
  line: string,
  nodeMap: Map<string, { label: string; shape: NodeShape }>,
  edges: ParsedEdge[],
): void {
  const arrowMatch = line.match(
    /^(.+?)\s*(?:-->\|(.*?)\||--\s*(.*?)\s*-->|-->|---|-.->|==>)\s*(.+)$/,
  );
  if (!arrowMatch) return;

  const [, rawLeft, pipeLabel, inlineLabel, rawRight] = arrowMatch;
  if (!rawLeft || !rawRight) return;

  const label = pipeLabel ?? inlineLabel;
  const isDashed = line.includes("-.->");

  parseSingleNode(rawLeft.trim(), nodeMap);
  parseSingleNode(rawRight.trim(), nodeMap);

  const fromId = rawLeft
    .trim()
    .split(/\[|\(|\{/)[0]
    ?.trim();
  const toId = rawRight
    .trim()
    .split(/\[|\(|\{/)[0]
    ?.trim();

  if (fromId && toId) {
    edges.push({
      from: fromId,
      to: toId,
      label: label?.trim() || undefined,
      style: isDashed ? "dashed" : "solid",
    });
  }
}

function layoutNodes(
  nodeMap: Map<string, { label: string; shape: NodeShape }>,
  edges: ParsedEdge[],
  direction: "TD" | "LR",
): ParsedNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeMap.keys()) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of edges) {
    if (inDegree.has(edge.to)) inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    if (adj.has(edge.from)) adj.get(edge.from)?.push(edge.to);
  }

  const layers: string[][] = [];
  const visited = new Set<string>();
  let currentLayer = Array.from(nodeMap.keys()).filter((id) => (inDegree.get(id) ?? 0) === 0);

  if (currentLayer.length === 0 && nodeMap.size > 0) {
    currentLayer = [Array.from(nodeMap.keys())[0]!];
  }

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    currentLayer.forEach((id) => visited.add(id));
    const nextLayer: string[] = [];

    for (const id of currentLayer) {
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor) && !nextLayer.includes(neighbor)) {
          nextLayer.push(neighbor);
        }
      }
    }
    currentLayer = nextLayer;
  }

  for (const id of nodeMap.keys()) {
    if (!visited.has(id)) {
      if (layers.length === 0) layers.push([]);
      layers[0]?.push(id);
    }
  }

  const nodeW = 160;
  const nodeH = 70;
  const gapX = direction === "TD" ? 60 : 100;
  const gapY = direction === "TD" ? 90 : 60;
  const result: ParsedNode[] = [];

  layers.forEach((layer, layerIdx) => {
    const layerLen = layer.length;
    layer.forEach((id, itemIdx) => {
      const info = nodeMap.get(id)!;
      let x = 0;
      let y = 0;

      if (direction === "TD") {
        x = 100 + (itemIdx - (layerLen - 1) / 2) * (nodeW + gapX);
        y = 100 + layerIdx * (nodeH + gapY);
      } else {
        x = 100 + layerIdx * (nodeW + gapX);
        y = 100 + (itemIdx - (layerLen - 1) / 2) * (nodeH + gapY);
      }

      result.push({
        id,
        label: info.label,
        shape: info.shape,
        x: Math.round(x),
        y: Math.round(y),
        width: nodeW,
        height: nodeH,
      });
    });
  });

  return result;
}
