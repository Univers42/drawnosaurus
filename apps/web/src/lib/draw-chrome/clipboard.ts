import type { DrawEngine } from "@osionos/draw-engine/engine";
import type { ClipboardFormatName } from "@osionos/draw-engine/types";

/**
 * The one place a picture goes to the clipboard, and the one place that is told whether it
 * got there.
 *
 * ## What the host may and may not do here (BUNNY.md §2)
 *
 * May: call `navigator.clipboard`, which only a browser can; and say what happened.
 *
 * May not: choose the type, decide what is copied, or measure anything. All three come from
 * the engine's `clipboardCopy` — `image/png` or `text/plain`, the selection or the whole
 * scene, and the payload the export of that scope would have produced.
 *
 * ## The failure path, which is the point of the file
 *
 * The oracle reports every way this can fail, and none of them quietly: `exportCanvas`
 * rethrows for the vector (`data/index.ts@1118751f:151-159`) and classifies the raster's
 * into three — too big, a Firefox `ClipboardItem` that is not defined, and the generic case
 * (`:194-213`) — and both actions' `catch` puts the message on screen
 * (`actionClipboard.tsx@1118751f:176-184, 236-245`). A write that fails silently is
 * invisible until someone pastes and gets nothing, so **there is no path out of here that
 * does not end in an outcome**, and `copied` is reachable only after the browser has
 * accepted the payload.
 *
 * The two formats are not symmetric, and it is not in *whether* they report. In English the
 * oracle's two generic messages are the **same string** (`locales/en.json@1118751f:278` and
 * `:320`), so the real difference is that the raster can also say *why*. `too-big` is that
 * first extra branch, and it is the one a person can act on.
 *
 * The oracle's Safari quirk is a **success** path, not a failure one: the `ClipboardItem`
 * has to be built in the same tick or the browser complains about lack of user intent
 * (`clipboard.ts@1118751f:558-563`), which is why it constructs from the promise and retries
 * from the resolved blob. That is a rule about how a browser API must be called, so it
 * belongs here — and it needs no code, because our binding hands back a promise that is
 * already started and the `ClipboardItem` below is built synchronously in the same tick.
 */

/** How a copy ended. Every path out of {@link copyAsClipboard} is one of these. */
export type ClipboardOutcome =
  | { kind: "copied"; scope: "selection" | "scene" }
  | { kind: "refused" }
  | { kind: "empty" }
  | { kind: "too-big" };

/**
 * What a person is told when it did **not** work, from the oracle's own `locales/en.json`.
 *
 * The three are the oracle's three failure sentences, verbatim: `alerts.couldNotCopyToClipboard`
 * (`locales/en.json@1118751f:278`), `alerts.cannotExportEmptyCanvas` (`:277`) and
 * `canvasError.canvasTooBig` (`:412`). The success sentence is **not** here — it is assembled
 * by {@link outcomeWords}, because the oracle's has two slots the engine fills
 * (`:575-576`) and a lookup table would mean writing it twice.
 */
export const COPY_FAILURE_WORDS = {
  refused: "Couldn't copy to clipboard.",
  empty: "Cannot export empty canvas.",
  "too-big": "The canvas may be too big.",
} as const satisfies Record<Exclude<ClipboardOutcome["kind"], "copied">, string>;

/** The sentence for any outcome, in the oracle's own shape. */
export function outcomeWords(outcome: ClipboardOutcome, format: ClipboardFormatName): string {
  if (outcome.kind !== "copied") return COPY_FAILURE_WORDS[outcome.kind];
  const what = outcome.scope === "selection" ? "selection" : "canvas";
  return `Copied ${what} to clipboard as ${format === "png" ? "PNG" : "SVG"}`;
}

