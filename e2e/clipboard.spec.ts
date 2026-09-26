import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  focusBoard,
  openBoard,
  OPEN_CANVAS,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * Ctrl+V, through a real browser, a real OS clipboard and a real keyboard.
 *
 * The oracle centres a pasted selection's bounding box on the pointer
 * (`addElementsFromPasteOrLibrary` → `duplicateAtSceneCoords`,
 * `App.duplicate.ts@1118751f:79-99`), not on a fixed offset from where it was copied —
 * that is what Ctrl+D does (`actionDuplicateSelection.tsx@1118751f:74-82`), and the two
 * must stay distinct. `engine/crates/draw-engine/tests/ci_paste.rs` already pins the
 * placement arithmetic; this file is only about whether the browser's paste event ever
 * reaches it with the pointer's position at all — it used to not: the host's own paste
 * listener (`engine/src/host/keyboardInput.ts`) called `pasteJson` with no position,
 * which falls back to the engine's fixed Ctrl+D-style offset regardless of the cursor.
 */

async function drawRectangle(
  page: Page,
  board: Board,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.getByRole("button", { name: /^Rectangle \(/ }).click();
  await page.mouse.move(board.box.x + from.x, board.box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(board.box.x + to.x, board.box.y + to.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await sceneElements(page)).length, { timeout: 2_000 })
    .toBeGreaterThan(0);
}

test.describe("clipboard", () => {
  test("Ctrl+V centres the pasted copy on the pointer, not on a fixed offset", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const board = await openBoard(page);

    await drawRectangle(page, board, { x: 500, y: 220 }, { x: 580, y: 300 });
    await focusBoard(board);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");

    // Far from the source shape, well inside the open canvas — the point the bug pasted
    // nowhere near.
    const target = { x: 950, y: 550 };
    await page.mouse.move(board.box.x + target.x, board.box.y + target.y);
    const expectedWorld = await page.evaluate(
      (at) => window.__drawEngine!.screenToWorld(at.x, at.y),
      target,
    );

    await page.keyboard.press("Control+v");

    await expect.poll(async () => (await sceneElements(page)).length).toBe(2);
    const selected = await selection(page);
    expect(selected).toHaveLength(1);
    const elements = await sceneElements(page);
    const pasted = elements.find((element) => element.id === selected[0]);
    if (!pasted) throw new Error("the pasted element is not in the scene");

    const centre = { x: pasted.x + pasted.width / 2, y: pasted.y + pasted.height / 2 };
    expect(
      Math.hypot(centre.x - expectedWorld.x, centre.y - expectedWorld.y),
      `centred on the pointer (${expectedWorld.x}, ${expectedWorld.y}), not offset from the source — got (${centre.x}, ${centre.y})`,
    ).toBeLessThan(2);

    // Pasting again at a second point lands in a second place — the bug pasted at the
    // same fixed spot regardless of where the pointer was.
    const second = { x: OPEN_CANVAS.left + 40, y: OPEN_CANVAS.top + 40 };
    await page.mouse.move(board.box.x + second.x, board.box.y + second.y);
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await sceneElements(page)).length).toBe(3);
    const thirdSelection = await selection(page);
    const secondPaste = (await sceneElements(page)).find((e) => e.id === thirdSelection[0]);
    if (!secondPaste) throw new Error("the second pasted element is not in the scene");
    expect(
      Math.hypot(secondPaste.x - pasted.x, secondPaste.y - pasted.y),
      "two pastes at two different points must not land in the same place",
    ).toBeGreaterThan(50);
  });

  // Closes a standing gap in `packages/conformance/src/registry.ts`: copySelection and
  // cutSelection were wired to Ctrl+C/Ctrl+X (`engine/src/host/keys.ts`) but nothing ever
  // dispatched either key in a real browser to prove the round trip through the actual
  // clipboard — only this file's own paste test above exercised Ctrl+V for real.
  test("Ctrl+C leaves the source in place; Ctrl+X removes it but the clipboard keeps it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const board = await openBoard(page);
    await drawRectangle(page, board, { x: 500, y: 220 }, { x: 580, y: 300 });
    await focusBoard(board);
    await page.keyboard.press("Control+a");

    await page.keyboard.press("Control+c");
    expect(await sceneElements(page)).toHaveLength(1);

    await page.keyboard.press("Control+x");
    await expect.poll(async () => (await sceneElements(page)).length).toBe(0);

    await page.mouse.move(board.box.x + 700, board.box.y + 400);
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await sceneElements(page)).length).toBe(1);
  });

  test("Ctrl+D still offsets from the source, unaffected by the pointer", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board, { x: 500, y: 220 }, { x: 580, y: 300 });
    await focusBoard(board);
    await page.keyboard.press("Control+a");
    const [source] = await sceneElements(page);
    if (!source) throw new Error("the drawn rectangle is not in the scene");

    // Moving the pointer somewhere else first: Ctrl+D must ignore it, unlike Ctrl+V above.
    await page.mouse.move(board.box.x + 950, board.box.y + 550);
    await page.keyboard.press("Control+d");

    await expect.poll(async () => (await sceneElements(page)).length).toBe(2);
    const selected = await selection(page);
    const copy = (await sceneElements(page)).find((e) => e.id === selected[0]);
    if (!copy) throw new Error("the duplicate is not in the scene");
    // The engine's own fixed offset (`edit_api.rs`'s `duplicateSelection`): 10 world units
    // on each axis, matching the oracle's `DEFAULT_GRID_SIZE / 2`.
    expect(copy.x - source.x).toBeCloseTo(10, 0);
    expect(copy.y - source.y).toBeCloseTo(10, 0);
  });
});
