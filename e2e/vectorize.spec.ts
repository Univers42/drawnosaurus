import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  focusBoard,
  listenForPicker,
  openBoard,
  patchedElements,
  pickTool,
  sceneElements,
  selection,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * Vectorize: an image on the board, traced in a worker and put back in its place — as
 * editable shapes or as one SVG picture — in one undoable step. See
 * `docs/reference/vectorize.md`.
 *
 * The picture is flat colour made by the browser — paper, a red disc, a blue square — so
 * "the trace is there" is a colour at a known point, and a blurred edge is measurable.
 */

const PICTURE = { width: 240, height: 160 };
const RED = [200, 60, 60] as const;
const BLUE = [40, 90, 200] as const;
const PAPER = [240, 240, 240] as const;
/** The disc and the square, in the picture's own pixels. */
const DISC = { x: 80, y: 80, r: 50 };
const SQUARE = { x: 160, y: 40, size: 60 };

async function flatPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height, disc, square }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgb(240, 240, 240)";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "rgb(200, 60, 60)";
      ctx.beginPath();
      ctx.arc(disc.x, disc.y, disc.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgb(40, 90, 200)";
      ctx.fillRect(square.x, square.y, square.size, square.size);
      return canvas.toDataURL("image/png").split(",")[1]!;
    },
    { ...PICTURE, disc: DISC, square: SQUARE },
  );
  return Buffer.from(base64, "base64");
}

async function insertPicture(board: Board): Promise<SceneElement> {
  const { page } = board;
  const listening = await listenForPicker(page);
  await pickTool(page, "Insert image");
  await (
    await listening.opened
  ).setFiles({
    name: "flat.png",
    mimeType: "image/png",
    buffer: await flatPng(page),
  });
  await expect.poll(async () => (await sceneElements(page)).length).toBe(1);
  return (await sceneElements(page))[0]!;
}

/** Page coordinates of a point of the picture, through the element's box and the camera. */
async function onPage(board: Board, image: SceneElement, px: number, py: number) {
  const { x, y, scale } = await board.page.evaluate(() => window.__drawEngine!.camera);
  const wx = image.x + (px / PICTURE.width) * image.width;
  const wy = image.y + (py / PICTURE.height) * image.height;
  return { x: board.box.x + wx * scale + x, y: board.box.y + wy * scale + y };
}

/** The canvas colour under a page point. */
function colourAt(page: Page, at: { x: number; y: number }): Promise<number[]> {
  return page.evaluate((point) => {
    const canvas = document.querySelector("canvas")!;
    const rect = canvas.getBoundingClientRect();
    const k = canvas.width / rect.width;
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(
      Math.round((point.x - rect.left) * k),
      Math.round((point.y - rect.top) * k),
      1,
      1,
    );
    return [data[0]!, data[1]!, data[2]!];
  }, at);
}

function near(colour: number[], target: readonly number[], tolerance = 24): boolean {
  return colour.every((c, i) => Math.abs(c - target[i]!) <= tolerance);
}

/** Waits until the canvas under `at` is `target`, give or take antialiasing. */
async function expectColour(
  page: Page,
  at: { x: number; y: number },
  target: readonly number[],
  message: string,
): Promise<void> {
  await expect.poll(async () => near(await colourAt(page, at), target), { message }).toBe(true);
}

/**
 * How many pixels, along a horizontal run across the square's right edge, are neither its
 * blue nor the paper — the width of the edge, in device pixels. The edge is on a pixel
 * boundary of the picture, so it is sharp in the source: enlarged eight times, a raster
 * smears it across the interpolation; a vector redrawn at the zoom keeps it to the one or
 * two pixels of antialiasing.
 */
function edgeWidth(page: Page, from: { x: number; y: number }, length: number): Promise<number> {
  return page.evaluate(
    ({ from, length, blue, paper }) => {
      const canvas = document.querySelector("canvas")!;
      const rect = canvas.getBoundingClientRect();
      const k = canvas.width / rect.width;
      const ctx = canvas.getContext("2d")!;
      const { data } = ctx.getImageData(
        Math.round((from.x - rect.left) * k),
        Math.round((from.y - rect.top) * k),
        Math.round(length * k),
        1,
      );
      const close = (i: number, c: readonly number[]) =>
        Math.abs(data[i]! - c[0]!) <= 16 &&
        Math.abs(data[i + 1]! - c[1]!) <= 16 &&
        Math.abs(data[i + 2]! - c[2]!) <= 16;
      let between = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (!close(i, blue) && !close(i, paper)) between += 1;
      }
      return between;
    },
    { from, length, blue: BLUE, paper: PAPER },
  );
}

