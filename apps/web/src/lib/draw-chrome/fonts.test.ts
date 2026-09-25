import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FONT_CHOICES,
  QUICK_FONTS,
  type FontEvents,
  type LoadedFace,
  TEXT_FAMILIES,
  fontGroups,
  fontLabel,
  fontPickerKey,
  loadFontFamily,
  readFontSize,
  watchFonts,
} from "./fonts.ts";

function fakeFonts(): FontEvents & { done(...faces: LoadedFace[]): void } {
  const target = new EventTarget();
  return {
    addEventListener: (type, listener) =>
      target.addEventListener(type, listener as unknown as EventListener),
    removeEventListener: (type, listener) =>
      target.removeEventListener(type, listener as unknown as EventListener),
    done: (...fontfaces) =>
      target.dispatchEvent(Object.assign(new Event("loadingdone"), { fontfaces })),
  };
}

/** A face as Chromium reports it: the family quoted, as `fonts.css` declares it. */
function face(family: string, unicodeRange = "U+0-10FFFF", weight = "normal"): LoadedFace {
  return { family: `"${family}"`, style: "normal", weight, unicodeRange };
}

describe("watchFonts", () => {
  it("reports each face of a text family the first time it loads", () => {
    const fonts = fakeFonts();
    let calls = 0;
    watchFonts(fonts, () => calls++);
    fonts.done(face("Excalifont", "U+20-7E"));
    fonts.done(face("Excalifont", "U+100-130"));
    expect(calls).toBe(2);
  });

  it("stays silent for a face it has already reported", () => {
    // Excalidraw bails the same way (`Fonts.onLoaded`, `fonts/Fonts.ts@1118751f:106-127`).
    const fonts = fakeFonts();
    let calls = 0;
    watchFonts(fonts, () => calls++);
    fonts.done(face("Cascadia"));
    fonts.done(face("Cascadia"));
    expect(calls).toBe(1);
  });

  it("stays silent for faces no text is drawn in, like the UI's own", () => {
    // Inter loads in shards as the UI needs them; each one re-laid every text on the board.
    const fonts = fakeFonts();
    let calls = 0;
    watchFonts(fonts, () => calls++);
    fonts.done(face("Inter", "U+0000-00FF", "400"), face("Inter", "U+0100-02AF", "600"));
    fonts.done();
    expect(calls).toBe(0);
  });

  it("says nothing on its own when it starts: no face has loaded yet", async () => {
    // It reported `document.fonts.ready` at once, which resolves before any face is asked
    // for — and the engine re-laid every text in the fallback's widths.
    const fonts = fakeFonts();
    let calls = 0;
    watchFonts(fonts, () => calls++);
    await Promise.resolve();
    expect(calls).toBe(0);
  });

  it("stays silent once stopped", () => {
    // The engine behind `loaded` may be gone by then.
    const fonts = fakeFonts();
    let calls = 0;
    const stop = watchFonts(fonts, () => calls++);
    stop();
    fonts.done(face("Virgil"));
    expect(calls).toBe(0);
  });
});

describe("TEXT_FAMILIES", () => {
  it("names exactly the families fonts.css serves", () => {
    const css = readFileSync(new URL("./fonts.css", import.meta.url), "utf8");
    const declared = new Set([...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]));
    expect([...declared].sort()).toEqual([...TEXT_FAMILIES].sort());
  });
});