/** What the browser can take, in the oracle's own two predicates. */
export function clipboardSupport(world: {
  clipboard: Pick<Clipboard, "write" | "writeText"> | undefined;
  hasClipboardItem?: boolean;
  canEncodeCanvas?: boolean;
}): { canWriteBlob: boolean; canWriteText: boolean } {
  const clipboard = world.clipboard;
  return {
    // `probablySupportsClipboardWriteText` — `clipboard.ts@1118751f:65-66`.
    canWriteText: !!clipboard && typeof clipboard.writeText === "function",
    // `probablySupportsClipboardBlob` — `:68-72`, and it is a conjunction of three: the
    // `write` method, a `ClipboardItem` constructor, and `toBlob` on the canvas prototype.
    canWriteBlob:
      !!clipboard &&
      typeof clipboard.write === "function" &&
      world.hasClipboardItem === true &&
      world.canEncodeCanvas === true,
  };
}

/** The real browser's answer to {@link clipboardSupport}. */
export function hostClipboardSupport(): { canWriteBlob: boolean; canWriteText: boolean } {
  const globalWindow = typeof window === "undefined" ? undefined : window;
  return clipboardSupport({
    clipboard: globalWindow?.navigator.clipboard,
    hasClipboardItem: !!globalWindow && "ClipboardItem" in globalWindow,
    canEncodeCanvas:
      !!globalWindow?.HTMLCanvasElement && "toBlob" in globalWindow.HTMLCanvasElement.prototype,
  });
}

/**
 * Copies the drawing to `clipboard`, and says how it went.
 *
 * The engine is asked first and obeyed: if it declines, nothing is written and the reason
 * is reported. Otherwise the payload goes under **the engine's** `mime`, and only a write
 * the browser accepted is reported as `copied`.
 */
export async function copyAsClipboard(
  engine: DrawEngine,
  format: ClipboardFormatName,
  clipboard: Pick<Clipboard, "write" | "writeText"> | undefined = hostClipboard(),
): Promise<ClipboardOutcome> {
  const copy = engine.clipboardCopy(format, hostClipboardSupport());
  if (!copy.supported) {
    return copy.refusal === "nothing-to-copy" ? { kind: "empty" } : { kind: "refused" };
  }
  const written = await writePayload(copy, format, clipboard);
  if (written === "too-big") return { kind: "too-big" };
  return written ? { kind: "copied", scope: copy.scope } : { kind: "refused" };
}

/** What one attempt did: the browser took it, refused it, or could not encode it. */
type Written = boolean | "too-big";

/** The one write, for both formats, and the only place a `ClipboardItem` is built. */
async function writePayload(
  copy: ReturnType<DrawEngine["clipboardCopy"]>,
  format: ClipboardFormatName,
  clipboard: Pick<Clipboard, "write" | "writeText"> | undefined,
): Promise<Written> {
  if (!clipboard) return false;
  try {
    if (format === "png") {
      const blob = await copy.blob;
      // A canvas too large to encode resolves to `null`, the oracle's
      // `CANVAS_POSSIBLY_TOO_BIG` (`data/blob.ts@1118751f:245-252`). Reported as itself
      // rather than as a failure, because the remedy is a smaller drawing.
      if (!blob) return "too-big";
      // Built here, in the same tick the promise was handed over, which is the Safari rule
      // (`clipboard.ts@1118751f:558-563`) — hence the resolved blob above rather than the
      // promise itself.
      await clipboard.write([new ClipboardItem({ [copy.mime]: blob })]);
    } else if (copy.text !== undefined) {
      await clipboard.writeText(copy.text);
    } else {
      return false;
    }
    return true;
  } catch {
    // The oracle logs and rethrows (`clipboard.ts@1118751f:571-583`,
    // `data/index.ts@1118751f:194-195`); here the throw becomes the outcome, which carries
    // the same information without an unhandled rejection inside a keydown handler.
    return false;
  }
}

function hostClipboard(): Pick<Clipboard, "write" | "writeText"> | undefined {
  return typeof window === "undefined" ? undefined : window.navigator.clipboard;
}
