import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, test } from "./fixtures.ts";
import { openBoard, type Board } from "./board.ts";

/**
 * The whole-scene PNG export, through the dialog a person actually uses.
 *
 * The defect this file exists for: the export dialog showed a scale picker and a
 * transparent-background toggle, and the PNG button underneath ignored both — it was
 * `canvas.toBlob()` of whatever was on screen (`engine/src/engine.ts`'s old `exportPng`).
 * So the file a person got was a picture of their *viewport*, at one size, with whatever
 * background the theme had, and no combination of the two controls changed a pixel of it.
 *
 * The arithmetic under test is the engine's and is pinned as numbers in
 * `crates/draw-engine/tests/ci_export_png.rs`. What can only be checked in a browser is
 * that the numbers reach the pixels — so this file drives the real dialog, clicks the real
 * chips, and reads the real downloaded file:
 *
 * - **the size, off the file's own bytes.** A PNG's IHDR carries its width and height as
 *   two big-endian 32-bit numbers at bytes 16 and 20, so this needs no image library and
 *   no decoding: the assertion is on the file the person would have saved.
 * - **the background, off the decoded corner pixel.** A toggle that changes nothing has a
 *   file size and no visible effect, so the alpha of the top-left pixel — the padding, which
 *   is background or nothing and never ink — is what says whether it reached the canvas.
 *
 * The scene is loaded rather than drawn, so its bounds are exact and the expected size is
 * arithmetic rather than a tolerance: one 200x100 rectangle at the origin frames to
 * 220x120 at 1x, the oracle's `getCanvasSize` over `getCommonBounds` plus `exportPadding`
 * twice (`packages/excalidraw/scene/export.ts@1118751f:566-575`).
 */

/** The oracle's `DEFAULT_EXPORT_PADDING`, which the engine applies to every side. */
const PADDING = 10;

/** The scene every case below exports: one 200x100 rectangle at the origin. */
const SCENE_WIDTH = 200;
const SCENE_HEIGHT = 100;

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

/** A scene of exactly one rectangle, so its bounds are exactly what is written here. */
async function loadOneRectangle(page: Board["page"]): Promise<void> {
  await page.evaluate(
    ({ style, width, height }) => {
      window.__drawEngine!.loadScene(
        JSON.stringify({
          type: "osidraw",
          version: 1,
          source: "e2e",
          elements: [
            {
              ...style,
              id: "export-rect",
              type: "rectangle",
              x: 0,
              y: 0,
              width,
              height,
            },
          ],
        }),
      );
    },
    { style: STYLE, width: SCENE_WIDTH, height: SCENE_HEIGHT },
  );
}

/** The dialog's own locator — the one a person opens with Ctrl+Shift+E. */
function exportDialog(board: Board) {
  return board.page.getByRole("dialog", { name: "Export Drawing" });
}

/** Opens the export dialog the way a person does, off the board. */
async function openExportDialog(board: Board): Promise<void> {
  await board.canvas.click({ position: { x: 5, y: 5 } });
  await board.page.keyboard.press("Escape"); // drop whatever that click selected
  await board.page.keyboard.press("Control+Shift+E");
  await expect(exportDialog(board)).toBeVisible();
}

/** Exports through the dialog's own PNG card, and hands back the file's bytes. */
async function exportPngFromDialog(board: Board): Promise<Buffer> {
  const [download] = await Promise.all([
    board.page.waitForEvent("download"),
    exportDialog(board)
      .getByRole("button", { name: /PNG Image/ })
      .click(),
  ]);
  const path = await download.path();
  expect(path, "the PNG export produced no file").not.toBeNull();
  return readFileSync(path!);
}

/** The on-screen canvas's backing store: what the export used to be. */
async function onScreenSize(page: Board["page"]): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    return { width: canvas.width, height: canvas.height };
  });
}

