import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type FontEvents, type LoadedFace, TEXT_FAMILIES, watchFonts } from "./fonts.ts";

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
