import { expect, test } from "./fixtures.ts";
import { openBoard, type Board } from "./board.ts";

/**
 * The round trip, in a browser: a saved file that opens back as the drawing it was.
 *
 * Everything about the container is pinned natively, in
 * `crates/draw-engine/tests/ci_export_roundtrip_bytes.rs` — against a second implementation
 * of the PNG, RFC 4648's vectors, and two committed fixtures written by a third. What none
 * of that can reach is the part 4.4 had to change in `wasm/export.rs`, and it is the whole
 * of the risk in this feature: **a `toBlob` result is immutable**, so the scene has to be
 * spliced into bytes read back out with `Blob.arrayBuffer` and handed to the front as a
 * *new* `Blob`. That is a promise chain inside the WASM module, and a promise chain that
 * resolves `undefined` instead of a `Blob` looks exactly like an export that saved a plain
 * picture — a file, on disk, with nothing wrong visible.
 *
 * So this file asserts three things, each of which fails differently:
 *
 * 1. **the promise answers with a `Blob`, not `null` and not `undefined`** — the failure
 *    mode of the chain itself;
 * 2. **the file's own bytes carry the chunk** — a `tEXt` chunk keyed `osidraw`, before
 *    `IEND`, read by walking the chunk table in the test rather than by asking the engine;
 * 3. **the bytes restore to the scene that was saved**, ids included — the claim, and the
 *    only one a person ever notices.
 */

/** The key the engine writes its scene under, in both containers. */
const KEYWORD = "osidraw";

const STYLE = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "#a5d8ff",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
} as const;

/**
 * A scene of two elements, the second holding text that a Latin-1 `tEXt` chunk and an XML
 * comment would each mangle: an accent, an emoji, an em dash, and a `--`.
 */
const SCENE = {
  type: "osidraw",
  version: 1,
  source: "e2e",
  elements: [
    { ...STYLE, id: "rt-box", type: "rectangle", x: 0, y: 0, width: 200, height: 100 },
    {
      ...STYLE,
      id: "rt-text",
      type: "text",
      x: 240,
      y: 20,
      width: 260,
      height: 30,
      text: "héllo 🐰 — a--b",
      fontSize: 20,
    },
  ],
};

async function loadScene(page: Board["page"]): Promise<void> {
  await page.evaluate((scene) => {
    window.__drawEngine!.loadScene(JSON.stringify(scene));
  }, SCENE);
}

/**
 * The bytes of a whole-scene PNG, with the scene spliced in, as the engine wrote them.
 *
 * Asked for in the page rather than through the dialog: what is under test is the byte
 * hand-off, and a dialog would put a download and a click between the engine and the
 * assertion for no gain. `e2e/exportPng.spec.ts` is the file that drives the dialog.
 */
