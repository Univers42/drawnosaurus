import type { DrawElementDto } from "@drawnosaurus/contract";

export type StickyColor = "yellow" | "green" | "blue" | "pink" | "purple";

export interface StickyPalette {
  bg: string;
  stroke: string;
}

/**
 * Authentic Excalidraw sticky note pastel palette.
 * Background and stroke match for a clean, borderless sticky pad feel.
 */
export const STICKY_PALETTES: Record<StickyColor, StickyPalette> = {
  yellow: { bg: "#ffdf6b", stroke: "#ffdf6b" },
  pink: { bg: "#fcc2d7", stroke: "#fcc2d7" },
  green: { bg: "#b2f2bb", stroke: "#b2f2bb" },
  blue: { bg: "#a5d8ff", stroke: "#a5d8ff" },
  purple: { bg: "#eebefa", stroke: "#eebefa" },
};

export const DEFAULT_STICKY_NOTE_SIZE = 200;

function randomNonce(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export function createStickyNote(
  x: number,
  y: number,
  text = "",
  color: StickyColor = "yellow",
  width = DEFAULT_STICKY_NOTE_SIZE,
  height = DEFAULT_STICKY_NOTE_SIZE,
): [DrawElementDto, DrawElementDto] {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 100_000);
  const noteId = `sticky_${now}_${rand}`;
  const textId = `sticky_text_${now}_${rand}`;
  const palette = STICKY_PALETTES[color] ?? STICKY_PALETTES.yellow;

  const noteElement: DrawElementDto = {
    id: noteId,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: palette.stroke,
    backgroundColor: palette.bg,
    fillStyle: "solid",
    strokeWidth: 0,
    strokeStyle: "solid",
    roughness: 0,
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
    x: x + 16,
    y: y + 24,
    width: Math.max(width - 32, 40),
    height: Math.max(height - 48, 30),
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
    fontSize: 20,
    containerId: noteId,
    version: 1,
    versionNonce: randomNonce(),
    updated: now,
    isDeleted: false,
  };

  return [noteElement, textElement];
}