/** The PNG's own size in pixels, read off its IHDR. Bytes 16..24, big-endian. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8), "not a PNG").toEqual(signature);
  expect(bytes.subarray(12, 16).toString("latin1"), "the first chunk should be IHDR").toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** One pixel of a decoded PNG, top-down and 8 bits per channel. */
interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Undo one PNG row filter. All five are needed: an encoder picks per row, and Chrome
 *  picks 2 (Up) on the first scanline of these files. */
function unfilter(
  kind: number,
  value: number,
  left: number,
  above: number,
  corner: number,
): number {
  if (kind === 0) return value;
  if (kind === 1) return value + left;
  if (kind === 2) return value + above;
  if (kind === 3) return value + ((left + above) >> 1);
  const p = left + above - corner;
  const dl = Math.abs(p - left);
  const da = Math.abs(p - above);
  const dc = Math.abs(p - corner);
  return value + (dl <= da && dl <= dc ? left : da <= dc ? above : corner);
}

/**
 * A decoded PNG: every pixel, filters undone.
 *
 * The corner alone would not need this — every filter predicts the first pixel of the
 * first row from pixels that are off the image and count as zero, so all five reconstruct
 * to the stored byte — but a pixel in the *middle* of the picture does need them, and
 * "the drawing fills the file" is the thing worth measuring.
 */
function raster(bytes: Buffer): { width: number; height: number; stride: number; pixels: Buffer } {
  // IHDR: width(4) height(4) bitDepth(1) colourType(1) compression(1) filter(1) interlace(1).
  expect(bytes[24], "expected 8 bits per channel").toBe(8);
  expect([2, 6], "expected truecolour, with or without an alpha channel").toContain(bytes[25]);
  const channels = bytes[25] === 6 ? 4 : 3;
  expect(bytes[28], "expected a single non-interlaced image").toBe(0);

  // The pixels, in order: every IDAT chunk's payload, inflated.
  const idat: Buffer[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.subarray(at + 4, at + 8).toString("latin1");
    if (kind === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + length));
    if (kind === "IEND") break;
    at += 12 + length;
  }
  expect(idat.length, "the PNG carries no image data").toBeGreaterThan(0);
  const raw = inflateSync(Buffer.concat(idat));

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const kind = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const at2 = y * stride + i;
      pixels[at2] =
        unfilter(
          kind,
          raw[y * (stride + 1) + 1 + i]!,
          i >= channels ? pixels[at2 - channels]! : 0,
          y > 0 ? pixels[at2 - stride]! : 0,
          i >= channels && y > 0 ? pixels[at2 - stride - channels]! : 0,
        ) & 0xff;
    }
  }
  return { width, height, stride, pixels };
}

/** One pixel of a decoded PNG. */
function pixelAt(image: ReturnType<typeof raster>, x: number, y: number): Pixel {
  const channels = image.stride / image.width;
  const at = y * image.stride + x * channels;
  return {
    r: image.pixels[at]!,
    g: image.pixels[at + 1]!,
    b: image.pixels[at + 2]!,
    a: channels === 4 ? image.pixels[at + 3]! : 255,
  };
}

/** The top-left pixel: the padding, which is the paper or nothing and never ink. */
function decodeTopLeftPixel(bytes: Buffer): Pixel {
  return pixelAt(raster(bytes), 0, 0);
}

/** The middle of the picture, which for this scene is the rectangle's solid fill. */
function middlePixel(bytes: Buffer): Pixel {
  const image = raster(bytes);
  return pixelAt(image, Math.floor(image.width / 2), Math.floor(image.height / 2));
}

