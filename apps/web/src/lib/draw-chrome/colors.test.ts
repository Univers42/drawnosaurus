import { describe, expect, it } from "vitest";
import {
  COLOR_HOTKEYS,
  COLOR_PALETTE,
  ELEMENT_PALETTE,
  INVALID_COLOR,
  INVALID_HEX_LENGTH,
  arrowIndex,
  colorNameAndShade,
  initialSection,
  isTransparent,
  mostUsedCustomColors,
  normalizeInputColor,
  paletteColor,
  pickerKeyAction,
  readColorInput,
  type PickerKey,
  type PickerKeyState,
} from "./colors.ts";

const key = (partial: Partial<PickerKey> & Pick<PickerKey, "key">): PickerKey => ({
  code: "",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...partial,
});

const state = (partial: Partial<PickerKeyState> = {}): PickerKeyState => ({
  section: "baseColors",
  color: COLOR_PALETTE.black,
  customColors: [],
  activeShade: 4,
  ...partial,
});

describe("the palette", () => {
  it("is Excalidraw's fifteen colours in its grid order", () => {
    // `DEFAULT_ELEMENT_STROKE_COLOR_PALETTE`: the neutrals first, then the hues, row by
    // row — the order is also the hotkeys, so it is not cosmetic.
    expect(ELEMENT_PALETTE.map(([name]) => name)).toEqual([
      "transparent",
      "white",
      "gray",
      "black",
      "bronze",
      "cyan",
      "blue",
      "violet",
      "grape",
      "pink",
      "green",
      "teal",
      "yellow",
      "orange",
      "red",
    ]);
    expect(COLOR_HOTKEYS).toHaveLength(ELEMENT_PALETTE.length);
  });

  it("shows each hue at the active shade", () => {
    expect(paletteColor(COLOR_PALETTE.red, 4)).toBe("#e03131");
    expect(paletteColor(COLOR_PALETTE.red, 1)).toBe("#ffc9c9");
    expect(paletteColor(COLOR_PALETTE.black, 1)).toBe("#1e1e1e");
  });

  it("finds a colour's name and shade, and nothing for a custom one", () => {
    expect(colorNameAndShade("#ffc9c9")).toEqual({ name: "red", index: 14, shade: 1 });
    expect(colorNameAndShade("#1e1e1e")).toEqual({ name: "black", index: 3, shade: null });
    expect(colorNameAndShade("#123456")).toBeNull();
    expect(colorNameAndShade(null)).toBeNull();
  });

  it("treats a zero-alpha hex as transparent", () => {
    expect(isTransparent("transparent")).toBe(true);
    expect(isTransparent("#ffffff00")).toBe(true);
    expect(isTransparent("#fff0")).toBe(true);
    expect(isTransparent("#ffffff")).toBe(false);
  });
});

describe("most used custom colours", () => {
  it("are the board's off-palette colours, most used first, at most five", () => {
    const counts: [string, number][] = [
      ["#1e1e1e", 40],
      ["#aaaaaa", 2],
      ["#bbbbbb", 7],
      ["transparent", 9],
      ["#cccccc00", 9],
      ["#111111", 1],
      ["#222222", 1],
      ["#333333", 1],
      ["#444444", 1],
    ];
    expect(mostUsedCustomColors(counts)).toEqual([
      "#bbbbbb",
      "#aaaaaa",
      "#111111",
      "#222222",
      "#333333",
    ]);
  });
});

describe("the hex field", () => {
  const noCss = () => false;

  it("adds the # a hex was typed without", () => {
    expect(normalizeInputColor("ff0000", noCss)).toBe("#ff0000");
    expect(normalizeInputColor("#abc", noCss)).toBe("#abc");
    expect(normalizeInputColor(" #ABCDEF80 ", noCss)).toBe("#ABCDEF80");
    expect(normalizeInputColor("ff00", noCss)).toBe("#ff00");
  });

  it("keeps a CSS colour the browser accepts, as typed", () => {
    expect(normalizeInputColor("rebeccapurple", (c) => c === "rebeccapurple")).toBe(
      "rebeccapurple",
    );
    expect(normalizeInputColor("transparent", noCss)).toBe("transparent");
  });

  it("refuses the rest", () => {
    expect(normalizeInputColor("ff000", noCss)).toBeNull();
    expect(normalizeInputColor("zz", noCss)).toBeNull();
    expect(normalizeInputColor("", noCss)).toBeNull();
  });

  it("says which way a colour is wrong", () => {
    // `ColorInput.tsx@1118751f:40-58`: digits that are only the wrong length get the length
    // message, anything else the general one, and an empty field no message at all.
    expect(readColorInput("ff000", noCss)).toEqual({ color: null, error: INVALID_HEX_LENGTH });
    expect(readColorInput("zz", noCss)).toEqual({ color: null, error: INVALID_COLOR });
    expect(readColorInput("", noCss)).toEqual({ color: null, error: null });
    expect(readColorInput("FF0000", noCss)).toEqual({ color: "#ff0000", error: null });
  });
});

