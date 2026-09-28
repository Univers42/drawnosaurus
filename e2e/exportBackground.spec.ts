import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, test } from "./fixtures.ts";
import { openBoard, type Board } from "./board.ts";

/**
 * The export's background, in the two formats, through the dialog a person uses.
 *
 * The defect this file exists for: the dialog's "Transparent background" row sat above three
 * format cards, so it read as a setting of the export — and it was a setting of one of them.
 * The PNG binding took it; `exportSvg(selectionOnly)` did not, and the SVG exporter wrote a
 * `<rect>` in the theme's colour whatever the switch said. `shortkey.md:450` ("Include/exclude
 * background depending on export settings") was half-open about exactly this, and 4.1's
 * `packages/conformance/tests/exportPngCoverage.test.ts` refused to claim the line because
 * of it.
 *
 * **What is only checkable in a browser, and why it needs its own file.** The engine's
 * arithmetic is pinned as numbers in `crates/draw-engine/tests/ci_export_background.rs` —
 * the paper rect, the dark filter's own literals, and the property that a background never
 * changes the geometry of what is drawn. What those cannot say is whether the *pixels* agree:
 * a filter that is right in a string and never reaches the canvas is a correct implementation
 * of nothing. So this file drives the real dialog, clicks the real switches, and reads the
 * real downloaded file.
 *
 * The independent check is the strongest thing here: **a hand-computed colour and the pixel
 * it must paint.** Every dark value asserted below is written out as a number this file did
 * not obtain from either implementation: two of them are the oracle's own test file's
 * literals (`packages/common/src/colors.test.ts@1118751f:103-107, 22-26`) and the third was
 * derived a third time, separately. The assertions are on decoded pixels of a PNG the
 * browser encoded — a filter that did nothing could not produce them, and one that filtered
 * the wrong thing could not either. A test that read its expected values out of the engine
 * would assert only that the engine is idempotent.
 *
 * No image library: a PNG's IHDR and its inflated IDAT are read by hand, the same way
 * `exportPng.spec.ts` does it and for the same reason — the file a person saved is the only
 * thing worth measuring.
 */

/** The scene every case exports: one filled rectangle, so the middle is ink and the corner is paper. */
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

const WIDTH = 200;
const HEIGHT = 100;

/** The oracle's `DEFAULT_EXPORT_PADDING`, applied to every side. */
const PADDING = 10;

/** `#ffffff` put through the same filter — the oracle's `#ffffff -> #121212`
 *  (`colors.test.ts@1118751f:22-26`), so a dark paper is not black. */
const DARK_PAPER = { r: 0x12, g: 0x12, b: 0x12 };

/** The light theme's paper, which is what an export that asks for nothing gets. */
const LIGHT_PAPER = { r: 0xff, g: 0xff, b: 0xff };

/** `#a5d8ff` — this scene's fill — through the same filter: `#154162`.
 *
 * **Derived a third time, and not by either implementation under test**: the oracle's own
 * test file pins five other inputs, and the fifth arithmetic in this project that agrees
 * with a number is worth more than a number two of them agreed on. The exact centre of a
 * 200x100 box at 1x is a solid area of the fill, so this is the pixel a person would put a
 * colour picker on — and it is asserted as the whole value, with the light export's fill as
 * the case it must differ from. */
const DARK_FILL = { r: 0x15, g: 0x41, b: 0x62 };

/** The same fill, unfiltered. */
const LIGHT_FILL = { r: 0xa5, g: 0xd8, b: 0xff };

/** A loaded scene, so its bounds are exact and every expected size is arithmetic. */
async function loadOneRectangle(page: Board["page"]): Promise<void> {
  await page.evaluate(
    ({ style, width, height }) => {
      window.__drawEngine!.loadScene(
        JSON.stringify({
          type: "osidraw",
          version: 1,
          source: "e2e",
          elements: [{ ...style, id: "bg-rect", type: "rectangle", x: 0, y: 0, width, height }],
        }),
      );
    },
    { style: STYLE, width: WIDTH, height: HEIGHT },
  );
}

function exportDialog(board: Board) {
  return board.page.getByRole("dialog", { name: "Export Drawing" });
}

async function openExportDialog(board: Board): Promise<void> {
  await board.canvas.click({ position: { x: 5, y: 5 } });
  await board.page.keyboard.press("Escape");
  await board.page.keyboard.press("Control+Shift+E");
  await expect(exportDialog(board)).toBeVisible();
}

