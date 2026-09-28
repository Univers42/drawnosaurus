import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, sceneElements, selection, type Board } from "./board.ts";

/**
 * Copy as PNG / as SVG, through the menu a person actually opens.
 *
 * The engine's side is pinned as numbers in `crates/draw-engine/tests/ci_export_clipboard.rs`
 * and as properties in `ci_export_clipboard_props.rs`. What only a browser can answer is
 * whether `navigator.clipboard` ever receives the picture, and under **which type** — the
 * one thing a host is not allowed to get wrong, since `image/svg+xml` pastes as text into
 * nothing and `text/plain` pastes as text into everything.
 *
 * ## How this spec gets a clipboard, and why the assertions do not depend on it
 *
 * `context.grantPermissions(["clipboard-read", "clipboard-write"])` on 127.0.0.1, which is
 * one of the origins a browser treats as a secure context — the same two lines
 * `e2e/clipboard.spec.ts:51-53` already uses for Ctrl+V, so this is the house precedent
 * and not a new grant invented for this file.
 *
 * **But reading the clipboard back is not how the raster is checked, and deliberately.**
 * `navigator.clipboard.read()` in headless Chromium is unreliable for `image/png`, and a
 * spec that depends on it would pass only where the permission happens to be granted —
 * which is the failure the brief warns about. So `navigator.clipboard.write` is
 * **intercepted** in the page: the spec records exactly what the app handed the browser and
 * asserts on that. The permission grant stays, because the app's own
 * `probablySupportsClipboardBlob` checks the *real* `navigator.clipboard`, and a spec that
 * stubbed the support check too would be testing the stub. What is proven is the contract
 * at the boundary — the type, the payload, the scope word — and the real grant is what lets
 * the app decide it is allowed to try.
 *
 * The one case that really does round-trip through the OS clipboard is the vector, because
 * `writeText` is dependable in headless Chromium; that test reads the text back.
 */

/** What the app handed `navigator.clipboard`, recorded before the real call. */
interface Written {
  type: string;
  /** Base64 of a blob, or the text itself. */
  payload: string;
  /** True for `write`, false for `writeText`. */
  asItem: boolean;
}

declare global {
  interface Window {
    __clipboardWrites?: Written[];
  }
}

/**
 * Records every clipboard write and then performs it for real.
 *
 * **Record, not replace.** The write is delegated to the genuine `navigator.clipboard`
 * after the payload has been noted, so the app's success path is the real one and the
 * toast it shows is about a write the browser actually accepted. The interception only adds
 * the observation.
 *
 * Why observe at all: the type a payload is written under is the one thing this file exists
 * to pin, and it cannot be read back. `navigator.clipboard.read()` in headless Chromium
 * does not reliably hand back an `image/png`, so a spec that pasted and re-read the picture
 * would pass or fail with the runner rather than with the app. `text/plain` *is* dependable
 * — the last test here round-trips through the OS clipboard for exactly that reason — but
 * the raster's type is only visible at the moment of the write.
 *
 * Installed with `addInitScript`, before the app's module graph runs, so a copy made from a
 * chord pressed right after `openBoard` is recorded too. `navigator.clipboard` is present at
 * document-start on a granted 127.0.0.1 origin, and plain assignment to its methods is
 * honoured — both probed, because either being false is a silent reason for an empty record
 * and this helper's first version had both assumptions.
 */
async function recordClipboardWrites(page: Board["page"]): Promise<void> {
  await page.addInitScript(() => {
    window.__clipboardWrites = [];
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    const base64 = (blob: Blob) =>
      blob.arrayBuffer().then((buffer) => {
        let binary = "";
        for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
        return btoa(binary);
      });
    const realWrite = clipboard.write.bind(clipboard);
    const realWriteText = clipboard.writeText.bind(clipboard);
    clipboard.write = async (items: ClipboardItems) => {
      for (const item of items) {
        for (const type of item.types) {
          // `getType` answers a **promise**. Treating it as a Blob was this helper's first
          // bug and it failed as an empty record with nothing near the cause.
          const blob = await item.getType(type);
          window.__clipboardWrites?.push({ type, payload: await base64(blob), asItem: true });
        }
      }
      await realWrite(items);
    };
    clipboard.writeText = async (text: string) => {
      window.__clipboardWrites?.push({ type: "text/plain", payload: text, asItem: false });
      await realWriteText(text);
    };
  });
}

/** The width and height a PNG's own IHDR carries, at bytes 16 and 20. */
function pngSize(base64: string): { width: number; height: number } {
  const bytes = Buffer.from(base64, "base64");
  const at = (offset: number) => bytes.readUInt32BE(offset);
  if (bytes.subarray(1, 4).toString("latin1") !== "PNG") throw new Error("not a PNG");
  return { width: at(16), height: at(20) };
}

