import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, pickTool, sceneElements, type Board } from "./board.ts";

/**
 * The eraser, through a real browser — where the bug was visible and the engine's own
 * tests could not see it.
 *
 * The engine coalesces nothing; the *host* does. `pointerInput.ts` collapses pointer
 * moves to one per animation frame, so a sweep that felt continuous to the hand reaches
 * the engine as a handful of samples tens of pixels apart. An eraser that tested those
 * samples stepped over everything between them, which is what "it jumps through elements
 * and you have to pass again and again" describes. Only a test that moves a real mouse at
 * a real speed produces that gap.
 */

/** Draws `count` rectangles in a row. The tool reverts after each, so it is re-picked. */
async function drawRow(page: Page, board: Board, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await pickTool(page, "Rectangle");
    const x = 460 + i * 110;
    await page.mouse.move(board.box.x + x, board.box.y + 300);
    await page.mouse.down();
    await page.mouse.move(board.box.x + x + 70, board.box.y + 380, { steps: 4 });
    await page.mouse.up();
  }
}

test.describe("eraser", () => {
  test("one fast sweep clears the row it crosses", async ({ page }) => {
    // Six shapes, one drag, two mouse samples. The host has a frame between them, so the
    // engine sees a jump of six hundred pixels — every shape in the row is inside it.
    const board = await openBoard(page);
    await drawRow(page, board, 6);
    expect(await sceneElements(page)).toHaveLength(6);

    await pickTool(page, "Eraser");
    await page.mouse.move(board.box.x + 440, board.box.y + 340);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1150, board.box.y + 340);
    await page.mouse.up();

    expect(
      await sceneElements(page),
      "a single sweep left shapes behind — it stepped between samples",
    ).toHaveLength(0);
  });

  test("one pass clears a run of duplicates", async ({ page }) => {
    // The reported case: hold Ctrl+D, then try to erase what it made. An eraser that takes
    // the topmost element and stops needs one pass per copy, and each pass looks like it
    // did nothing.
    //
    // Ctrl+D offsets each copy by +12,+12, so the copies are a diagonal staircase rather
    // than a single pile — and the stroke below is the diagonal through their corners, so
    // it crosses every one of their outlines. (A transparent shape is erased by its
    // outline, the same rule that governs selecting one.)
    const board = await openBoard(page);
    const origin = { x: 600, y: 280 };
    const step = 12;
    const copies = 10;

    await pickTool(page, "Rectangle");
    await page.mouse.move(board.box.x + origin.x, board.box.y + origin.y);
    await page.mouse.down();
    await page.mouse.move(board.box.x + origin.x + 200, board.box.y + origin.y + 140, {
      steps: 4,
    });
    await page.mouse.up();
    await focusBoard(board);

    await pickTool(page, "Select");
    await page.mouse.click(board.box.x + origin.x + 100, board.box.y + origin.y);
    for (let i = 0; i < copies; i += 1) {
      await page.keyboard.press("Control+d");
    }
    expect(await sceneElements(page)).toHaveLength(copies + 1);

    await pickTool(page, "Eraser");
    // Starts before the first corner and ends past the last, on the line every corner
    // sits on: corner i is at (origin + i·step, origin + i·step).
    await page.mouse.move(board.box.x + origin.x - 10, board.box.y + origin.y - 10);
    await page.mouse.down();
    await page.mouse.move(
      board.box.x + origin.x + copies * step + 10,
      board.box.y + origin.y + copies * step + 10,
    );
    await page.mouse.up();

    expect(await sceneElements(page), "one pass left copies behind").toHaveLength(0);
  });

  test("the sweep is one undo, not one per shape", async ({ page }) => {
    // Erasing six shapes and pressing undo six times to get them back is not undo.
    const board = await openBoard(page);
    await drawRow(page, board, 4);

    await pickTool(page, "Eraser");
    await page.mouse.move(board.box.x + 440, board.box.y + 340);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1000, board.box.y + 340);
    await page.mouse.up();
    expect(await sceneElements(page)).toHaveLength(0);

    await focusBoard(board);
    await page.keyboard.press("Control+z");

    expect(await sceneElements(page)).toHaveLength(4);
  });

  test("the eraser leaves what the sweep missed", async ({ page }) => {
    // So "erase everything" cannot be how the tests above pass.
    const board = await openBoard(page);
    await drawRow(page, board, 3);

    await pickTool(page, "Eraser");
    // Well below the row.
    await page.mouse.move(board.box.x + 440, board.box.y + 600);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1150, board.box.y + 600);
    await page.mouse.up();

    expect(await sceneElements(page)).toHaveLength(3);
  });
});

test.describe("duplicating stays fast", () => {
  test("a long run of Ctrl+D produces every copy", async ({ page }) => {
    // The correctness half of the performance work: whatever the duplicate path does to
    // stay quick, it still has to produce exactly one copy per press. This is also the
    // shape of board the eraser test above relies on.
    const board = await openBoard(page);
    await pickTool(page, "Rectangle");
    await page.mouse.move(board.box.x + 600, board.box.y + 280);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 700, board.box.y + 360, { steps: 4 });
    await page.mouse.up();
    await focusBoard(board);
    await pickTool(page, "Select");
    await page.mouse.click(board.box.x + 650, board.box.y + 280);
    expect(await sceneElements(page)).toHaveLength(1);

    const start = Date.now();
    for (let i = 0; i < 100; i += 1) {
      await page.keyboard.press("Control+d");
    }
    const elapsed = Date.now() - start;

    expect(await sceneElements(page)).toHaveLength(101);
    // Generous, because most of this is Playwright's own key dispatch rather than the
    // engine — the engine's side is measured properly in `benches/editing.rs`. It is here
    // to catch the shape of the old bug: a per-press cost proportional to the board makes
    // a run of them quadratic, and that shows up at any threshold.
    expect(elapsed, `100 duplicates took ${elapsed}ms`).toBeLessThan(15_000);
  });
});
