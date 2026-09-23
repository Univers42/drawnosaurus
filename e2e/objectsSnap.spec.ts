import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, sceneElements, type Board } from "./board.ts";

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
