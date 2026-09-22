import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, sceneElements, type Board } from "./board.ts";

/**
 * Picking a shape up from the middle of it.
 *
 * `ci_grab_selected.rs` pins the rule; this checks that a real drag in a real browser
 * reaches it. The two halves are not redundant here: the engine test drives
 * `begin_pointer`/`move_pointer` directly, while this one goes through the canvas
 * listeners, the pointer-capture and the WASM boundary, and a fix that never reached the
 * host would pass the first and fail this.
 *
 * A shape with no fill is hit on its outline only, so the middle of one is a hole. That
 * is deliberate — an empty rectangle over a diagram must not swallow every click in the
 * area it covers — but it was applied to the *selected* shape too, where it meant an
 * empty rectangle could only be moved by aiming at its outline.
 */

/** Canvas-relative, clear of every floating panel. */
const RECT = {
  left: OPEN_CANVAS.left + 80,
  top: OPEN_CANVAS.top + 90,
  right: OPEN_CANVAS.left + 460,
  bottom: OPEN_CANVAS.top + 330,
};

const MIDDLE = {
  x: (RECT.left + RECT.right) / 2,
  y: (RECT.top + RECT.bottom) / 2,
};

function at(board: Board, x: number, y: number): { x: number; y: number } {
  return { x: board.box.x + x, y: board.box.y + y };
}

/** Draws a transparent rectangle and leaves nothing selected. */
async function drawEmptyRect(board: Board): Promise<void> {
  const { page } = board;
  await pickTool(page, "Rectangle");
  const from = at(board, RECT.left, RECT.top);
  const to = at(board, RECT.right, RECT.bottom);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  // Drawing leaves the new shape selected, which is the state half these tests must
  // *not* start in.
  await pickTool(page, "Select");
  await page.mouse.click(
    board.box.x + OPEN_CANVAS.right - 30,
    board.box.y + OPEN_CANVAS.bottom - 30,
  );
  await page.waitForTimeout(120);
}

async function dragFrom(
  board: Board,
  from: { x: number; y: number },
  by: { x: number; y: number },
): Promise<void> {
  const start = at(board, from.x, from.y);
  await board.page.mouse.move(start.x, start.y);
  await board.page.mouse.down();
  // In steps, so the engine sees a drag rather than a teleport.
  for (let i = 1; i <= 5; i += 1) {
    await board.page.mouse.move(start.x + (by.x * i) / 5, start.y + (by.y * i) / 5);
  }
  await board.page.mouse.up();
  await board.page.waitForTimeout(120);
}

async function rect(board: Board) {
  const found = (await sceneElements(board.page)).find((el) => el.type === "rectangle");
  expect(found, "the rectangle should still be on the board").toBeTruthy();
  return found!;
}

/** Selects it the only way an unselected empty shape can be: by its outline. */
async function selectByOutline(board: Board): Promise<void> {
  await pickTool(board.page, "Select");
  const onTheEdge = at(board, MIDDLE.x, RECT.top);
  await board.page.mouse.click(onTheEdge.x, onTheEdge.y);
  await board.page.waitForTimeout(120);
  expect(
    await board.page.evaluate(() => window.__drawEngine!.getSelection().length),
    "clicking the outline should have selected it",
  ).toBe(1);
}

test.describe("an empty shape nobody has selected", () => {
  test("ignores a drag through its middle", async ({ page }) => {
    const board = await openBoard(page);
    await drawEmptyRect(board);
    const before = await rect(board);

    await dragFrom(board, MIDDLE, { x: 60, y: 40 });

    const after = await rect(board);
    expect(after.x, "the hole in an unselected shape must stay a hole").toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    expect(await page.evaluate(() => window.__drawEngine!.getSelection())).toEqual([]);
  });
});

test.describe("an empty shape that is selected", () => {
  test("can be dragged from its middle", async ({ page }) => {
    const board = await openBoard(page);
    await drawEmptyRect(board);
    const before = await rect(board);
    await selectByOutline(board);

    await dragFrom(board, MIDDLE, { x: 60, y: 40 });

    const after = await rect(board);
    expect(after.x - before.x, "it should have moved with the pointer").toBeCloseTo(60, 0);
    expect(after.y - before.y).toBeCloseTo(40, 0);
  });

  test("keeps the selection when the middle is merely clicked", async ({ page }) => {
    const board = await openBoard(page);
    await drawEmptyRect(board);
    await selectByOutline(board);
    const before = await rect(board);

    const middle = at(board, MIDDLE.x, MIDDLE.y);
    await page.mouse.click(middle.x, middle.y);
    await page.waitForTimeout(150);

    expect(
      await page.evaluate(() => window.__drawEngine!.getSelection().length),
      "a click inside the selection must not drop it",
    ).toBe(1);
    const after = await rect(board);
    expect(after.x).toBeCloseTo(before.x, 1);
  });

  /**
   * The other half of the rule. If the whole selection box became a drag target with no
   * way out, clicking the canvas could never deselect — so this is what keeps the fix
   * from being a trap.
   */
  test("still lets go when the click lands outside it", async ({ page }) => {
    const board = await openBoard(page);
    await drawEmptyRect(board);
    await selectByOutline(board);

    const away = at(board, OPEN_CANVAS.right - 40, OPEN_CANVAS.bottom - 40);
    await page.mouse.click(away.x, away.y);
    await page.waitForTimeout(150);

    expect(await page.evaluate(() => window.__drawEngine!.getSelection())).toEqual([]);
  });
});

test.describe("a shape with a background", () => {
  /**
   * The control, and the case that already worked. A fill makes the shape solid, so the
   * middle of it is the shape whether or not anything is selected — this must keep
   * behaving the way it did.
   */
  test("is grabbed from inside without being selected first", async ({ page }) => {
    const board = await openBoard(page);
    await pickTool(page, "Rectangle");
    // A background, chosen before drawing, so the shape is solid from the start. The
    // swatch's accessible name is the colour itself; this one appears only in the
    // background row, so it needs no further scoping.
    await page.getByRole("button", { name: "#ffc9c9", exact: true }).click();
    const from = at(board, RECT.left, RECT.top);
    const to = at(board, RECT.right, RECT.bottom);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    await pickTool(page, "Select");
    await page.mouse.click(
      board.box.x + OPEN_CANVAS.right - 30,
      board.box.y + OPEN_CANVAS.bottom - 30,
    );
    await page.waitForTimeout(120);

    const before = await rect(board);
    await dragFrom(board, MIDDLE, { x: 50, y: 30 });
    const after = await rect(board);

    expect(after.x - before.x).toBeCloseTo(50, 0);
  });
});
