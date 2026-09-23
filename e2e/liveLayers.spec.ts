import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { openBoard, type Board } from "./board.ts";

/**
 * Painting during a gesture, checked in pixels.
 *
 * While something is dragged or drawn, the painter caches everything else — what is below
 * the moving element in one picture, what is above it in another — and draws only the
 * moving element between them each frame. That is what makes a drag cost what it touches
 * rather than the whole board, and it is exactly the kind of speed-up that goes wrong
 * silently: a shape frozen at its old place, a stacking order that flips mid-drag.
 *
 * So the frames are compared with the ones a full redraw produces, exactly.
 */

async function pixels(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector("canvas")!.toDataURL());
}

/** Canvas-relative colour at a point. */
async function colourAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector("canvas")!;
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const d = canvas
        .getContext("2d")!
        .getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    { x, y },
  );
}

const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

/**
 * Three filled boxes, canvas-relative: red at the bottom, blue over its right half, and a
 * green one off to the side that nothing touches.
 */
async function threeBoxes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const engine = window.__drawEngine!;
    const { scale } = engine.camera;
    const box = (id: string, x: number, y: number, colour: string) => ({
      id,
      type: "rectangle",
      ...engine.screenToWorld(x, y),
      width: 200 / scale,
      height: 150 / scale,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: colour,
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
    });
    const elements = [
      box("red", 560, 260, "#ff0000"),
      box("blue", 680, 300, "#0000ff"),
      box("green", 950, 420, "#00ff00"),
    ];
    engine.loadScene(JSON.stringify({ type: "osidraw", version: 1, source: "e2e", elements }));
  });
}

async function grabRed(board: Board): Promise<{ x: number; y: number }> {
  const { page, box } = board;
  const at = { x: box.x + 600, y: box.y + 300 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 20, at.y + 20, { steps: 4 });
  return at;
}

test("mid-drag, a shape above the dragged one still covers it", async ({ page }) => {
  const board = await openBoard(page);
  await threeBoxes(page);

  await grabRed(board);
  await frame(page);

  // Where the two overlap: blue, because blue is above red.
  expect(await colourAt(page, 740, 360)).toEqual([0, 0, 255]);
  await page.mouse.up();
});

test("a frame drawn mid-drag is the frame a full redraw draws", async ({ page }) => {
  // Mid-drag the picture is composed from cached layers; released, the same scene is
  // drawn from scratch. Nothing moves in between, so the two must be identical.
  const board = await openBoard(page);
  await threeBoxes(page);

  await grabRed(board);
  await frame(page);
  const composed = await pixels(page);

  await page.mouse.up();
  await frame(page);
  const redrawn = await pixels(page);

  expect(composed === redrawn, "the composed frame differs from a full redraw").toBe(true);
});

test("a peer's edit mid-drag shows at once, not when the drag ends", async ({ page }) => {
  // The cached picture of everything else has to be thrown out when something in it
  // changes — here, a peer moving the green box while this user drags the red one.
  const board = await openBoard(page);
  await threeBoxes(page);
  await grabRed(board);
  await frame(page);
  expect(await colourAt(page, 1050, 500), "setup: green is here").toEqual([0, 255, 0]);

  await page.evaluate(() => {
    const engine = window.__drawEngine!;
    const green = JSON.parse(engine.exportJson()).elements.find(
      (e: { id: string }) => e.id === "green",
    );
    engine.applyRemotePatch(
      JSON.stringify({
        type: "osidraw",
        version: 1,
        elements: [{ ...green, y: green.y + 1000, version: 2, versionNonce: 5 }],
      }),
    );
  });
  await frame(page);

  const moved = await colourAt(page, 1050, 500);
  expect(moved, "green has gone from its old place").not.toEqual([0, 255, 0]);
  await page.mouse.up();
});
