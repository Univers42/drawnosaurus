import type { DrawElementDto } from "@drawnosaurus/contract";
import type { ParsedDiagram, ParsedNode, ParsedEdge } from "./mermaidParser.ts";

function randomNonce(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

const PASTEL_PALETTE = ["#e7f5ff", "#fff3bf", "#d3f9d8", "#ffe3e3", "#f3d9fa"];

export function mermaidToElements(
  diagram: ParsedDiagram,
  originX = 200,
  originY = 150,
): DrawElementDto[] {
  const elements: DrawElementDto[] = [];
  const idMap = new Map<string, { shapeId: string; node: ParsedNode }>();
  const now = Date.now();

  diagram.nodes.forEach((node, idx) => {
    const shapeId = `mermaid_node_${node.id}_${idx}`;
    const textId = `mermaid_text_${node.id}_${idx}`;
    idMap.set(node.id, { shapeId, node });

    const posX = originX + node.x;
    const posY = originY + node.y;
    const bg = PASTEL_PALETTE[idx % PASTEL_PALETTE.length] ?? "#e7f5ff";
    const mappedType =
      node.shape === "diamond" ? "diamond" : node.shape === "ellipse" ? "ellipse" : "rectangle";

    const shapeElement: DrawElementDto = {
      id: shapeId,
      type: mappedType,
      x: posX,
      y: posY,
      width: node.width,
      height: node.height,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: bg,
      fillStyle: "hachure",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: node.shape === "rounded" ? 12 : null,
      seed: Math.floor(Math.random() * 100_000),
      boundTextId: textId,
      version: 1,
      versionNonce: randomNonce(),
      updated: now,
      isDeleted: false,
    };
    elements.push(shapeElement);

    const textElement: DrawElementDto = {
      id: textId,
      type: "text",
      x: posX,
      y: posY + Math.floor(node.height / 3),
      width: node.width,
      height: 24,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      roundness: null,
      seed: Math.floor(Math.random() * 100_000),
      text: node.label,
      fontSize: 16,
      containerId: shapeId,
      version: 1,
      versionNonce: randomNonce(),
      updated: now,
      isDeleted: false,
    };
    elements.push(textElement);
  });

  diagram.edges.forEach((edge: ParsedEdge, idx: number) => {
    const from = idMap.get(edge.from);
    const to = idMap.get(edge.to);
    if (!from || !to) return;

    const startX = originX + from.node.x + from.node.width / 2;
    const startY = originY + from.node.y + from.node.height;
    const endX = originX + to.node.x + to.node.width / 2;
    const endY = originY + to.node.y;

    const arrowId = `mermaid_edge_${idx}_${from.shapeId}_${to.shapeId}`;
    const arrowElement: DrawElementDto = {
      id: arrowId,
      type: "arrow",
      x: startX,
      y: startY,
      width: endX - startX,
      height: endY - startY,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: edge.style,
      roughness: 1,
      opacity: 100,
      roundness: null,
      seed: Math.floor(Math.random() * 100_000),
      points: [
        [0, 0],
        [endX - startX, endY - startY],
      ],
      startBinding: from.shapeId,
      endBinding: to.shapeId,
      endArrowhead: "arrow",
      version: 1,
      versionNonce: randomNonce(),
      updated: now,
      isDeleted: false,
    };
    elements.push(arrowElement);
  });

  return elements;
}