test.describe("the whole-scene PNG export", () => {
  test("is the scene's size at the scale the chips chose, not the viewport's", async ({ page }) => {
    const board = await openBoard(page);
    await loadOneRectangle(page);

    // What the old implementation produced, and what must not come back: the on-screen
    // canvas at the device ratio. At the config's 1280x800 viewport and dpr 1 that is
    // something near 1280x800 whatever the scene measures.
    const onScreen = await onScreenSize(page);

    await openExportDialog(board);
    // The dialog opens on 2x, so this case picks its own chip rather than reading whatever
    // the default is — and clicking the chip is the behaviour under test.
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const oneBytes = await exportPngFromDialog(board);
    const atOne = pngSize(oneBytes);
    expect(atOne, "at 1x the export is the scene's bounds plus the padding on every side").toEqual({
      width: SCENE_WIDTH + PADDING * 2,
      height: SCENE_HEIGHT + PADDING * 2,
    });
    expect(atOne, "the export is not the viewport").not.toEqual(onScreen);

    // The defect, as a person meets it: the chip is clicked and the file changes.
    await openExportDialog(board);
    await exportDialog(board).getByRole("button", { name: "3x", exact: true }).click();
    const threeBytes = await exportPngFromDialog(board);
    const atThree = pngSize(threeBytes);
    expect(atThree, "at 3x the same scene is three times the size each way").toEqual({
      width: (SCENE_WIDTH + PADDING * 2) * 3,
      height: (SCENE_HEIGHT + PADDING * 2) * 3,
    });
    expect(atThree.width).toBeGreaterThan(atOne.width);

    // The size is the half that is easy, and it is the half the IHDR already said. The
    // other half is the drawing *inside* the file: a 3x export whose transform forgot the
    // scale is a 660x360 canvas with a 220x120 picture in its top-left corner, so its
    // middle is bare canvas rather than the rectangle's fill. Nothing else in this file
    // can see that, and neither can any Rust test — the scale reaches the canvas as a
    // context transform (`helpers.ts@1118751f:92-93`), which only exists in a browser.
    expect(
      middlePixel(oneBytes).a,
      "the 1x picture's middle is the rectangle's fill, not bare canvas",
    ).toBe(255);
    expect(
      middlePixel(threeBytes).a,
      "the 3x file's middle is the drawing, drawn at 3x — not bare canvas",
    ).toBe(255);
    expect(middlePixel(threeBytes), "and it is the same drawing, at another scale").toEqual(
      middlePixel(oneBytes),
    );
  });

  test("leaves out the background when the toggle is on", async ({ page }) => {
    const board = await openBoard(page);
    await loadOneRectangle(page);

    await openExportDialog(board);
    const withBackground = await exportPngFromDialog(board);
    // The top-left pixel is padding: no element is there, so it is the paper or nothing.
    expect(
      decodeTopLeftPixel(withBackground).a,
      "with the toggle off the padding is the theme's background",
    ).toBe(255);

    await openExportDialog(board);
    await exportDialog(board)
      .getByRole("checkbox", { name: /Transparent/ })
      .check();
    const without = await exportPngFromDialog(board);

    // The same picture either way — a background is not a change of size.
    expect(pngSize(without), "the toggle does not resize the export").toEqual(
      pngSize(withBackground),
    );
    expect(
      decodeTopLeftPixel(without).a,
      "with the toggle on the padding is left transparent, not filled",
    ).toBe(0);
  });

  test("exports the whole scene even when the camera is looking at part of it", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await loadOneRectangle(page);

    // Zoom in, so the scene overflows the viewport and what is on screen is a fragment.
    await page.evaluate(() => window.__drawEngine!.zoomAt(640, 400, 4));
    await page.waitForTimeout(150);
    const onScreen = await onScreenSize(page);

    await openExportDialog(board);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const bytes = await exportPngFromDialog(board);

    expect(pngSize(bytes), "a zoomed-in camera does not change the export's size").toEqual({
      width: SCENE_WIDTH + PADDING * 2,
      height: SCENE_HEIGHT + PADDING * 2,
    });
    expect(onScreen.width, "the viewport really is a different size").not.toBe(
      SCENE_WIDTH + PADDING * 2,
    );
  });
});
