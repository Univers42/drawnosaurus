import { describe, expect, it } from "vitest";
import { drawElementSchema } from "@drawnosaurus/contract";
import { createStickyNote, STICKY_PALETTES } from "./stickyNotes.ts";

describe("stickyNotes", () => {
  it("creates a valid container rectangle and bound text element", () => {
    const [note, text] = createStickyNote(150, 200, "Remember to buy milk", "yellow");

    expect(note.type).toBe("rectangle");
    expect(note.x).toBe(150);
    expect(note.y).toBe(200);
    expect(note.width).toBe(180);
    expect(note.height).toBe(180);
    expect(note.backgroundColor).toBe(STICKY_PALETTES.yellow.bg);
    expect(note.boundTextId).toBe(text.id);

    expect(text.type).toBe("text");
    expect(text.containerId).toBe(note.id);
    expect(text.text).toBe("Remember to buy milk");

    expect(drawElementSchema.safeParse(note).success).toBe(true);
    expect(drawElementSchema.safeParse(text).success).toBe(true);
  });

  it("supports all palette colors", () => {
    const colors = ["yellow", "green", "blue", "pink", "purple"] as const;
    for (const c of colors) {
      const [note] = createStickyNote(0, 0, "Test", c);
      expect(note.backgroundColor).toBe(STICKY_PALETTES[c].bg);
      expect(note.strokeColor).toBe(STICKY_PALETTES[c].stroke);
    }
  });
});
