import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, pickTool, sceneElements, type Board } from "./board.ts";

/**
 * Snapping to other elements: off unless asked for, as Excalidraw ships it.
 *
 * `ci_objects_snap.rs` pins the rule. These check what only a browser can: that the
 * modifier — Ctrl or Cmd — really reaches the engine from a real key held during a real
 * drag, that `Alt+S` is matched on the physical key, that the menu shows and changes it,
 * and that it survives a reload.
 */

/**
 * Canvas-relative. Two filled boxes on one row. Dragging the right one 137px left leaves
 * it 3px short of the left one's right edge — inside the 6px snap distance, so a snap
 * shows as exactly 3px.
 */
const STILL = { x: 520, y: 260, w: 120, h: 90 };
const MOVING = { x: 780, y: 260, w: 120, h: 90 };
const NUDGE = 137;

/** Scene setup, not behaviour: what is under test is the drag, not how the boxes got there. */
async function twoBoxes(page: Page): Promise<void> {
  await page.evaluate(
    ({ still, moving }) => {
      const engine = window.__drawEngine!;
      const box = (id: string, at: typeof still) => {
        const world = engine.screenToWorld(at.x, at.y);
        const { scale } = engine.camera;
        return {
          id,
          type: "rectangle",
          x: world.x,
          y: world.y,
          width: at.w / scale,
          height: at.h / scale,
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
        };
      };
      engine.loadScene(
        JSON.stringify({
          type: "osidraw",
          version: 1,
          source: "e2e",
          elements: [box("still", still), box("moving", moving)],
        }),
      );
    },
    { still: STILL, moving: MOVING },
  );
}

/** Drags the moving box left by `NUDGE`, optionally holding Control for the whole move. */
async function nudge(board: Board, holdControl = false): Promise<void> {
  const { page, box } = board;
  const from = { x: box.x + MOVING.x + MOVING.w / 2, y: box.y + MOVING.y + MOVING.h / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Pressed after the button, as a person reaches for it mid-drag, and so the press
  // itself is a plain one.
  if (holdControl) await page.keyboard.down("Control");
  await page.mouse.move(from.x - NUDGE, from.y, { steps: 8 });
  await page.mouse.up();
  if (holdControl) await page.keyboard.up("Control");
}

/** How far short of the still box's right edge the moving one ended, in screen pixels. */
async function gap(page: Page): Promise<number> {
  const elements = await sceneElements(page);
  const still = elements.find((el) => el.id === "still")!;
  const moving = elements.find((el) => el.id === "moving")!;
  const { scale } = await page.evaluate(() => window.__drawEngine!.camera);
  return (moving.x - (still.x + still.width)) * scale;
}

function objectsSnap(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__drawEngine!.getObjectsSnap());
}

test("by default a drag lands where it is let go", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);

  await nudge(board);

  expect(await objectsSnap(page)).toBe(false);
  expect(await gap(page)).toBeCloseTo(3, 0);
});

test("holding Control snaps that one drag", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);

  await nudge(board, true);

  expect(await gap(page)).toBeCloseTo(0, 0);
  expect(await objectsSnap(page), "the preference is untouched").toBe(false);
});

test("Alt+S turns it on, and the menu says so", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);
  await focusBoard(board);

  await page.keyboard.press("Alt+KeyS");

  expect(await objectsSnap(page)).toBe(true);
  await nudge(board);
  expect(await gap(page)).toBeCloseTo(0, 0);

  await page.getByRole("button", { name: "Open main menu" }).click();
  await expect(page.getByRole("switch", { name: "Snap to objects" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("the menu switch turns it off again", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await page.keyboard.press("Alt+KeyS");
  await page.getByRole("button", { name: "Open main menu" }).click();

  await page.getByRole("switch", { name: "Snap to objects" }).click();

  expect(await objectsSnap(page)).toBe(false);
});

test("it is remembered across a reload", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await page.keyboard.press("Alt+KeyS");

  // The API stubs and the socket route belong to the page, so they survive the reload.
  await page.reload();
  await page.waitForFunction(() => window.__drawEngine !== undefined);
  await page.waitForLoadState("networkidle");

  expect(await objectsSnap(page)).toBe(true);
});

/**
 * Alt+S is matched on the physical key, as Excalidraw's is: on a Mac, Option+S types
 * "ß", and a shortcut matched on the character would never fire there.
 *
 * Sent through CDP because that is the only way to deliver a key whose character and
 * physical key disagree; Playwright's keyboard derives one from the other.
 */
test("Alt+S works where the key types something else", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  const cdp = await page.context().newCDPSession(page);
  const key = { key: "ß", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 1 };

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });

  await expect.poll(() => objectsSnap(page)).toBe(true);
});