/** A scene of one 200x100 rectangle, so the export's box is arithmetic, not a tolerance. */
async function loadOneRectangle(page: Board["page"]): Promise<void> {
  await page.evaluate(() => {
    window.__drawEngine!.loadScene(
      JSON.stringify({
        type: "osidraw",
        elements: [
          {
            id: "rect-1",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 200,
            height: 100,
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
          },
        ],
      }),
    );
  });
  await expect.poll(async () => (await sceneElements(page)).length).toBe(1);
}

/** Opens the context menu and picks one of the two copy rows by its label. */
async function copyFromMenu(
  page: Board["page"],
  board: Board,
  label: RegExp,
  at = { x: 640, y: 400 },
): Promise<void> {
  await page.mouse.click(board.box.x + at.x, board.box.y + at.y, { button: "right" });
  const item = page.getByRole("menuitem", { name: label });
  await expect(item).toBeVisible();
  await item.click();
}

test.describe("copy as PNG / as SVG", () => {
  test("both entries are in the context menu, and only the raster prints a chord", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const board = await openBoard(page);
    await loadOneRectangle(page);
    await focusBoard(board);

    await page.mouse.click(board.box.x + 640, board.box.y + 400, { button: "right" });
    const png = page.getByRole("menuitem", { name: /Copy to clipboard as PNG/ });
    const svg = page.getByRole("menuitem", { name: /Copy to clipboard as SVG/ });
    await expect(png).toBeVisible();
    await expect(svg).toBeVisible();
    // `actionCopyAsPng` has a `keyTest` (`actionClipboard.tsx@1118751f:250`) and
    // `actionCopyAsSvg` declares none (`:124-190`), so only one row carries a hint. The
    // oracle's own asymmetry, and a menu that printed a chord for the vector would be
    // advertising a key that does nothing.
    await expect(png).toContainText("Shift+C");
    await expect(svg).not.toContainText("Shift+C");
  });

  test("copy as PNG writes an image/png of the whole scene, at the export's own size", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await recordClipboardWrites(page);
    const board = await openBoard(page);
    await loadOneRectangle(page);
    await focusBoard(board);

    await copyFromMenu(page, board, /Copy to clipboard as PNG/);

    await expect
      .poll(async () => await page.evaluate(() => window.__clipboardWrites ?? []))
      .toHaveLength(1);
    const [written] = await page.evaluate(() => window.__clipboardWrites ?? []);
    // The type is the engine's (`clipboard.ts@1118751f:568-570`), and the raster is the
    // only format written as a `ClipboardItem` at all.
    expect(written?.type).toBe("image/png");
    expect(written?.asItem).toBe(true);
    // 200x100 at the origin, plus the oracle's 10 of padding on each side
    // (`constants.ts@1118751f:398`) — the same arithmetic `exportPng.spec.ts` checks on
    // the downloaded file, here on the pasted bytes.
    expect(pngSize(written!.payload)).toEqual({ width: 220, height: 120 });
    await expect(page.getByRole("status")).toContainText("Copied canvas to clipboard as PNG");
  });

  test("copy as SVG writes the vector as text/plain, and it is the file export's own string", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await recordClipboardWrites(page);
    const board = await openBoard(page);
    await loadOneRectangle(page);
    await focusBoard(board);

    await copyFromMenu(page, board, /Copy to clipboard as SVG/);

    await expect
      .poll(async () => await page.evaluate(() => window.__clipboardWrites ?? []))
      .toHaveLength(1);
    const [written] = await page.evaluate(() => window.__clipboardWrites ?? []);
    // **`text/plain`, not `image/svg+xml`**: the oracle writes the vector as text because
    // `navigator.clipboard.write` "doesn't work with non-standard mime types"
    // (`clipboard.ts@1118751f:622-625`).
    expect(written?.type).toBe("text/plain");
    expect(written?.asItem).toBe(false);
    expect(written?.payload).toContain("<svg");
    // And it is the export's own picture: the same root box the PNG above was 220x120.
    expect(written?.payload).toContain('width="220"');
    expect(written?.payload).toContain('height="120"');
  });

  test("a selection is copied as a selection, and the toast says so", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await recordClipboardWrites(page);
    const board = await openBoard(page);
    await loadOneRectangle(page);
    await focusBoard(board);
    await page.keyboard.press("Control+a");
    await expect.poll(async () => (await selection(page)).length).toBe(1);

    await copyFromMenu(page, board, /Copy to clipboard as PNG/);

    await expect(page.getByRole("status")).toContainText("Copied selection to clipboard as PNG");
  });

  test("Alt+Shift+C copies as PNG, and Ctrl+Alt+Shift+C still copies styles", async ({
    page,
    context,
  }) => {
    // The collision the oracle has and we resolve differently, pinned here as behaviour:
    // `actionCopyAsPng`'s `keyTest` has no Ctrl/Cmd condition and copy styles' has no
    // Shift condition (`actionClipboard.tsx@1118751f:250`;
    // `actionStyles.ts@1118751f:78-79`), so on the four-key press the oracle matches two
    // actions and `handleKeyDown` refuses to choose
    // (`actions/manager.tsx@1118751f:114-119`) — the key does nothing. Ours is a
    // first-match chain, so `!mod` sends the four-key press to copy styles. See
    // `shortcutRegistry.test.ts` for the same claim at the unit level.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await recordClipboardWrites(page);
    const board = await openBoard(page);
    await loadOneRectangle(page);
    await focusBoard(board);
    // Something selected first, because `engine.copyStyles()` reports whether it changed
    // anything and refuses an empty selection — so without this the row would be silent and
    // the assertion would be reading the *previous* toast, not noticing a missing one.
    await page.keyboard.press("Control+a");
    await expect.poll(async () => (await selection(page)).length).toBe(1);

    await page.keyboard.press("Alt+Shift+C");
    await expect
      .poll(async () => await page.evaluate(() => window.__clipboardWrites ?? []))
      .toHaveLength(1);
    // "selection", not "canvas": the Ctrl+A above selected everything, and the scope word
    // is the engine's own answer about what it copied — which is the whole reason it is the
    // engine's, and why it is not a fixed string this test chose.
    await expect(page.getByRole("status")).toContainText("Copied selection to clipboard as PNG");

    await page.keyboard.press("Control+Alt+Shift+C");
    await expect(page.getByRole("status")).toContainText("Copied styles.");
    // **The load-bearing half**: the four-key press wrote nothing to the clipboard, so the
    // chord that copies as PNG did not take it. The oracle's own answer here is that both
    // handlers match and the key does nothing at all; ours picks copy styles, and this
    // says the raster was not the one picked.
    expect(await page.evaluate(() => window.__clipboardWrites?.length)).toBe(1);
  });

  test("an empty board says the canvas is empty rather than blaming the clipboard", async ({
    page,
    context,
  }) => {
    // The two halves of the oracle's `predicate` get two different sentences: the entry is
    // simply absent for a browser that cannot take the payload, while an empty board leaves
    // the entry visible and reports `alerts.cannotExportEmptyCanvas`
    // (`data/index.ts@1118751f:120-122`). A single "couldn't copy" would be a thing nobody
    // can do anything about.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await recordClipboardWrites(page);
    const board = await openBoard(page);
    await focusBoard(board);
    await expect.poll(async () => (await sceneElements(page)).length).toBe(0);

    await copyFromMenu(page, board, /Copy to clipboard as SVG/);

    await expect(page.getByRole("status")).toContainText("Cannot export empty canvas.");
    expect(await page.evaluate(() => window.__clipboardWrites?.length)).toBe(0);
  });

  test("a refused write is reported, not swallowed", async ({ page, context }) => {
    // The failure nobody notices until someone pastes and gets nothing. The write is made
    // to reject here, and the spec asserts a sentence appears — the oracle's behaviour is
    // to throw in both arms and set `errorMessage`
    // (`actionClipboard.tsx@1118751f:176-184, 236-245`).
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const board = await openBoard(page);
    await loadOneRectangle(page);
    await focusBoard(board);
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
    });

    await copyFromMenu(page, board, /Copy to clipboard as SVG/);

    await expect(page.getByRole("status")).toContainText("Couldn't copy to clipboard.");
  });

  test("the vector really lands on the OS clipboard, readable back", async ({ page, context }) => {
    // The one case that needs no interception at all, and the reason this file can claim
    // the copy **works** rather than only that the app tried. `text/plain` survives the
    // round-trip through the OS clipboard in headless Chromium where an `image/png` does
    // not, so this is the payload that can be read back — and reading it back is what
    // separates "wrote the export" from "wrote something plausible".
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const board = await openBoard(page);
    await loadOneRectangle(page);
    await focusBoard(board);

    await copyFromMenu(page, board, /Copy to clipboard as SVG/);
    await expect(page.getByRole("status")).toContainText("Copied canvas to clipboard as SVG");

    const readBack = await page.evaluate(() => navigator.clipboard.readText());
    expect(readBack).toContain("<svg");
    expect(readBack).toContain('width="220"');
  });
});
