import { describe, expect, it } from "vitest";
import {
  CLOSED_SHAPES,
  LINEAR_TYPES,
  switchKey,
  switchPanelAt,
  switchTypes,
  typeIcon,
  typeLabel,
} from "./shapeSwitch.ts";

const key = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});
const closed = { open: false, switchable: true, onBoard: true };
const open = { ...closed, open: true };

describe("switchKey", () => {
  it("opens on the first Tab or Shift+Tab, switches on the ones after", () => {
    expect(switchKey(key("Tab"), closed)).toBe("open");
    expect(switchKey(key("Tab", { shiftKey: true }), closed)).toBe("open");
    expect(switchKey(key("Tab"), open)).toBe("forward");
    expect(switchKey(key("Tab", { shiftKey: true }), open)).toBe("back");
  });

  it("closes on Escape, and only when open", () => {
    expect(switchKey(key("Escape"), open)).toBe("close");
    expect(switchKey(key("Escape"), closed)).toBeNull();
  });

  it("leaves Tab alone with nothing to switch, off the board, or with a modifier", () => {
    expect(switchKey(key("Tab"), { ...closed, switchable: false })).toBeNull();
    expect(switchKey(key("Tab"), { ...open, onBoard: false })).toBeNull();
    expect(switchKey(key("Tab", { ctrlKey: true }), open)).toBeNull();
    expect(switchKey(key("Tab", { altKey: true }), open)).toBeNull();
    expect(switchKey(key("a"), open)).toBeNull();
  });
});

describe("switchTypes", () => {
  it("offers the three closed shapes for a closed shape", () => {
    expect(switchTypes("rectangle")).toEqual(CLOSED_SHAPES);
    expect(switchTypes("diamond")).toEqual(CLOSED_SHAPES);
    expect(switchTypes("ellipse")).toEqual(CLOSED_SHAPES);
  });

  it("offers the four linear types for any of them, in the order Tab walks them", () => {
    // `LINEAR_TYPES`, `ConvertElementTypePopup.tsx@1118751f:113-120`.
    expect(LINEAR_TYPES).toEqual(["line", "sharpArrow", "curvedArrow", "elbowArrow"]);
    for (const linear of LINEAR_TYPES) {
      expect(switchTypes(linear)).toEqual(LINEAR_TYPES);
    }
  });

  it("offers nothing for nothing switchable, and the panel closes on it", () => {
    // A selection of two kinds has no shared type, and the oracle's panel closes rather
    // than offering a choice between two families (`ConvertElementTypePopup.tsx@1118751f:641-664`).
    expect(switchTypes(null)).toEqual([]);
  });
});

describe("typeLabel and typeIcon", () => {
  it("names each of the seven and draws each of the seven", () => {
    for (const type of [...CLOSED_SHAPES, ...LINEAR_TYPES]) {
      expect(typeLabel(type)).not.toBe("");
      expect(typeIcon(type)).not.toBe("");
    }
  });

  it("reads the linear types the way the oracle's panel does, and spells the icons its way", () => {
    // The conversion names and the icon names were chosen on different sides of the wire.
    expect(typeLabel("line")).toBe("Line");
    expect(typeLabel("sharpArrow")).toBe("Sharp arrow");
    expect(typeLabel("curvedArrow")).toBe("Curved arrow");
    expect(typeLabel("elbowArrow")).toBe("Elbow arrow");
    expect(typeIcon("line")).toBe("line");
    expect(typeIcon("sharpArrow")).toBe("arrowSharp");
    expect(typeIcon("curvedArrow")).toBe("arrowRound");
    expect(typeIcon("elbowArrow")).toBe("arrowElbow");
  });
});

describe("switchPanelAt", () => {
  it("hangs 8px left of the bottom-left corner and 18 zoomed pixels below it", () => {
    const at = switchPanelAt({ x: 10, y: 20, width: 100, height: 50 }, { x: 5, y: 7, scale: 2 });
    expect(at).toEqual({ x: 10 * 2 + 5 - 8, y: 70 * 2 + 7 + 36 });
  });
});