test("with it on, holding Control lets a drag land freely", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);
  await focusBoard(board);
  await page.keyboard.press("Alt+KeyS");

  await nudge(board, true);

  expect(await gap(page)).toBeCloseTo(3, 0);
});

test("Cmd works as Ctrl does, for the Mac", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);
  const { box } = board;
  const from = { x: box.x + MOVING.x + MOVING.w / 2, y: box.y + MOVING.y + MOVING.h / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down("Meta");
  await page.mouse.move(from.x - NUDGE, from.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Meta");

  expect(await gap(page)).toBeCloseTo(0, 0);
});

test("turning it on hides the grid, and showing the grid turns it off", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  const gridShown = () => page.evaluate(() => window.__drawEngine!.getGrid().enabled);

  await page.keyboard.press("Control+Quote");
  expect(await gridShown(), "setup: the grid is on").toBe(true);

  await page.keyboard.press("Alt+KeyS");
  expect(await objectsSnap(page)).toBe(true);
  expect(await gridShown()).toBe(false);

  await page.keyboard.press("Control+Quote");
  expect(await gridShown()).toBe(true);
  expect(await objectsSnap(page)).toBe(false);
});

/**
 * 6.3: the gate is not move-only. Drawing and resizing snap to objects too, and the engine
 * tests carry the arithmetic (`ci_draw_object_snap.rs`, `ci_resize_object_snap.rs`). What
 * only a browser can say is that the reach survives the whole host path: the canvas
 * offset, the camera, `Alt+S` and a real mouse.
 *
 * Each pair below is **the same gesture with the same pointer**, one inside the 6px reach
 * and one past it, because a test that only asserts "a snap happened" is passed by a
 * snapper that snaps always.
 */

/** Where a shape is drawn from, canvas-relative. The still box's right edge is at 640. */
const DRAW_FROM = { x: 700, y: 420 };

/** Drags a rectangle out to `cornerX`, with objects snapped on. */
async function drawTo(board: Board, cornerX: number): Promise<void> {
  const { page, box } = board;
  await focusBoard(board);
  await page.keyboard.press("Alt+KeyS");
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + DRAW_FROM.x, box.y + DRAW_FROM.y);
  await page.mouse.down();
  await page.mouse.move(box.x + cornerX, box.y + 480, { steps: 8 });
  await page.mouse.up();
}

/** How far short of the still box's right edge the drawn one ended, in screen pixels. */
async function drawnGap(page: Page): Promise<number> {
  const elements = await sceneElements(page);
  const still = elements.find((el) => el.id === "still")!;
  // The one that is neither fixture: `moving` is a rectangle too, and it comes first.
  const drawn = elements.find((el) => el.id !== "still" && el.id !== "moving")!;
  const { scale } = await page.evaluate(() => window.__drawEngine!.camera);
  return (drawn.x - (still.x + still.width)) * scale;
}

test("a shape drawn within the reach lands on the edge beside it", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);

  // 3px short of the still box's right edge at 640.
  await drawTo(board, 637);

  expect(await objectsSnap(page)).toBe(true);
  expect(await drawnGap(page)).toBeCloseTo(0, 0);
});

test("the same shape drawn past the reach lands where it was let go", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);

  // 7px short, a pixel past the reach, and the same gesture otherwise.
  await drawTo(board, 633);

  expect(await drawnGap(page)).toBeCloseTo(-7, 0);
});

/** Drags the moving box's east handle to `toX`, canvas-relative. */
async function dragEastTo(board: Board, toX: number): Promise<void> {
  const { page, box } = board;
  await focusBoard(board);
  await page.keyboard.press("Alt+KeyS");
  const from = { x: box.x + MOVING.x + MOVING.w, y: box.y + MOVING.y + MOVING.h / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + toX, from.y, { steps: 8 });
  await page.mouse.up();
}

test("an edge dragged within the reach lands on the edge beside it", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);

  // 3px short of the still box's left edge at 520.
  await dragEastTo(board, 523);

  const elements = await sceneElements(page);
  const moving = elements.find((el) => el.id === "moving")!;
  // The dragged edge lands on 520, and the height is untouched: the reach is on the edge
  // the handle holds, not on the box.
  expect(moving.x + moving.width).toBeCloseTo(520, 0);
  expect(moving.height).toBeCloseTo(MOVING.h, 0);
});

test("the same edge dragged past the reach lands where it was let go", async ({ page }) => {
  const board = await openBoard(page);
  await twoBoxes(page);

  await dragEastTo(board, 513);

  const elements = await sceneElements(page);
  const moving = elements.find((el) => el.id === "moving")!;
  expect(moving.x + moving.width).toBeCloseTo(513, 0);
});
