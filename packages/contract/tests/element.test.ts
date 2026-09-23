import { describe, expect, it } from "vitest";
import { osidrawFileSchema, patchElementsSchema } from "../src/board.ts";
import { drawElementSchema } from "../src/element.ts";
import { MAX_IMAGE_DATA_URL_LENGTH, MAX_POINTS_PER_ELEMENT } from "../src/limits.ts";
import { element } from "./factory.ts";

describe("drawElementSchema", () => {
  it("accepts a well-formed element", () => {
    expect(drawElementSchema.safeParse(element()).success).toBe(true);
  });

  it("rejects NaN and Infinity coordinates", () => {
    // A non-finite coordinate reaching the renderer blanks the canvas, so this is
    // the single most important thing the boundary catches.
    expect(drawElementSchema.safeParse(element({ x: Number.NaN })).success).toBe(false);
    expect(drawElementSchema.safeParse(element({ y: Number.POSITIVE_INFINITY })).success).toBe(
      false,
    );
    expect(drawElementSchema.safeParse(element({ width: Number.NEGATIVE_INFINITY })).success).toBe(
      false,
    );
  });

  it("rejects an out-of-range opacity", () => {
    expect(drawElementSchema.safeParse(element({ opacity: 101 })).success).toBe(false);
    expect(drawElementSchema.safeParse(element({ opacity: -1 })).success).toBe(false);
  });

  it("rejects an unknown element type", () => {
    expect(drawElementSchema.safeParse({ ...element(), type: "hologram" }).success).toBe(false);
  });

  it("strips unknown keys instead of failing, so a newer engine still writes", () => {
    const parsed = drawElementSchema.parse({ ...element(), somethingNew: "from a later engine" });
    expect(parsed).not.toHaveProperty("somethingNew");
    expect(parsed.id).toBe("el-1");
  });

  it("requires a version of at least 1", () => {
    expect(drawElementSchema.safeParse(element({ version: 0 })).success).toBe(false);
  });

  it("caps freehand point arrays", () => {
    const tooMany = Array.from(
      { length: MAX_POINTS_PER_ELEMENT + 1 },
      () => [0, 0] as [number, number],
    );
    expect(
      drawElementSchema.safeParse(element({ type: "freedraw", points: tooMany })).success,
    ).toBe(false);
  });
});

describe("an image's picture", () => {
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("survives validation, so an image does not come back empty after a reload", () => {
    const parsed = drawElementSchema.parse(element({ type: "image", dataUrl: PNG }));
    expect(parsed.dataUrl).toBe(PNG);
  });

  it("is optional: an image still loading, or any other element, carries none", () => {
    expect(drawElementSchema.safeParse(element({ type: "image" })).success).toBe(true);
  });

  it("refuses anything that is not a base64 picture", () => {
    for (const dataUrl of [
      "javascript:alert(1)",
      "https://example.com/cat.png",
      "data:text/html;base64,PGgxPmhpPC9oMT4=",
      "data:image/png,<svg onload=alert(1)>",
      "data:image/png;base64,not base64!",
    ]) {
      expect(
        drawElementSchema.safeParse(element({ type: "image", dataUrl })).success,
        dataUrl,
      ).toBe(false);
    }
  });

  it("is bounded, so one element cannot fill a board's document", () => {
    const header = "data:image/png;base64,";
    const atLimit = header + "A".repeat(MAX_IMAGE_DATA_URL_LENGTH - header.length);
    expect(drawElementSchema.safeParse(element({ type: "image", dataUrl: atLimit })).success).toBe(
      true,
    );
    expect(
      drawElementSchema.safeParse(element({ type: "image", dataUrl: atLimit + "A" })).success,
    ).toBe(false);
  });
});

describe("osidrawFileSchema", () => {
  it("accepts the envelope the engine emits", () => {
    const parsed = osidrawFileSchema.safeParse({
      type: "osidraw",
      version: 1,
      elements: [element()],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a future envelope version rather than guessing", () => {
    expect(osidrawFileSchema.safeParse({ type: "osidraw", version: 2, elements: [] }).success).toBe(
      false,
    );
  });

  it("rejects a foreign document type", () => {
    expect(
      osidrawFileSchema.safeParse({ type: "excalidraw", version: 1, elements: [] }).success,
    ).toBe(false);
  });
});

describe("patchElementsSchema", () => {
  it("accepts elements without an order", () => {
    expect(patchElementsSchema.safeParse({ elements: [element()] }).success).toBe(true);
  });

  it("accepts an explicit z-order", () => {
    const parsed = patchElementsSchema.safeParse({ elements: [element()], order: ["el-1"] });
    expect(parsed.success).toBe(true);
  });
});
