import { describe, expect, it } from "vitest";
import type { DrawElement } from "@osionos/draw-engine/types";
import { clampMenuPosition, menuElementFromSelection } from "./menu.ts";

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

  it("marks a multi-selection and a group", () => {
    const info = menuElementFromSelection(
      [el({ id: "a", type: "rectangle" }), el({ id: "b", type: "ellipse" })],
      false,
      true,
    );
    expect(info).toMatchObject({ linear: null, multi: true, grouped: true });
  });
});