/** Ticks or unticks one of the dialog's switches, and says so if it did not take. */
async function setSwitch(board: Board, name: string, on: boolean): Promise<void> {
  const toggle = exportDialog(board).getByRole("checkbox", { name });
  if ((await toggle.isChecked()) !== on) await toggle.setChecked(on);
  expect(await toggle.isChecked(), `the "${name}" switch did not take`).toBe(on);
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

/** Exports through the dialog's own SVG card, and hands back the document's text. */
async function exportSvgFromDialog(board: Board): Promise<string> {
  const [download] = await Promise.all([
    board.page.waitForEvent("download"),
    exportDialog(board)
      .getByRole("button", { name: /SVG Vector/ })
      .click(),
  ]);
  const path = await download.path();
  expect(path, "the SVG export produced no file").not.toBeNull();
  return readFileSync(path!, "utf8");
}

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Undo one PNG row filter. All five: an encoder picks per row, and Chrome picks 2 (Up) on
 *  the first scanline of these files. */
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

/** A decoded PNG: every pixel, filters undone. */
function raster(bytes: Buffer): { width: number; height: number; stride: number; pixels: Buffer } {
  expect(bytes[24], "expected 8 bits per channel").toBe(8);
  expect([2, 6], "expected truecolour, with or without an alpha channel").toContain(bytes[25]);
  const channels = bytes[25] === 6 ? 4 : 3;
  expect(bytes[28], "expected a single non-interlaced image").toBe(0);
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

/** The top-left pixel: the padding, which is paper or nothing and never ink. */
function cornerPixel(bytes: Buffer): Pixel {
  return pixelAt(raster(bytes), 0, 0);
}

/** The middle of the picture, which for this scene is the rectangle's solid fill. */
function middlePixel(bytes: Buffer): Pixel {
  const image = raster(bytes);
  return pixelAt(image, Math.floor(image.width / 2), Math.floor(image.height / 2));
}

/** The colours of a pixel, alpha dropped: what a person sees on a white page. */
function rgb(pixel: Pixel): { r: number; g: number; b: number } {
  return { r: pixel.r, g: pixel.g, b: pixel.b };
}

test.describe("the export's background", () => {
  test("the vector export leaves out its paper when asked, and the raster one already did", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await loadOneRectangle(page);

    // The half that was already true: the PNG's transparent switch, which 4.1 wired up.
    // The corner pixel is the padding — paper or nothing, never ink — so it is the one
    // place the answer cannot be an accident of what was drawn.
    await openExportDialog(board);
    expect(
      await exportDialog(board)
        .getByRole("checkbox", { name: "Transparent background" })
        .isChecked(),
      "an export nobody asked to be transparent has paper",
    ).toBe(false);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const opaque = await exportPngFromDialog(board);
    expect(rgb(cornerPixel(opaque)), "with paper, the corner is the paper").toEqual(LIGHT_PAPER);
    expect(cornerPixel(opaque).a, "and it is opaque").toBe(255);

    await openExportDialog(board);
    await setSwitch(board, "Transparent background", true);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const clear = await exportPngFromDialog(board);
    expect(
      cornerPixel(clear).a,
      "and without it the corner is nothing at all, not a white fill",
    ).toBe(0);
    expect(
      rgb(middlePixel(clear)),
      "while the drawing itself is untouched — a background is behind it, not over it",
    ).toEqual(rgb(middlePixel(opaque)));

    // The half this task fixes: the same switch, the other card. Before it, the SVG always
    // wrote `<rect … fill="#ffffff"/>`, and both of the assertions below would have failed
    // for the right reason — the document had a paper whatever the switch said.
    await openExportDialog(board);
    await setSwitch(board, "Transparent background", false);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const withPaper = await exportSvgFromDialog(board);
    expect(withPaper, "the vector export draws its paper when there is one").toContain(
      `<rect width="${WIDTH + PADDING * 2}" height="${HEIGHT + PADDING * 2}" fill="#ffffff"/>`,
    );

    await openExportDialog(board);
    await setSwitch(board, "Transparent background", true);
    const withoutPaper = await exportSvgFromDialog(board);
    expect(
      withoutPaper.includes("<rect width="),
      `a transparent vector export has no paper rect: ${withoutPaper}`,
    ).toBe(false);
    // And the drawing is still there, byte for byte: the property the engine test asserts
    // over a corpus, seen once in a real document.
    expect(withoutPaper).toContain(`<g transform="translate(${PADDING} ${PADDING})">`);
    expect(withoutPaper).toContain(`stroke="#1e1e1e"`);
  });

  test("a dark export paints the oracle's dark ink and the oracle's dark paper", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await loadOneRectangle(page);

    await openExportDialog(board);
    expect(
      await exportDialog(board).getByRole("checkbox", { name: "Dark mode" }).isChecked(),
      "an export nobody asked to be dark is the drawing as the board shows it",
    ).toBe(false);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const light = await exportPngFromDialog(board);

    await openExportDialog(board);
    await setSwitch(board, "Dark mode", true);
    await exportDialog(board).getByRole("button", { name: "1x", exact: true }).click();
    const dark = await exportPngFromDialog(board);

    // The independent check: two hand-computed constants, read off decoded pixels of a file
    // the browser encoded. Neither number came out of this project's code.
    expect(
      rgb(cornerPixel(dark)),
      "the paper is the light paper through the oracle's filter, not black",
    ).toEqual(DARK_PAPER);
    expect(rgb(cornerPixel(light)), "and the light export's paper is the light paper").toEqual(
      LIGHT_PAPER,
    );
    // The rectangle's own fill: a 2px stroke on a 200x100 box leaves the exact centre a
    // solid area of `#a5d8ff` many pixels wide, so this is a colour and not a blend. Both
    // halves of the pair, as whole values — an exactness that held for one of them and not
    // the other would be a tolerance wearing a test's clothes.
    expect(
      rgb(middlePixel(light)),
      "the light export's fill is the fill the scene was drawn with",
    ).toEqual(LIGHT_FILL);
    expect(
      rgb(middlePixel(dark)),
      "and the dark export's is that fill through the oracle's filter",
    ).toEqual(DARK_FILL);

    // The vector path takes the same switch, and writes the same numbers as text.
    await openExportDialog(board);
    await setSwitch(board, "Dark mode", true);
    const darkSvg = await exportSvgFromDialog(board);
    expect(darkSvg, "the vector export's paper is the same filtered colour").toContain(
      `fill="#121212"`,
    );
    expect(darkSvg, "and so is its stroke").toContain(`stroke="#d3d3d3"`);
    expect(darkSvg, "with nothing of the light export left in it").not.toContain("#1e1e1e");
  });
});
