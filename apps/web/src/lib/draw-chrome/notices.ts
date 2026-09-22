import type { DrawNotice } from "@osionos/draw-engine/types";

/**
 * The words for the things the motor reports.
 *
 * The engine emits a code and never a sentence, because the wording is the half of the
 * problem that belongs to whatever is hosting it: the language, the tone, and how much
 * room there is on screen. A second frontend on the same motor picks its own words here
 * without touching any logic, and a headless one ignores the codes entirely.
 *
 * Exhaustive by construction — `Record<DrawNotice, string>` means adding a code to the
 * engine fails the typecheck here until it has something to say.
 *
 * The strings are Excalidraw's, verbatim from
 * `packages/excalidraw/locales/en.json:349-351`, so that someone moving between the two
 * reads the same sentence for the same situation.
 */
export const NOTICE_TEXT: Record<DrawNotice, string> = {
  "fill-region-not-closed": "Couldn't find an enclosed region to fill here.",
  "fill-region-too-complex": "This region is too complex to fill.",
};
