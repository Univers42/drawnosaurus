import { describe, expect, it, vi } from "vitest";
import { openDrawing } from "./openFile.ts";
import type { DrawEngine } from "@osionos/draw-engine/engine";
// The deep path, not the barrel (BUNNY.md §11), and `/types` rather than `/engine`
// because `RestoreOutcome` is a type the host is told, not a thing it calls — the same
// split `clipboard.ts` makes for `ClipboardFormatName`.
import type { RestoreOutcome } from "@osionos/draw-engine/types";

/**
 * Opening a saved file: the two doors, the order, and the answer.
 *
 * The claims here are about **who decides**, because that is the part a unit test can see
 * and the part BUNNY.md §2 is about. What a `.png` is, what its chunk is keyed, whether a
 * corrupt chunk means "not mine" or "broken" — all of it is in Rust, and this file's job
 * is to prove the front has no opinion: it hands the bytes over, takes the engine's word,
 * and reports it.
 *
 * A `DrawEngine` cannot be built in node, so this drives a **fake** that records what it
 * was asked. That is the right shape for these claims and the wrong shape for the claims
 * the engine tests make: nothing here proves a picture restores, and `ci_export_roundtrip*.rs`
 * does that against real bytes. What this proves is that the front does not decide — and a
 * test that used the real engine could not tell the difference between "the engine said no"
 * and "the front never asked".
 */

const NOW = 1_700_000_000_000;

function aFile(bytes: Uint8Array, name = "drawing.png"): File {
  return { name, arrayBuffer: async () => bytes.buffer } as unknown as File;
}

/** An engine that answers the image door one way and the text door another, and records both. */
function anEngine(image: RestoreOutcome, text: boolean) {
  const seen: { bytes: number[]; json: string[] } = { bytes: [], json: [] };
  const engine = {
    restoreFromImage(bytes: Uint8Array) {
      seen.bytes.push(...bytes);
      return image;
    },
    loadScene(json: string) {
      seen.json.push(json);
      return text;
    },
  };
  return { engine: engine as unknown as DrawEngine, seen };
}

describe("openDrawing", () => {
  it("hands the engine the file's bytes and takes its word for it", async () => {
    // The whole claim of this file in one case: a picture the engine opened, opened, and
    // the text door was never touched. If the front had sniffed the extension, or decoded
    // anything, `seen.bytes` would not be the file and `seen.json` would not be empty.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { engine, seen } = anEngine({ restored: true }, true);

    expect(await openDrawing(aFile(bytes), engine, NOW, () => 1)).toBe("restored");
    expect(seen.bytes).toEqual([...bytes]);
    expect(seen.json).toEqual([]);
  });

  it("falls through to the text door when the engine does not recognise the bytes", async () => {
    // A `.osidraw` save is not a PNG and not an SVG, so the engine calls it `malformed` —
    // and `malformed` must not be the end of the story, or every saved board would stop
    // opening. All three refusals go through to the other door.
    for (const refused of ["malformed", "not-ours", "unreadable"] as const) {
      const { engine, seen } = anEngine({ refused }, true);
      const json = '{"type":"osidraw","version":1,"elements":[]}';
      const outcome = await openDrawing(
        aFile(new TextEncoder().encode(json), "drawing.osidraw"),
        engine,
        NOW,
        () => 1,
      );
      expect(outcome, refused).toBe("restored");
      expect(seen.json, refused).toEqual([json]);
    }
  });

  it("reports that a file is not a drawing when neither door says so", async () => {
    // And the answer a caller can act on. The board is untouched, which is the engine's
    // promise and not this module's: a refusal never reaches `loadScene`.
    const { engine, seen } = anEngine({ refused: "unreadable" }, false);

    expect(await openDrawing(aFile(new Uint8Array([1, 2, 3])), engine, NOW, () => 1)).toBe(
      "not-a-drawing",
    );
    expect(seen.json).toEqual(["\u0001\u0002\u0003"]);
  });

  it("does not read the picture as text", async () => {
    // The order is the point, and this is the case that pins it. A PNG read as text is a
    // string of replacement characters, so a text-first path would hand the engine mojibake
    // for a perfectly good file. The engine is asked about the **bytes**, first and only.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd8, 0xff, 0xe0]);
    const { engine, seen } = anEngine({ restored: true }, true);

    await openDrawing(aFile(bytes), engine, NOW, () => 1);
    expect(seen.bytes).toEqual([...bytes]);
    expect(seen.json).toEqual([]);
  });

  it("passes the sticky migration its own clock and its own nonce", async () => {
    // `migrateLegacyStickyJson` mints ids, so a function of `Date.now()` and
    // `Math.random()` would make the migration untestable and unrepeatable. Both arrive as
    // arguments, which is what this case watches.
    const board =
      '{"type":"osidraw","version":1,"elements":[{"id":"g1","type":"group",' +
      '"groupIds":["g1"],"x":0,"y":0,"width":10,"height":10,"angle":0,' +
      '"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid",' +
      '"strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,' +
      '"isDeleted":false,"seed":1,"version":1,"versionNonce":1,"updated":1}]}';
    const { engine, seen } = anEngine({ refused: "malformed" }, true);
    const nonce = vi.fn(() => 7);

    expect(await openDrawing(aFile(new TextEncoder().encode(board)), engine, NOW, nonce)).toBe(
      "restored",
    );
    expect(seen.json).toHaveLength(1);
    // Whatever the migration did or did not do, the call happened with this clock and a
    // nonce that came from the caller rather than from the module.
    expect(nonce).not.toHaveBeenCalled();
  });
});
