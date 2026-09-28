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

/**
 * The two shapes the selection cases load: a 50x20 rectangle at the origin and a 30x20 one
 * at x=500, so the scene spans 530 wide and a selection of either is unmistakably its own
 * box.
 */
const SCENE_SPAN = 530;

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

/**
 * A board of two rectangles far apart, for the selection cases.
 *
 * Loaded rather than drawn, for the reason the single-rectangle loader gives: the bounds are
 * exactly the numbers written here, so every expected size below is arithmetic and not a
 * tolerance. The ids are the ones the cases select by.
 */
async function loadTwoRectangles(page: Board["page"]): Promise<void> {
  await page.evaluate(
    ({ style }) => {
      window.__drawEngine!.loadScene(
        JSON.stringify({
          type: "osidraw",
          version: 1,
          source: "e2e",
          elements: [
            { ...style, id: "export-left", type: "rectangle", x: 0, y: 0, width: 50, height: 20 },
            {
              ...style,
              id: "export-right",
              type: "rectangle",
              x: 500,
              y: 0,
              width: 30,
              height: 20,
            },
          ],
        }),
      );
    },
    { style: STYLE },
  );
}

/**
 * A 200x200 frame holding one shape, beside a loose shape at x=500.
 *
 * The frame export case needs three things the other scenes do not: a frame to select, a
 * child inside it, and a shape far enough away that a whole-scene export is a visibly
 * different size. The child pokes 10px past the frame's right edge on purpose — that is the
 * crop the oracle's own-box framing produces, and 200 rather than 210 is the assertion.
 */
async function loadFramedScene(page: Board["page"]): Promise<void> {
  await page.evaluate(
    ({ style }) => {
      window.__drawEngine!.loadScene(
        JSON.stringify({
          type: "osidraw",
          version: 1,
          source: "e2e",
          elements: [
            {
              ...style,
              id: "export-frame",
              type: "frame",
              name: "Frame 1",
              x: 0,
              y: 0,
              width: 200,
              height: 200,
            },
            {
              ...style,
              id: "export-inside",
              type: "rectangle",
              x: 20,
              y: 20,
              width: 190,
              height: 60,
              frameId: "export-frame",
            },
            {
              ...style,
              id: "export-loose",
              type: "rectangle",
              x: 500,
              y: 0,
              width: 30,
              height: 20,
            },
          ],
        }),
      );
    },
    { style: STYLE },
  );
}

/** The dialog's own locator — the one a person opens with Ctrl+Shift+E. */
function exportDialog(board: Board) {
  return board.page.getByRole("dialog", { name: "Export Drawing" });
}

/**
 * Opens the export dialog the way a person does, off the board.
 *
 * `keepSelection` skips the click-and-Escape that drops whatever was selected. The selection
 * cases need it, because the dialog reads the selection **when it opens** — the checkbox
 * starts on if something is selected (`ImageExportDialog.tsx@1118751f:80`), and a selection
 * made after the dialog was already up cannot change it. A case that opened with a
 * selection and then selected would be asserting about a checkbox that had already been
 * decided, which is the mistake the case exists to catch.
 */
