import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DrawElement } from "@osionos/draw-engine/types";
import {
  ARROWHEAD_GLYPH,
  ARROWHEAD_KINDS,
  ARROWHEAD_LABEL,
  VECTORIZE_LABEL,
  clampMenuPosition,
  menuElementFromSelection,
  textMenu,
  vectorizeAction,
} from "./menu.ts";

const el = (patch: Partial<DrawElement> & Pick<DrawElement, "type" | "id">): DrawElement => ({
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  angle: 0,
  seed: 1,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "hachure",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundness: 8,
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
  ...patch,
});

describe("ARROWHEAD_KINDS", () => {
  it("offers the oracle's own picker order (actionProperties.tsx's getArrowheadOptions)", () => {
    expect(ARROWHEAD_KINDS).toEqual([
      "none",
      "arrow",
      "triangle",
      "triangle_outline",
      "circle",
      "circle_outline",
      "diamond",
      "diamond_outline",
      "bar",
      "cardinality_one",
      "cardinality_many",
      "cardinality_one_or_many",
      "cardinality_exactly_one",
      "cardinality_zero_or_one",
      "cardinality_zero_or_many",
    ]);
  });

  it("has a distinct glyph and a label for every kind, so none renders blank", () => {
    const glyphs = ARROWHEAD_KINDS.map((kind) => ARROWHEAD_GLYPH[kind]);
    expect(new Set(glyphs).size).toBe(ARROWHEAD_KINDS.length);
    for (const kind of ARROWHEAD_KINDS) {
      expect(ARROWHEAD_GLYPH[kind], kind).toBeTruthy();
      expect(ARROWHEAD_LABEL[kind], kind).toBeTruthy();
    }
  });
});

describe("clampMenuPosition", () => {
  const menu = { width: 224, height: 200 };
  const host = { width: 800, height: 600 };

  it("keeps a click that already fits", () => {
    expect(clampMenuPosition(40, 50, menu, host)).toEqual({ left: 40, top: 50 });
  });

  it("clamps against the right and bottom edges", () => {
    expect(clampMenuPosition(790, 590, menu, host)).toEqual({ left: 572, top: 396 });
  });

  it("never goes past the padding on the origin", () => {
    expect(clampMenuPosition(-20, -10, menu, host, 4)).toEqual({ left: 4, top: 4 });
  });
});

describe("menuElementFromSelection", () => {
  it("offers to change the link of one embed, and only one that is unlocked", () => {
    const embed = el({ id: "e", type: "embed" });
    expect(menuElementFromSelection([embed], false, false)?.embedId).toBe("e");
    expect(menuElementFromSelection([embed], true, false)?.embedId).toBeNull();
    expect(
      menuElementFromSelection([embed, el({ id: "r", type: "rectangle" })], false, false)?.embedId,
    ).toBeNull();
    expect(
      menuElementFromSelection([el({ id: "r", type: "rectangle" })], false, false)?.embedId,
    ).toBeNull();
  });

  it("offers to vectorize one image, and only one that is unlocked", () => {
    const image = el({ id: "i", type: "image" });
    expect(menuElementFromSelection([image], false, false)?.vectorizeId).toBe("i");
    expect(menuElementFromSelection([image], true, false)?.vectorizeId).toBeNull();
    expect(
      menuElementFromSelection([image, el({ id: "r", type: "rectangle" })], false, false)
        ?.vectorizeId,
    ).toBeNull();
    expect(
      menuElementFromSelection([el({ id: "e", type: "embed" })], false, false)?.vectorizeId,
    ).toBeNull();
  });

  it("returns null on empty canvas", () => {
    expect(menuElementFromSelection([], false, false)).toBeNull();
  });

  it("defaults an arrow's missing end to an arrowhead", () => {
    const info = menuElementFromSelection([el({ id: "a", type: "arrow" })], false, false);
    expect(info?.linear).toEqual({ start: "none", end: "arrow" });
    expect(info?.multi).toBe(false);
  });

  it("defaults a line's missing ends to none", () => {
    const info = menuElementFromSelection([el({ id: "a", type: "line" })], true, false);
    expect(info?.linear).toEqual({ start: "none", end: "none" });
    expect(info?.locked).toBe(true);
  });

  it("offers no heads for a locked line or arrow, which a style passes by", () => {
    const locked = el({ id: "a", type: "arrow", locked: true });
    expect(menuElementFromSelection([locked], true, false)?.linear).toBeNull();
    // Beside one that is not locked, the row is that one's.
    const free = el({ id: "b", type: "arrow", startArrowhead: "circle" });
    expect(menuElementFromSelection([locked, free], false, false)?.linear).toEqual({
      start: "circle",
      end: "arrow",
    });
  });

  it("marks a multi-selection and a group", () => {
    const info = menuElementFromSelection(
      [el({ id: "a", type: "rectangle" }), el({ id: "b", type: "ellipse" })],
      false,
      true,
    );
    expect(info).toMatchObject({ linear: null, multi: true, grouped: true });
  });
});

