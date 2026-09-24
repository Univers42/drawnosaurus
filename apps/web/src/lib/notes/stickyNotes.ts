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

export const DEFAULT_STICKY_NOTE_SIZE = 220;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function getStickyNoteDateLabel(timestamp = Date.now()): string {
  const d = new Date(timestamp);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

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
): [DrawElementDto, DrawElementDto, DrawElementDto, DrawElementDto] {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 100_000);
  const groupId = `sticky_grp_${now}_${rand}`;
  const noteId = `sticky_${now}_${rand}`;
  const textId = `sticky_text_${now}_${rand}`;
  const dateId = `sticky_date_${now}_${rand}`;
  const shadowId = `sticky_shadow_${now}_${rand}`;
  const palette = STICKY_PALETTES[color] ?? STICKY_PALETTES.yellow;

  // Locked, because an arrow end binds the shape whose outline is nearest, and beside the
  // note's right and bottom edges that is the shadow's, three units further out. A locked
  // shape is never an arrow's target, but still hides what is under it — Excalidraw's
  // rule (dc2c16d9) — and it goes wherever its group goes.
  // ponytail: a stop-gap until the note is one element with a painted shadow, as
  // Excalidraw's `stickynote`; a note made before this, or unlocked from the menu, still
  // offers its shadow.
  const shadowElement: DrawElementDto = {
    id: shadowId,
    type: "rectangle",
    x: x + 3,
    y: y + 3,
    width,
    height,
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "#000000",
    fillStyle: "solid",
    strokeWidth: 0,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 16,
    roundness: 12,
    locked: true,
    seed: Math.floor(Math.random() * 100_000),
    groupIds: [groupId],
    version: 1,
    versionNonce: randomNonce(),
    updated: now,
    isDeleted: false,
  };

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
    roundness: 12,
    seed: Math.floor(Math.random() * 100_000),
    boundTextId: textId,
    groupIds: [groupId],
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
    height: Math.max(height - 56, 30),
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
    groupIds: [groupId],
    version: 1,
    versionNonce: randomNonce(),
    updated: now,
    isDeleted: false,
  };

  const dateElement: DrawElementDto = {
    id: dateId,
    type: "text",
    x: x + width - 58,
    y: y + height - 26,
    width: 48,
    height: 18,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 45,
    roundness: null,
    seed: Math.floor(Math.random() * 100_000),
    text: getStickyNoteDateLabel(now),
    fontSize: 12,
    groupIds: [groupId],
    version: 1,
    versionNonce: randomNonce(),
    updated: now,
    isDeleted: false,
  };

  return [shadowElement, noteElement, dateElement, textElement];
}
