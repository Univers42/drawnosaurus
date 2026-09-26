import { describe, expect, it } from "vitest";
import { sharedShape, switchKey, switchPanelAt } from "./shapeSwitch.ts";

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

describe("sharedShape", () => {
  it("is the type the switchable shapes share", () => {
    expect(sharedShape([{ type: "diamond" }, { type: "text" }, { type: "diamond" }])).toBe(
      "diamond",
    );
  });

  it("is none when they differ or there are none", () => {
    expect(sharedShape([{ type: "diamond" }, { type: "ellipse" }])).toBeNull();
    expect(sharedShape([{ type: "arrow" }])).toBeNull();
  });
});

describe("switchPanelAt", () => {
  it("hangs 8px left of the bottom-left corner and 18 zoomed pixels below it", () => {
    const at = switchPanelAt({ x: 10, y: 20, width: 100, height: 50 }, { x: 5, y: 7, scale: 2 });
    expect(at).toEqual({ x: 10 * 2 + 5 - 8, y: 70 * 2 + 7 + 36 });
  });
});
