import { describe, expect, it } from "vitest";
import { drawElementSchema } from "@drawnosaurus/contract";
import {
  createStickyNote,
  STICKY_PALETTES,
  DEFAULT_STICKY_NOTE_SIZE,
  getStickyNoteDateLabel,
} from "./stickyNotes.ts";

describe("stickyNotes", () => {
  it("creates a valid container rectangle, text, date footer, and shadow with authentic sticky styling", () => {
    const [shadow, note, date, text] = createStickyNote(150, 200, "Remember to buy milk", "yellow");

    expect(note.type).toBe("rectangle");
    expect(note.x).toBe(150);
    expect(note.y).toBe(200);
    expect(note.width).toBe(DEFAULT_STICKY_NOTE_SIZE);
    expect(note.height).toBe(DEFAULT_STICKY_NOTE_SIZE);
    expect(note.roughness).toBe(0);
    expect(note.roundness).toBe(12);
    expect(note.strokeWidth).toBe(0);
    expect(note.fillStyle).toBe("solid");
    expect(note.backgroundColor).toBe(STICKY_PALETTES.yellow.bg);
    expect(note.strokeColor).toBe(STICKY_PALETTES.yellow.stroke);
    expect(note.boundTextId).toBe(text.id);
    expect(note.groupIds).toHaveLength(1);

    expect(text.type).toBe("text");
    expect(text.containerId).toBe(note.id);
    expect(text.groupIds).toEqual(note.groupIds);
    expect(text.text).toBe("Remember to buy milk");
    expect(text.fontSize).toBe(20);

    expect(date.type).toBe("text");
    expect(date.groupIds).toEqual(note.groupIds);
    expect(date.fontSize).toBe(12);
    expect(date.opacity).toBe(45);
    expect(date.text).toBe(getStickyNoteDateLabel());

    expect(shadow.type).toBe("rectangle");
    expect(shadow.x).toBe(153);
    expect(shadow.y).toBe(203);
    expect(shadow.opacity).toBe(16);
    expect(shadow.roundness).toBe(12);
    expect(shadow.groupIds).toEqual(note.groupIds);

    expect(drawElementSchema.safeParse(note).success).toBe(true);
    expect(drawElementSchema.safeParse(text).success).toBe(true);
    expect(drawElementSchema.safeParse(date).success).toBe(true);
    expect(drawElementSchema.safeParse(shadow).success).toBe(true);
  });

  it("supports all palette colors with matched stroke and background", () => {
    const colors = ["yellow", "green", "blue", "pink", "purple"] as const;
    for (const c of colors) {
      const [, note] = createStickyNote(0, 0, "Test", c);
      expect(note.backgroundColor).toBe(STICKY_PALETTES[c].bg);
      expect(note.strokeColor).toBe(STICKY_PALETTES[c].stroke);
    }
  });

  it("supports custom dimensions", () => {
    const [, note, , text] = createStickyNote(10, 20, "Custom size", "pink", 300, 250);
    expect(note.width).toBe(300);
    expect(note.height).toBe(250);
    expect(text.width).toBe(300 - 32);
    expect(text.height).toBe(250 - 56);
  });
});
