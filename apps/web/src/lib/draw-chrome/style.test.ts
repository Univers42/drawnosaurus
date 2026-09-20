import { describe, expect, it } from "vitest";
import type { DrawElement } from "@osionos/draw-engine/types";
import { cursorForTool, styleOf, toHex } from "./style.ts";

describe("toHex", () => {
  it("keeps a six-digit hex colour", () => {
    expect(toHex("#1971c2")).toBe("#1971c2");
  });

  it("falls back when the value is not a six-digit hex", () => {
    expect(toHex("transparent")).toBe("#1e1e1e");
    expect(toHex("#fff")).toBe("#1e1e1e");
    expect(toHex("")).toBe("#1e1e1e");
  });
});

describe("cursorForTool", () => {
  it("uses a text caret for the text tool", () => {
    expect(cursorForTool("text")).toBe("text");
  });

  it("uses a crosshair for shape and ink tools", () => {
    expect(cursorForTool("rectangle")).toBe("crosshair");
    expect(cursorForTool("freedraw")).toBe("crosshair");
    expect(cursorForTool("eraser")).toBe("crosshair");
  });

  it("uses the default cursor for select and pan", () => {
    expect(cursorForTool("select")).toBe("default");
    expect(cursorForTool("hand")).toBe("default");
  });
});

describe("styleOf", () => {
  it("copies only the style fields off an element", () => {
    const element = {
      id: "a",
      type: "rectangle",
      x: 1,
      y: 2,
      width: 10,
      height: 20,
      angle: 0,
      seed: 1,
      strokeColor: "#e03131",
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
      strokeWidth: 4,
      strokeStyle: "dashed",
      roughness: 2,
      opacity: 80,
      roundness: 12,
      version: 3,
      versionNonce: 9,
      updated: 0,
      isDeleted: false,
    } satisfies DrawElement;

    expect(styleOf(element)).toEqual({
      strokeColor: "#e03131",
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
      strokeWidth: 4,
      strokeStyle: "dashed",
      roughness: 2,
      opacity: 80,
      roundness: 12,
    });
  });
});