describe("the font picker's list", () => {
  const ids = (fonts: readonly { id: number }[]) => fonts.map((font) => font.id);

  it("offers the families excalidraw lists, in label order", () => {
    // `FontPickerList.tsx@1118751f:126-155`: private (Liberation Sans) and fallback faces
    // are never listed.
    expect(FONT_CHOICES.map((font) => font.label)).toEqual([
      "Cascadia",
      "Comic Shanns",
      "Excalifont",
      "Helvetica",
      "Lilita One",
      "Nunito",
      "Virgil",
    ]);
  });

  it("puts the board's families first, and leaves the old ones out unless the board uses them", () => {
    const { inScene, available } = fontGroups([1, 6], "");
    expect(ids(inScene)).toEqual([6, 1]);
    // Cascadia, Helvetica and Virgil are deprecated (`font-metadata.ts@1118751f:68-95`).
    expect(ids(available)).toEqual([8, 5, 7]);
  });

  it("narrows both groups to the labels holding the search, whatever its case", () => {
    const { inScene, available } = fontGroups([3], "  CA ");
    expect(ids(inScene)).toEqual([3]);
    expect(ids(available)).toEqual([5]);
    expect(fontGroups([], "nothing like it")).toEqual({ inScene: [], available: [] });
  });

  it("names the quick picks as excalidraw does", () => {
    // `DEFAULT_FONTS`, `FontPicker.tsx@1118751f:42-61`.
    expect(QUICK_FONTS.map((font) => [font.id, font.label])).toEqual([
      [5, "Hand-drawn"],
      [6, "Normal"],
      [8, "Code"],
    ]);
  });

  it("labels a family, the system stack and a mixed selection", () => {
    expect(fontLabel(7)).toBe("Lilita One");
    expect(fontLabel(0)).toBe("System");
    expect(fontLabel(null)).toBe("mixed");
  });
});

describe("fontPickerKey", () => {
  const key = (k: string, shiftKey = false) => ({
    key: k,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
  });
  const listed = [6, 8, 5];

  it("walks the list round from either end", () => {
    // `arrayToList` links head and tail (`packages/common/src/utils.ts@1118751f:599-620`).
    expect(fontPickerKey(key("ArrowDown"), 6, listed)).toEqual({ kind: "hover", id: 8 });
    expect(fontPickerKey(key("ArrowDown"), 5, listed)).toEqual({ kind: "hover", id: 6 });
    expect(fontPickerKey(key("ArrowUp"), 6, listed)).toEqual({ kind: "hover", id: 5 });
  });

  it("starts from the first or the last when nothing listed is hovered", () => {
    expect(fontPickerKey(key("ArrowDown"), null, listed)).toEqual({ kind: "hover", id: 6 });
    expect(fontPickerKey(key("ArrowUp"), 1, listed)).toEqual({ kind: "hover", id: 5 });
    expect(fontPickerKey(key("ArrowDown"), null, [])).toEqual({ kind: "none" });
  });

  it("picks on Enter, closes on Escape and goes back to the search on Shift+F", () => {
    expect(fontPickerKey(key("Enter"), 8, listed)).toEqual({ kind: "select", id: 8 });
    expect(fontPickerKey(key("Enter"), null, listed)).toEqual({ kind: "none" });
    expect(fontPickerKey(key("Escape"), 8, listed)).toEqual({ kind: "close" });
    expect(fontPickerKey(key("F", true), 8, listed)).toEqual({ kind: "focusSearch" });
  });

  it("leaves typing to the search field", () => {
    expect(fontPickerKey(key("f"), 8, listed)).toBeNull();
    expect(fontPickerKey(key("a"), 8, listed)).toBeNull();
    expect(fontPickerKey({ ...key("F", true), ctrlKey: true }, 8, listed)).toBeNull();
  });
});

describe("loadFontFamily", () => {
  it("asks for the face before anything is laid out in it", async () => {
    const asked: string[] = [];
    await loadFontFamily({ load: async (font) => void asked.push(font) }, '"Nunito", sans-serif');
    expect(asked).toEqual(['10px "Nunito", sans-serif']);
  });

  it("settles when the face cannot be loaded, so the family still changes", async () => {
    await expect(
      loadFontFamily({ load: () => Promise.reject(new Error("offline")) }, "Nunito"),
    ).resolves.toBeUndefined();
  });
});

describe("readFontSize", () => {
  it("reads a number and refuses anything else, an empty field included", () => {
    expect(readFontSize("24")).toBe(24);
    expect(readFontSize(" 12.5 ")).toBe(12.5);
    expect(readFontSize("")).toBeNull();
    expect(readFontSize("big")).toBeNull();
    expect(readFontSize("Infinity")).toBeNull();
  });
});
