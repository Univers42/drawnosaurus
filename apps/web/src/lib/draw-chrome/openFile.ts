import type { DrawEngine } from "@osionos/draw-engine/engine";
import { migrateLegacyStickyJson } from "../notes/stickyNotes.ts";

/**
 * Opening a file somebody saved, out of the picker and onto the board.
 *
 * Two doors, and this module's whole job is to try them in the right order and say what
 * happened. Both doors are the engine's: the bytes go to `restoreFromImage` and the text
 * goes to `loadScene`, and every question either of them could be asked — what container
 * the file is, what key the chunk is under, whether a corrupt chunk means "not mine" or
 * "broken" — is answered in Rust (BUNNY.md §2).
 *
 * **The bytes go first, and the reason is the order the failure would happen in.** A `.png`
 * read as text is a `string` of mojibake, so a text-first path would have the engine say
 * "that is not a drawing" about a perfectly good picture, and the natural fix — a look at
 * the extension — is the front deciding what a file is. The engine sniffs the PNG signature
 * instead (`export/roundtrip.rs`), and a file it does not recognise comes back `not-ours`,
 * which is the one answer that means "try the other door" rather than "this is broken".
 *
 * The text door is the `.osidraw` save, and it goes through
 * [`migrateLegacyStickyJson`] first because a board saved while a sticky note was four plain
 * shapes opens as the note the engine draws (`stickyNotes.ts:1-7`). That migration is the
 * front's own scene-schema decision and is a law-3 finding of its own, reported rather than
 * moved here.
 */

/** What happened to a file, in the words a caller can act on. */
export type OpenOutcome =
  /** The board on screen is this file now. */
  | "restored"
  /**
   * Neither door recognised it, and the board is exactly as it was.
   *
   * A distinct answer from "restored" because the two look identical on screen if the board
   * happened to be empty, and the caller has to be able to say so.
   */
  | "not-a-drawing";

/**
 * Open `file` on `engine`.
 *
 * `now` and `nonce` are the sticky migration's two inputs and are parameters rather than
 * `Date.now()` and `Math.random()` so a test can be a function of its input.
 */
export async function openDrawing(
  file: File,
  engine: DrawEngine,
  now: number,
  nonce: () => number,
): Promise<OpenOutcome> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fromImage = engine.restoreFromImage(bytes);
  if ("restored" in fromImage && fromImage.restored) return "restored";
  // `malformed` and `unreadable` are both "we looked and there is no drawing here", and
  // both are worth the second door: a `.osidraw` file is not a PNG and not an SVG, so the
  // engine calls it `malformed` and the text door is exactly what is left. The refusal is
  // not reported until the text door has also said no.
  if (!engine.loadScene(fromText(bytes, now, nonce))) return "not-a-drawing";
  return "restored";
}

/** The bytes as the text the other door reads, migrated if it is a legacy sticky board. */
function fromText(bytes: Uint8Array, now: number, nonce: () => number): string {
  const text = new TextDecoder().decode(bytes);
  return migrateLegacyStickyJson(text, now, nonce) ?? text;
}
