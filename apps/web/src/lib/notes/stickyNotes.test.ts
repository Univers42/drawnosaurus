import { describe, expect, it } from "vitest";
import { drawElementSchema } from "@drawnosaurus/contract";
import { createStickyNote, STICKY_PALETTES, DEFAULT_STICKY_NOTE_SIZE } from "./stickyNotes.ts";

describe("stickyNotes", () => {
  it("creates a valid container rectangle and bound text element with authentic sticky styling", () => {
    const [note, text] = createStickyNote(150, 200, "Remember to buy milk", "yellow");

    expect(note.type).toBe("rectangle");
    expect(note.x).toBe(150);
    expect(note.y).toBe(200);
    expect(note.width).toBe(DEFAULT_STICKY_NOTE_SIZE);
    expect(note.height).toBe(DEFAULT_STICKY_NOTE_SIZE);
    expect(note.roughness).toBe(0);
    expect(note.roundness).toBe(8);
    expect(note.strokeWidth).toBe(0);
    expect(note.fillStyle).toBe("solid");
    expect(note.backgroundColor).toBe(STICKY_PALETTES.yellow.bg);
    expect(note.strokeColor).toBe(STICKY_PALETTES.yellow.stroke);
    expect(note.boundTextId).toBe(text.id);

    expect(text.type).toBe("text");
    expect(text.containerId).toBe(note.id);
    expect(text.text).toBe("Remember to buy milk");
    expect(text.fontSize).toBe(20);

    expect(drawElementSchema.safeParse(note).success).toBe(true);
    expect(drawElementSchema.safeParse(text).success).toBe(true);
  });

  it("supports all palette colors with matched stroke and background", () => {
    const colors = ["yellow", "green", "blue", "pink", "purple"] as const;
    for (const c of colors) {
      const [note] = createStickyNote(0, 0, "Test", c);
      expect(note.backgroundColor).toBe(STICKY_PALETTES[c].bg);
      expect(note.strokeColor).toBe(STICKY_PALETTES[c].stroke);
    }
  });

  it("supports custom dimensions", () => {
    const [note, text] = createStickyNote(10, 20, "Custom size", "pink", 300, 250);
    expect(note.width).toBe(300);
    expect(note.height).toBe(250);
    expect(text.width).toBe(300 - 32);
    expect(text.height).toBe(250 - 48);
  });
});