async function exportedPng(page: Board["page"]): Promise<number[]> {
  return page.evaluate(async () => {
    const blob = await window.__drawEngine!.exportPng({ scale: 1 });
    if (!blob) throw new Error("the export answered with no blob");
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
}

/**
 * The text of the first `tEXt` chunk under `keyword`, read by walking the chunk table here.
 *
 * The same rule `png-chunk-text@1.0.0` uses (`decode.js:12-28`): the keyword runs to the
 * first NUL and everything after it is the text. The walk is in the test on purpose — asking
 * the engine whether it can read its own file would be the round trip this file exists to
 * distrust.
 */
function textChunk(png: number[], keyword: string): string | null {
  const at = new DataView(Uint8Array.from(png).buffer);
  for (let cursor = 8; cursor + 12 <= png.length;) {
    const length = at.getUint32(cursor);
    const kind = String.fromCharCode(...png.slice(cursor + 4, cursor + 8));
    const data = png.slice(cursor + 8, cursor + 8 + length);
    cursor += 12 + length;
    if (kind !== "tEXt") continue;
    const split = data.indexOf(0);
    if (String.fromCharCode(...data.slice(0, split)) !== keyword) continue;
    return String.fromCharCode(...data.slice(split + 1));
  }
  return null;
}

/** The `tEXt` chunks of a PNG, in the order they appear. */
function chunkKinds(png: number[]): string[] {
  const at = new DataView(Uint8Array.from(png).buffer);
  const kinds: string[] = [];
  for (let cursor = 8; cursor + 12 <= png.length;) {
    const length = at.getUint32(cursor);
    kinds.push(String.fromCharCode(...png.slice(cursor + 4, cursor + 8)));
    cursor += 12 + length;
  }
  return kinds;
}

test.describe("the round trip", () => {
  test("a saved PNG carries the scene and opens back as the drawing it was", async ({ page }) => {
    const board = await openBoard(page);
    await loadScene(board.page);

    const png = await exportedPng(board.page);
    const kinds = chunkKinds(png);
    expect(kinds).toContain("tEXt");
    // `chunks.splice(-1, 0, metadataChunk)` — "insert metadata before last chunk (iEND)"
    // (`data/image.ts@1118751f:44`). `IEND` last or no decoder reads the file at all.
    expect(kinds[kinds.length - 1]).toBe("IEND");
    expect(kinds.indexOf("tEXt")).toBe(kinds.length - 2);

    const payload = textChunk(png, KEYWORD);
    expect(payload, "the file's own bytes should carry our chunk").not.toBeNull();
    expect(payload!.startsWith("1:")).toBe(true);

    // The whole claim, in the app: the bytes open back as the scene that was saved, with
    // every id and every character of text. An empty board is the failure this asserts
    // against, and it is the one a person would find by opening a file and seeing nothing.
    const restored = await board.page.evaluate((bytes) => {
      const outcome = window.__drawEngine!.restoreFromImage(Uint8Array.from(bytes));
      return outcome.restored === true ? window.__drawEngine!.exportJson() : outcome.refused;
    }, png);

    expect(typeof restored, `the file should have opened, not been refused`).toBe("string");
    const scene = JSON.parse(restored as string) as { elements: Record<string, unknown>[] };
    expect(scene.elements.map((element) => element.id)).toEqual(["rt-box", "rt-text"]);
    expect(scene.elements[1]?.["text"]).toBe("héllo 🐰 — a--b");
  });

  test("a saved SVG carries the scene and opens back as the drawing it was", async ({ page }) => {
    const board = await openBoard(page);
    await loadScene(board.page);

    const svg = await board.page.evaluate(() => window.__drawEngine!.exportSvg({}) ?? "");
    expect(svg).toContain("<!-- svg-source:osidraw -->");
    expect(svg).toContain(`<!-- payload-type:${KEYWORD} -->`);
    expect(svg).toContain("<!-- payload-version:1 -->");
    expect(svg).toContain("<!-- payload-start -->");
    // A scene holding `--` must not be able to close the comment the payload lives in.
    expect(svg.match(/<!-- payload-end -->/g)).toHaveLength(1);

    const restored = await board.page.evaluate((text) => {
      const bytes = new TextEncoder().encode(text);
      const outcome = window.__drawEngine!.restoreFromImage(bytes);
      return outcome.restored === true ? window.__drawEngine!.exportJson() : outcome.refused;
    }, svg);

    expect(typeof restored, `the file should have opened, not been refused`).toBe("string");
    const scene = JSON.parse(restored as string) as { elements: Record<string, unknown>[] };
    expect(scene.elements.map((element) => element.id)).toEqual(["rt-box", "rt-text"]);
    expect(scene.elements[1]?.["text"]).toBe("héllo 🐰 — a--b");
  });

  test("a picture with no scene in it is refused, and the board is untouched", async ({ page }) => {
    const board = await openBoard(page);
    await loadScene(board.page);
    const before = await board.page.evaluate(() => window.__drawEngine!.exportJson());

    // A PNG the engine never wrote: the `tEXt` chunk taken out, byte for byte. What a
    // person gets from any other tool, and the case the oracle reports as `INVALID`
    // (`data/image.ts@1118751f:70`). The answer has to be a refusal and not an empty board,
    // because an empty board is what a fresh one looks like.
    const without = await board.page.evaluate(async () => {
      const blob = await window.__drawEngine!.exportPng({ scale: 1 });
      if (!blob) throw new Error("the export answered with no blob");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const at = new DataView(bytes.buffer);
      let cursor = 8;
      let end = bytes.length;
      while (cursor + 12 <= bytes.length) {
        const length = at.getUint32(cursor);
        const kind = String.fromCharCode(...bytes.slice(cursor + 4, cursor + 8));
        if (kind === "tEXt") {
          end = cursor;
          break;
        }
        cursor += 12 + length;
      }
      // Keep the signature and `IEND`; the signature has to stay, or the engine calls it
      // `malformed` and this case would be testing the wrong refusal.
      const iend = new Uint8Array(12);
      iend.set([0, 0, 0, 0, ...[...new TextEncoder().encode("IEND")], 0xae, 0x42, 0x60, 0x82]);
      return [...bytes.slice(0, end), ...iend];
    });

    const outcome = await board.page.evaluate((bytes) => {
      const result = window.__drawEngine!.restoreFromImage(Uint8Array.from(bytes));
      return { outcome: result.refused ?? "restored", scene: window.__drawEngine!.exportJson() };
    }, without);

    expect(outcome.outcome).toBe("not-ours");
    // And the board is exactly as it was: a refusal cannot have touched it, which is the
    // reason the scene is loaded inside the binding rather than handed back.
    expect(outcome.scene).toBe(before);
  });
});
