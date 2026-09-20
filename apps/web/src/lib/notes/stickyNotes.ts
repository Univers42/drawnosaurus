import type { DrawElementDto } from "@drawnosaurus/contract";

export type StickyColor = "yellow" | "green" | "blue" | "pink" | "purple";

export interface StickyPalette {
  bg: string;
  stroke: string;
}

export const STICKY_PALETTES: Record<StickyColor, StickyPalette> = {
  yellow: { bg: "#fff3bf", stroke: "#fab005" },
  green: { bg: "#d3f9d8", stroke: "#40c057" },
  blue: { bg: "#e7f5ff", stroke: "#228be6" },
  pink: { bg: "#ffe3e3", stroke: "#fa5252" },
  purple: { bg: "#f3d9fa", stroke: "#be4bdb" },
};

function randomNonce(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export function createStickyNote(
  x: number,
  y: number,
  text = "",
  color: StickyColor = "yellow",
): [DrawElementDto, DrawElementDto] {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 100_000);
  const noteId = `sticky_${now}_${rand}`;
  const textId = `sticky_text_${now}_${rand}`;
  const palette = STICKY_PALETTES[color];

  const noteElement: DrawElementDto = {
    id: noteId,
    type: "rectangle",
    x,
    y,
    width: 180,
    height: 180,
    angle: 0,
    strokeColor: palette.stroke,
    backgroundColor: palette.bg,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: 8,
    seed: Math.floor(Math.random() * 100_000),
    boundTextId: textId,
    version: 1,
    versionNonce: randomNonce(),
    updated: now,
    isDeleted: false,
  };

  const textElement: DrawElementDto = {
    id: textId,
    type: "text",
    x,
    y: y + 20,
    width: 180,
    height: 30,
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
    text,
    fontSize: 18,
    containerId: noteId,
    version: 1,
    versionNonce: randomNonce(),
    updated: now,
    isDeleted: false,
  };

  return [noteElement, textElement];
}
