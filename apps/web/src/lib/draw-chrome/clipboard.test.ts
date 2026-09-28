import { describe, expect, it, vi } from "vitest";
import {
  COPY_FAILURE_WORDS,
  copyAsClipboard,
  clipboardSupport,
  outcomeWords,
  type ClipboardOutcome,
} from "./clipboard.ts";
import type { DrawEngine } from "@osionos/draw-engine/engine";
import type { ClipboardCopy } from "@osionos/draw-engine/types";

/**
 * What a person is told after a copy.
 *
 * The engine decides *whether* and *what*; the host decides the words, and these tests are
 * about the words and about **not being silent**. The oracle's two arms both `throw` and
 * both actions' `catch` puts the message on screen
 * (`actionClipboard.tsx@1118751f:176-184, 236-245`), so a host that swallows a failed write
 * is a behaviour the oracle does not have and a person cannot report as a bug — they paste,
 * get nothing, and have no idea why.
 */

/** A `navigator.clipboard` a test controls, so the write can fail on demand. */
function fakeClipboard(over: { write?: unknown; writeText?: unknown } = {}): Clipboard {
  return {
    write: over.write ?? vi.fn().mockResolvedValue(undefined),
    writeText: over.writeText ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as Clipboard;
}

/** The engine's answer, with one field changed, so a test can vary exactly one thing. */
function engineAnswer(over: Partial<ClipboardCopy> = {}): ClipboardCopy {
  return {
    supported: true,
    mime: "text/plain",
    scope: "selection",
    text: "<svg/>",
    ...over,
  };
}

/** An engine stub whose `clipboardCopy` returns `answer`, and records what it was asked. */
function engineStub(answer: ClipboardCopy): {
  engine: DrawEngine;
  calls: { format: string; options: unknown }[];
} {
  const calls: { format: string; options: unknown }[] = [];
  const engine = {
    clipboardCopy(format: string, options: unknown) {
      calls.push({ format, options });
      return answer;
    },
  } as unknown as DrawEngine;
  return { engine, calls };
}

describe("clipboard support", () => {
  it("reports what the browser can take, in the oracle's own spelling", () => {
    // `probablySupportsClipboardWriteText` and `probablySupportsClipboardBlob`
    // (`clipboard.ts@1118751f:65-72`). **The world is passed in, not read from the
    // environment**: this file runs under vitest, where `HTMLCanvasElement` does not exist,
    // so a test that read the real one would assert `false` for the wrong reason and pass
    // or fail with the runner rather than with the code.
    expect(
      clipboardSupport({
        clipboard: { write: async () => {}, writeText: async () => {} },
        hasClipboardItem: true,
        canEncodeCanvas: true,
      }),
    ).toEqual({ canWriteBlob: true, canWriteText: true });
  });

  it("needs all three of the oracle's conditions for the raster, not just the first", () => {
    // `"write" in navigator.clipboard && "ClipboardItem" in window && "toBlob" in
    // HTMLCanvasElement.prototype` — a conjunction of three (`clipboard.ts@1118751f:68-72`).
    // A host that checked only `write` would offer "Copy as PNG" to a browser that cannot
    // take it, which is the offer-then-do-nothing failure this feature exists to remove.
    const noItem = clipboardSupport({
      clipboard: { write: async () => {}, writeText: async () => {} },
      hasClipboardItem: false,
      canEncodeCanvas: true,
    });
    const noEncode = clipboardSupport({
      clipboard: { write: async () => {}, writeText: async () => {} },
      hasClipboardItem: true,
      canEncodeCanvas: false,
    });
    expect(noItem).toEqual({ canWriteBlob: false, canWriteText: true });
    expect(noEncode).toEqual({ canWriteBlob: false, canWriteText: true });
  });

  it("says a browser without a clipboard can take nothing", () => {
    expect(clipboardSupport({ clipboard: undefined })).toEqual({
      canWriteBlob: false,
      canWriteText: false,
    });
  });
});

describe("copying to the clipboard", () => {
  it("writes the engine's own payload under the engine's own type", async () => {
    const clipboard = fakeClipboard();
    const { engine, calls } = engineStub(engineAnswer());
    const outcome = await copyAsClipboard(engine, "svg", clipboard);

    expect(outcome).toEqual({ kind: "copied", scope: "selection" });
    expect(clipboard.writeText).toHaveBeenCalledWith("<svg/>");
    // The type is the engine's: `text/plain`, not the `image/svg+xml` a host would reach
    // for, which the oracle says does not work (`clipboard.ts@1118751f:622-625`).
    expect(calls).toHaveLength(1);
    expect(calls[0]?.format).toBe("svg");
  });

  it("asks the engine what to copy, and does not decide the scope itself", async () => {
    const clipboard = fakeClipboard();
    const { engine, calls } = engineStub(engineAnswer({ scope: "scene" }));

    const outcome = await copyAsClipboard(engine, "svg", clipboard);

    expect(outcome).toEqual({ kind: "copied", scope: "scene" });
    // **No `selectionOnly`**: the oracle's two actions pass the literal `true`
    // (`actionClipboard.tsx@1118751f:139, 212`), and a host that could ask for the whole
    // scene with something selected would own a decision the engine owns.
    expect(calls[0]?.options).not.toHaveProperty("selectionOnly");
  });

  it("says so when the write is refused, and claims nothing was copied", async () => {
    // The case the brief is really about: a permission denied, a non-secure context, or
    // Safari's `ClipboardItem` timing. The oracle reports all three
    // (`data/index.ts@1118751f:151-159, 194-213`) and this is where that is kept.
    const clipboard = fakeClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    const { engine } = engineStub(engineAnswer());

    const outcome = await copyAsClipboard(engine, "svg", clipboard);

    expect(outcome).toEqual({ kind: "refused" });
    expect(outcomeWords(outcome, "svg")).toMatch(/couldn.t copy/i);
  });

  it("says so when the browser has no clipboard at all", async () => {
    const { engine } = engineStub(
      engineAnswer({ supported: false, mime: "", refusal: "browser-cannot-take" }),
    );

    const outcome = await copyAsClipboard(engine, "svg", fakeClipboard());

    expect(outcome).toEqual({ kind: "refused" });
  });

  it("distinguishes an empty board, which a person can do something about", async () => {
    // The oracle's two halves of `predicate` say two different things
    // (`actionClipboard.tsx@1118751f:186-188, 247-249`), and collapsing them would tell
    // someone with an empty canvas that their clipboard is broken.
    const { engine } = engineStub(
      engineAnswer({ supported: false, mime: "", refusal: "nothing-to-copy" }),
    );

    const outcome = await copyAsClipboard(engine, "svg", fakeClipboard());

    expect(outcome).toEqual({ kind: "empty" });
    expect(COPY_FAILURE_WORDS.empty).toMatch(/empty/i);
  });

  it("reports a canvas too large to encode rather than pasting nothing", async () => {
    // `toBlob` answering `null` is the oracle's `CANVAS_POSSIBLY_TOO_BIG`
    // (`data/blob.ts@1118751f:245-252`), which it reports as "The canvas may be too big."
    // (`locales/en.json@1118751f:412`) rather than as a failure.
    const { engine } = engineStub(
      engineAnswer({
        mime: "image/png",
        scope: "selection",
        text: undefined,
        blob: Promise.resolve(null),
      }),
    );

    const outcome = await copyAsClipboard(engine, "png", fakeClipboard());

    expect(outcome).toEqual({ kind: "too-big" });
    expect(outcomeWords(outcome, "png")).toMatch(/too big/i);
  });

  it("never reports a copy it did not make", async () => {
    // The failure mode worth naming: a host that says "Copied" and then finds out the
    // write threw. `copied` is only reachable after the browser has accepted.
    const clipboard = fakeClipboard({ writeText: vi.fn().mockRejectedValue(new Error("no")) });
    const { engine } = engineStub(engineAnswer());

    const outcome: ClipboardOutcome = await copyAsClipboard(engine, "svg", clipboard);

    expect(outcome.kind).not.toBe("copied");
  });
});