async function openVectorize(board: Board, image: SceneElement): Promise<void> {
  const { page } = board;
  const middle = await onPage(board, image, PICTURE.width / 2, PICTURE.height / 2);
  expect(
    middle.x - board.box.x > OPEN_CANVAS.left && middle.x - board.box.x < OPEN_CANVAS.right,
    "setup: the picture is on open canvas",
  ).toBe(true);
  await page.mouse.click(middle.x, middle.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Vectorize image…" }).click();
  await expect(page.getByRole("dialog", { name: "Vectorize image" })).toBeVisible();
}

/** Waits for the trace to finish, and returns the stats line it shows. */
async function traced(page: Page): Promise<string> {
  const stats = page.getByRole("dialog").getByRole("status");
  await expect(stats).toHaveText(/shapes · |One picture · /, { timeout: 15_000 });
  return (await stats.textContent()) ?? "";
}

test("an image becomes grouped editable shapes, and one undo gives it back", async ({ page }) => {
  const board = await openBoard(page);
  const image = await insertPicture(board);
  const inDisc = await onPage(board, image, DISC.x, DISC.y);
  await expectColour(page, inDisc, RED, "the picture is painted");
  // Saved first, so there is something on the server for the trace to replace.
  await expect
    .poll(async () => (await patchedElements(page)).some((el) => el.id === image.id))
    .toBe(true);

  await openVectorize(board, image);
  const dialog = page.getByRole("dialog", { name: "Vectorize image" });
  await dialog.getByRole("button", { name: "Poster" }).click();
  expect(await traced(page)).toMatch(/^\d+ shapes · [\d,]+ points$/);
  await expect(dialog.getByRole("radio", { name: "Editable shapes" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Keep the original image" })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog).toBeHidden();

  const after = await sceneElements(page);
  expect(
    after.some((el) => el.type === "image"),
    "the image was replaced",
  ).toBe(false);
  expect(after.length).toBeGreaterThanOrEqual(3);
  expect(new Set(after.map((el) => el.type))).toEqual(new Set(["line"]));
  const group = after[0]!.groupIds?.[0];
  expect(group, "the trace is one group").toBeTruthy();
  expect(after.every((el) => el.groupIds?.[0] === group)).toBe(true);
  const colours = after.map((el) => el.backgroundColor ?? "");
  const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  expect(
    colours.some((hex) => near(rgb(hex), RED, 8)),
    `a region in the disc's red: ${colours.join(" ")}`,
  ).toBe(true);
  expect((await selection(page)).sort()).toEqual(after.map((el) => el.id).sort());
  await expectColour(page, inDisc, RED, "the disc is still red where it was, painted by the trace");
  // And saved: the new shapes and the image's tombstone went to the server.
  await expect
    .poll(async () => {
      const sent = await patchedElements(page);
      return (
        sent.some((el) => el.id === image.id && el.isDeleted) &&
        after.every((el) => sent.some((s) => s.id === el.id))
      );
    })
    .toBe(true);

  await focusBoard(board);
  await page.keyboard.press("Control+z");
  const undone = await sceneElements(page);
  expect(undone.map((el) => el.id)).toEqual([image.id]);
  await expectColour(page, inDisc, RED, "the picture is back");
});

test("an image becomes one SVG picture that stays sharp when zoomed", async ({ page }) => {
  const board = await openBoard(page);
  const image = await insertPicture(board);
  const scale = (await page.evaluate(() => window.__drawEngine!.camera)).scale;

  // The square's right edge, half way down, zoomed eight times about itself.
  const EDGE = { x: SQUARE.x + SQUARE.size, y: SQUARE.y + SQUARE.size / 2 };
  const zoomAtEdge = async (factor: number) => {
    const edge = await onPage(board, image, EDGE.x, EDGE.y);
    await page.evaluate(
      ({ x, y, factor, box }) => window.__drawEngine!.zoomAt(x - box.x, y - box.y, factor),
      { ...edge, factor, box: board.box },
    );
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    return onPage(board, image, EDGE.x, EDGE.y);
  };
  const rasterEdge = await zoomAtEdge(8);
  await expectColour(
    page,
    { x: rasterEdge.x - 20, y: rasterEdge.y },
    BLUE,
    "setup: zoomed in on the square",
  );
  const rasterWidth = await edgeWidth(page, { x: rasterEdge.x - 40, y: rasterEdge.y }, 80);
  await page.evaluate(
    ({ box, scale }) => {
      const engine = window.__drawEngine!;
      engine.zoomAt(box.width / 2, box.height / 2, scale / engine.camera.scale);
    },
    { box: board.box, scale },
  );

  await openVectorize(board, image);
  const dialog = page.getByRole("dialog", { name: "Vectorize image" });
  await dialog.getByRole("radio", { name: "One vector picture" }).check();
  expect(await traced(page)).toMatch(/^One picture · [\d.]+ MB · \d+ regions$/);
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog).toBeHidden();

  const after = await sceneElements(page);
  expect(after).toHaveLength(1);
  const picture = after[0]! as SceneElement & { dataUrl?: string };
  expect(picture.id).not.toBe(image.id);
  expect(picture.type).toBe("image");
  expect(picture.dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(picture[key]).toBeCloseTo(image[key], 6);
  }
  await expectColour(
    page,
    await onPage(board, picture, DISC.x, DISC.y),
    RED,
    "the picture is painted",
  );

  const vectorEdge = await zoomAtEdge(8);
  await expectColour(
    page,
    { x: vectorEdge.x - 20, y: vectorEdge.y },
    BLUE,
    "zoomed in on the square",
  );
  const vectorWidth = await edgeWidth(page, { x: vectorEdge.x - 40, y: vectorEdge.y }, 80);
  expect(rasterWidth, "control: the raster's edge is smeared when enlarged").toBeGreaterThan(4);
  expect(
    vectorWidth,
    `the vector edge: ${vectorWidth}px, the raster's ${rasterWidth}px`,
  ).toBeLessThanOrEqual(3);

  await focusBoard(board);
  await page.keyboard.press("Control+z");
  const undone = await sceneElements(page);
  expect(undone.map((el) => el.id)).toEqual([image.id]);
});
