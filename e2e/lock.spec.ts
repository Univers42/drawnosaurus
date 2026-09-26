import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  camera,
  clickElement,
  focusBoard,
  OPEN_CANVAS,
  openBoard,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * Lock and unlock with groups, through a real browser: the key, the right-click and the
 * two menus. `ci_lock.rs` pins the rules through the engine; this checks each door
 * reaches them — the right-click selected the bare element it landed on, which no engine
 * test could see, because the selection was made by the host before the engine was asked.
 */

/** G1 and G2 grouped, X loose, filled so the middle of each is a hit target. */
async function load(page: Page, locked: string[] = []): Promise<void> {
  const { x, y, scale } = await camera(page);
  const at = { x: (OPEN_CANVAS.left + 60 - x) / scale, y: (OPEN_CANVAS.top + 60 - y) / scale };
  await page.evaluate(
    ({ at, locked }) => {
      const style = {
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
        type: "rectangle",
        y: at.y,
        width: 80,
        height: 80,
      };
      const elements = [
        { id: "G1", x: at.x, groupIds: ["g"] },
        { id: "G2", x: at.x + 120, groupIds: ["g"] },
        { id: "X", x: at.x + 300 },
      ].map((element) => ({ ...style, ...element, locked: locked.includes(element.id) }));
      window.__drawEngine!.loadScene(
        JSON.stringify({ type: "osidraw", version: 1, source: "e2e", elements }),
      );
    },
    { at, locked },
  );
}

const INDEX = { G1: 0, G2: 1, X: 2 } as const;

function click(board: Board, id: keyof typeof INDEX, button: "left" | "right" = "left") {
  return clickElement(board, INDEX[id], { button });
}

async function lockedIds(page: Page): Promise<string[]> {
  return (await sceneElements(page)).filter((element) => element.locked).map(({ id }) => id);
}

async function selected(page: Page): Promise<string[]> {
  return (await selection(page)).sort();
}

test("a locked group lets go, and comes back whole from a right-click", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await load(page);
  await click(board, "G1");
  expect(await selected(page), "setup: the group").toEqual(["G1", "G2"]);

  await page.keyboard.press("Control+Shift+L");
  expect(await lockedIds(page)).toEqual(["G1", "G2"]);
  expect(await selected(page), "locking lets go").toEqual([]);

  await click(board, "G1");
  expect(await selected(page), "a locked group is not picked up").toEqual([]);

  await click(board, "G2", "right");
  expect(await selected(page), "the right-click takes the whole group").toEqual(["G1", "G2"]);
  await page.getByRole("menuitem", { name: /^Unlock/ }).click();

  expect(await lockedIds(page)).toEqual([]);
  expect(await selected(page)).toEqual(["G1", "G2"]);
});

test("a group holding one locked member offers Unlock, and unlocks it all", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await load(page, ["G2"]);

  await click(board, "G1", "right");
  expect(await selected(page)).toEqual(["G1", "G2"]);
  await expect(page.getByRole("menuitem", { name: /^Lock/ })).toHaveCount(0);
  await page.getByRole("menuitem", { name: /^Unlock/ }).click();
  expect(await lockedIds(page)).toEqual([]);

  // And the menu's Lock locks it all again, and lets go of it.
  await click(board, "G1", "right");
  await page.getByRole("menuitem", { name: /^Lock/ }).click();
  expect(await lockedIds(page)).toEqual(["G1", "G2"]);
  expect(await selected(page)).toEqual([]);
});

test("Select all passes a locked shape by, and Unlock all frees it", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await load(page, ["X"]);

  await page.keyboard.press("Control+a");
  expect(await selected(page)).toEqual(["G1", "G2"]);
  await page.keyboard.press("Delete");
  expect((await sceneElements(page)).map(({ id }) => id)).toEqual(["X"]);

  const empty = {
    x: board.box.x + OPEN_CANVAS.right - 40,
    y: board.box.y + OPEN_CANVAS.bottom - 40,
  };
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Unlock all" }).click();

  expect(await lockedIds(page)).toEqual([]);
  expect(await selected(page)).toEqual(["X"]);
});
