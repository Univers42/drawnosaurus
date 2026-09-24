import { describe, expect, it } from "vitest";
import { type FontEvents, watchFonts } from "./fonts.ts";

function fakeFonts(): FontEvents & { done(): void; resolve(): void } {
  const target = new EventTarget();
  let resolve = (): void => {};
  const ready = new Promise<void>((settle) => {
    resolve = settle;
  });
  return {
    addEventListener: (type, listener) => target.addEventListener(type, listener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener),
    ready,
    done: () => target.dispatchEvent(new Event("loadingdone")),
    resolve,
  };
}

describe("watchFonts", () => {
  it("reports every batch of faces that finishes loading", () => {
    const fonts = fakeFonts();
    let calls = 0;
    watchFonts(fonts, () => calls++);
    fonts.done();
    fonts.done();
    expect(calls).toBe(2);
  });

  it("reports faces that were ready before anyone listened", async () => {
    const fonts = fakeFonts();
    let calls = 0;
    watchFonts(fonts, () => calls++);
    fonts.resolve();
    await fonts.ready;
    expect(calls).toBe(1);
  });

  it("stays silent once stopped, even for a ready that settles later", async () => {
    // The engine behind `loaded` may be gone by then.
    const fonts = fakeFonts();
    let calls = 0;
    const stop = watchFonts(fonts, () => calls++);
    stop();
    fonts.done();
    fonts.resolve();
    await fonts.ready;
    expect(calls).toBe(0);
  });
});