describe("vectorizeAction", () => {
  const image = (id: string) => el({ id, type: "image" });

  it("is the one declaration the canvas menu and the palette both read", () => {
    // Two menus offer it, so it is written once. A second literal is how a palette entry
    // silently stops matching the menu item — which is the bug this scan exists to fail on.
    const sources = ["./commandPalette.ts", "./DrawContextMenu.svelte"];
    for (const source of sources) {
      const text = readFileSync(new URL(source, import.meta.url), "utf8");
      expect(text.includes(`"${VECTORIZE_LABEL}"`), source).toBe(false);
    }
    const declared = readFileSync(new URL("./menu.ts", import.meta.url), "utf8");
    expect(declared.includes(`"${VECTORIZE_LABEL}"`)).toBe(true);
  });

  it("names the one unlocked image, and nothing else", () => {
    expect(vectorizeAction(menuElementFromSelection([image("i")], false, false))).toEqual({
      label: VECTORIZE_LABEL,
      elementId: "i",
    });
    // A locked image, two of anything, an embed, an empty canvas.
    expect(vectorizeAction(menuElementFromSelection([image("i")], true, false))).toBeNull();
    expect(
      vectorizeAction(
        menuElementFromSelection([image("i"), el({ id: "r", type: "rectangle" })], false, false),
      ),
    ).toBeNull();
    expect(
      vectorizeAction(menuElementFromSelection([el({ id: "e", type: "embed" })], false, false)),
    ).toBeNull();
    expect(vectorizeAction(null)).toBeNull();
  });
});

describe("textMenu", () => {
  const facts = {
    count: 1,
    hasFreeText: false,
    autoResize: null,
    canBindText: false,
    canUnbindText: false,
  };

  it("offers auto-resizing for one text of a fixed width, and only then", () => {
    // `actionTextAutoResize`'s predicate (`actions/actionTextAutoResize.ts@1118751f:27-34`).
    expect(textMenu({ ...facts, hasFreeText: true, autoResize: false }).autoResize).toBe(true);
    expect(textMenu({ ...facts, hasFreeText: true, autoResize: true }).autoResize).toBe(false);
    expect(textMenu({ ...facts, count: 2, hasFreeText: true, autoResize: false }).autoResize).toBe(
      false,
    );
  });

  it("offers each bound-text action on the engine's answer", () => {
    expect(textMenu({ ...facts, canBindText: true })).toEqual({
      autoResize: false,
      unbind: false,
      bind: true,
      wrap: false,
    });
    expect(textMenu({ ...facts, canUnbindText: true }).unbind).toBe(true);
    expect(textMenu({ ...facts, count: 3, hasFreeText: true }).wrap).toBe(true);
  });

  it("is carried by the element menu, and offers nothing without the engine's answer", () => {
    const text = el({ id: "t", type: "text" });
    expect(
      menuElementFromSelection([text], false, false, { ...facts, hasFreeText: true })?.text.wrap,
    ).toBe(true);
    expect(menuElementFromSelection([text], false, false)?.text.wrap).toBe(false);
  });
});