async function openExportDialog(board: Board, keepSelection = false): Promise<void> {
  if (!keepSelection) {
    await board.canvas.click({ position: { x: 5, y: 5 } });
    await board.page.keyboard.press("Escape"); // drop whatever that click selected
  }
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

/**
 * `select` on the debug handle, which is not part of the public type.
 *
 * The same cast `flowchart.spec.ts` and `focusMode.spec.ts` use, and for the same reason:
 * the harness exposes the engine for tests and does not widen its type for a test-only
 * method. Selecting by id rather than by clicking is deliberate — the box under test is a
 * function of *which* elements are selected, and a click would make the expected number
 * depend on where the shape happens to be on screen.
 */
interface SelectHandle {
  select(ids: string[]): void;
}

/** Selects by id, and waits for the engine to have taken it. */
async function selectById(page: Board["page"], ids: string[]): Promise<void> {
  await page.evaluate((wanted) => {
    (window.__drawEngine as unknown as SelectHandle).select(wanted);
  }, ids);
  await page.waitForTimeout(50);
}

/**
 * The "selection only" checkbox, as a person finds it.
 *
 * Located by name rather than by position, because the point of these cases is that the
 * control is *there* and works, and a positional selector would quietly keep passing if the
 * label were mistyped.
 */
function selectionOnlyToggle(board: Board) {
  return exportDialog(board).getByRole("checkbox", { name: "Selection only" });
}

/** Ticks or unticks it and waits for the check to land, since a click is async here. */
async function setSelectionOnly(board: Board, on: boolean): Promise<void> {
  const toggle = selectionOnlyToggle(board);
  if ((await toggle.isChecked()) !== on) await toggle.setChecked(on);
  expect(await toggle.isChecked(), "the selection-only toggle did not take").toBe(on);
}

test.describe("the selection and one-frame PNG export", () => {
  test("exports the selection's own box, and the scene's when nothing is selected", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await loadTwoRectangles(page);

    // The checkbox is on, and nothing is selected: the oracle's
    // `isExportingSelection = exportSelectionOnly && isSomeElementSelected(...)`
    // (`data/index.ts@1118751f:56-58`) is false, so this is the whole scene. It exports a
    // picture and downloads, which is exactly why it is the case nobody notices.
    await openExportDialog(board);
    await setSelectionOnly(board, true);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const emptySelection = pngSize(await exportPngFromDialog(board));
    expect(emptySelection, "a selection export of nothing is the whole scene").toEqual({
      width: SCENE_SPAN + PADDING * 2,
      height: 20 + PADDING * 2,
    });

    // Now one of the two, and the box follows the selection rather than the scene.
    await selectById(page, ["export-left"]);
    await openExportDialog(board, true);
    // The dialog opens on the checkbox when something is selected, as the oracle's does
    // (`useState(hasSelection)`, `ImageExportDialog.tsx@1118751f:80`) — so this case reads the
    // default rather than setting it, because the default is part of what is being pinned.
    expect(
      await selectionOnlyToggle(board).isChecked(),
      "the dialog starts on the selection when something is selected",
    ).toBe(true);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const oneSelected = pngSize(await exportPngFromDialog(board));
    expect(oneSelected, "the export is the selected box, not the scene's").toEqual({
      width: 50 + PADDING * 2,
      height: 20 + PADDING * 2,
    });

    // Untick it and the same selection is ignored, which is the other half of the `&&`.
    // `keepSelection` again: dropping the selection here would make the case pass for the
    // wrong reason, since an empty selection is the scene whatever the checkbox says.
    await openExportDialog(board, true);
    await setSelectionOnly(board, false);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    expect(pngSize(await exportPngFromDialog(board)), "an unset flag is the whole scene").toEqual(
      emptySelection,
    );
  });

  test("exports a selected frame at the frame's own box, with no padding", async ({ page }) => {
    const board = await openBoard(page);
    await loadFramedScene(page);

    await selectById(page, ["export-frame"]);
    await openExportDialog(board, true);
    expect(await selectionOnlyToggle(board).isChecked()).toBe(true);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const bytes = await exportPngFromDialog(board);

    // 200x200 and not 220x220: `exportingFrame ? [exportingFrame] : …` with
    // `exportPadding = 0` in front of it (`export.ts@1118751f:228-233`). A frame export is
    // measured by the frame, and the padding is gone.
    expect(pngSize(bytes), "a frame export is the frame's box, unpadded").toEqual({
      width: 200,
      height: 200,
    });
    // The loose shape at x=500 is on the same board and is not in the picture: the export is
    // 200 wide, and a whole-scene export would be 530.
    expect(
      middlePixel(bytes).a,
      "the frame's contents are painted, so the middle is ink and not bare canvas",
    ).toBe(255);
  });
});

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