describe("the picker's keyboard", () => {
  it("closes on Escape and toggles the eyedropper on I", () => {
    expect(pickerKeyAction(key({ key: "Escape" }), state())).toEqual({ kind: "close" });
    expect(pickerKeyAction(key({ key: "i" }), state())).toEqual({ kind: "eyedropper" });
  });

  it("leaves chords alone", () => {
    expect(pickerKeyAction(key({ key: "c", ctrlKey: true }), state())).toBeNull();
  });

  it("picks a grid colour by its letter, at the active shade", () => {
    expect(pickerKeyAction(key({ key: "q" }), state())).toEqual({
      kind: "pick",
      color: "transparent",
      section: "baseColors",
    });
    expect(pickerKeyAction(key({ key: "b" }), state({ activeShade: 1 }))).toEqual({
      kind: "pick",
      color: "#ffc9c9",
      section: "baseColors",
    });
    expect(pickerKeyAction(key({ key: "w" }), state())).toMatchObject({ color: "#ffffff" });
  });

  it("picks a shade of the current colour with Shift and a digit", () => {
    // On `code`: Shift+1 types "!" on most layouts.
    expect(
      pickerKeyAction(
        key({ key: "!", code: "Digit1", shiftKey: true }),
        state({ color: "#e03131" }),
      ),
    ).toEqual({ kind: "pick", color: "#fff5f5", section: "shades" });
    // Black has no shades, so the digit falls through to the custom colours.
    expect(pickerKeyAction(key({ key: "!", code: "Digit1", shiftKey: true }), state())).toBeNull();
  });

  it("picks a most-used custom colour by its number", () => {
    const customColors = ["#123456", "#654321"];
    expect(pickerKeyAction(key({ key: "2" }), state({ customColors }))).toEqual({
      kind: "pick",
      color: "#654321",
      section: "custom",
    });
    expect(pickerKeyAction(key({ key: "3" }), state({ customColors }))).toBeNull();
  });

  it("moves between the sections that exist on Tab", () => {
    const red = state({ color: "#e03131", section: "baseColors" });
    expect(pickerKeyAction(key({ key: "Tab" }), red)).toEqual({
      kind: "section",
      section: "shades",
      color: null,
    });
    const black = state({ color: "#1e1e1e", section: "baseColors" });
    expect(pickerKeyAction(key({ key: "Tab" }), black)).toEqual({
      kind: "section",
      section: "hex",
      color: null,
    });
    expect(pickerKeyAction(key({ key: "Tab", shiftKey: true }), state({ section: "hex" }))).toEqual(
      {
        kind: "section",
        section: "baseColors",
        color: null,
      },
    );
    // A custom colour is not on the grid, so arriving there picks black.
    const custom = state({ color: "#123456", section: "hex" });
    expect(pickerKeyAction(key({ key: "Tab" }), custom)).toEqual({
      kind: "section",
      section: "baseColors",
      color: "#1e1e1e",
    });
  });

  it("walks the grid with the arrows", () => {
    // From black (index 3): right is bronze, down is grape (index 8).
    expect(pickerKeyAction(key({ key: "ArrowRight" }), state())).toMatchObject({
      color: "#846358",
    });
    expect(pickerKeyAction(key({ key: "ArrowDown" }), state())).toMatchObject({ color: "#9c36b5" });
    expect(
      pickerKeyAction(key({ key: "ArrowLeft" }), state({ section: "shades", color: "#ff8787" })),
    ).toMatchObject({ color: "#ffc9c9" });
  });

  it("wraps around the grid as Excalidraw's does", () => {
    expect(arrowIndex("ArrowLeft", 0, 15)).toBe(14);
    expect(arrowIndex("ArrowRight", 14, 15)).toBe(0);
    expect(arrowIndex("ArrowDown", 12, 15)).toBe(2);
    expect(arrowIndex("ArrowUp", 1, 15)).toBe(11);
    expect(arrowIndex("Enter", 1, 15)).toBeUndefined();
  });
});

describe("where a picker opens", () => {
  it("on the shades for a palette colour with shades, the grid for one without", () => {
    expect(initialSection("#e03131", [])).toBe("shades");
    expect(initialSection("#1e1e1e", [])).toBe("baseColors");
    expect(initialSection("#123456", ["#123456"])).toBe("custom");
    expect(initialSection("#123456", [])).toBeNull();
  });
});
