import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  focusBoard,
  openBoard,
  pickTool,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * Nested groups, through a real browser.
 *
 * `ci_groups_nested.rs` pins the rules. This checks that a real double click and a real
 * Ctrl+G reach them, which the engine tests structurally cannot: they call
 * `handle_double_click` and `toggle_group_selection` directly, so a keymap that never
 * routed Ctrl+G to the toggle, or a double click swallowed by the text branch before it
 * got to the group branch, would pass every one of them and leave the feature dead.
 *
 * That second case is not hypothetical — it is exactly what was wrong: the double-click
 * handler tried text, then linear points, then a label, and never looked for a group.
 */

const BOX = { w: 110, h: 90 };
const ROW_Y = OPEN_CANVAS.top + 90;
const FIRST_X = OPEN_CANVAS.left + 60;
const GAP = 170;

function at(board: Board, x: number, y: number): { x: number; y: number } {
  return { x: board.box.x + x, y: board.box.y + y };
}

/** Canvas-relative middle of the nth box. Filled, so the middle is a hit target. */
function middle(index: number): { x: number; y: number } {
  return { x: FIRST_X + GAP * index + BOX.w / 2, y: ROW_Y + BOX.h / 2 };
}

async function drawFilledBoxes(board: Board, count: number): Promise<void> {
  const { page } = board;
  for (let i = 0; i < count; i += 1) {
    await pickTool(page, "Rectangle");
    // A background makes the whole interior a hit target. A transparent shape is hit on
    // its outline only — correct, tested elsewhere, and it would make every case here
    // about the fill rule instead of about groups.
    await page.getByRole("button", { name: "#ffc9c9", exact: true }).click();
    const from = at(board, FIRST_X + GAP * i, ROW_Y);
    const to = at(board, FIRST_X + GAP * i + BOX.w, ROW_Y + BOX.h);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  }
  await pickTool(board.page, "Select");
}

async function clickBox(board: Board, index: number, shift = false): Promise<void> {
  const target = at(board, middle(index).x, middle(index).y);
  // Shift held explicitly. `page.mouse.click` takes no `modifiers` option — that belongs
  // to `locator.click` — and passing one is silently ignored, so the shift-click becomes
  // a plain click and the selection never grows past one.
  if (shift) await board.page.keyboard.down("Shift");
  await board.page.mouse.click(target.x, target.y);
  if (shift) await board.page.keyboard.up("Shift");
  await board.page.waitForTimeout(100);
}

async function doubleClickBox(board: Board, index: number): Promise<void> {
  const target = at(board, middle(index).x, middle(index).y);
  await board.page.mouse.dblclick(target.x, target.y);
  await board.page.waitForTimeout(140);
}

async function groupIdsOf(board: Board, index: number): Promise<string[]> {
  const elements = await sceneElements(board.page);
  return elements[index]?.groupIds ?? [];
}

/** Boxes 0+1 grouped, then all three grouped — the scene observed on excalidraw.com. */
async function buildNested(board: Board): Promise<void> {
  await drawFilledBoxes(board, 3);
  await focusBoard(board);

  await clickBox(board, 0);
  await clickBox(board, 1, true);
  await board.page.keyboard.press("Control+g");
  await board.page.waitForTimeout(140);

  await clickBox(board, 0);
  await clickBox(board, 2, true);
  await board.page.keyboard.press("Control+g");
  await board.page.waitForTimeout(140);
}

test.describe("nested groups", () => {
  test("grouping a group keeps the inner one", async ({ page }) => {
    const board = await openBoard(page);
    await buildNested(board);

    expect(await groupIdsOf(board, 0), "inner then outer").toHaveLength(2);
    expect(await groupIdsOf(board, 1)).toHaveLength(2);
    const outer = await groupIdsOf(board, 2);
    expect(outer, "the third box only ever joined the outer group").toHaveLength(1);
    expect((await groupIdsOf(board, 0))[1], "and it is the outer one").toBe(outer[0]);
  });

  test("a click takes the whole outermost group", async ({ page }) => {
    const board = await openBoard(page);
    await buildNested(board);
    await page.mouse.click(
      board.box.x + OPEN_CANVAS.right - 30,
      board.box.y + OPEN_CANVAS.bottom - 30,
    );

    await clickBox(board, 0);

    expect(await selection(page)).toHaveLength(3);
  });

  /**
   * The gesture that was reported broken. It has to reach the group branch, which sits
   * ahead of the text branch that used to swallow it.
   */
  test("a double click steps in one level, and again to the element", async ({ page }) => {
    const board = await openBoard(page);
    await buildNested(board);
    await clickBox(board, 0);
    expect(await selection(page)).toHaveLength(3);

    await doubleClickBox(board, 0);
    expect(await selection(page), "inside the outer group: the inner group").toHaveLength(2);

    await doubleClickBox(board, 0);
    expect(await selection(page), "inside the inner group: the element").toHaveLength(1);
  });

  test("Escape steps back out", async ({ page }) => {
    const board = await openBoard(page);
    await buildNested(board);
    await clickBox(board, 0);
    await doubleClickBox(board, 0);
    expect(await selection(page)).toHaveLength(2);

    await focusBoard(board);
    await clickBox(board, 0);
    await doubleClickBox(board, 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(140);
    await clickBox(board, 0);

    expect(await selection(page), "back at the top level, a click takes the lot").toHaveLength(3);
  });

  /**
   * A double click that lands on nothing must still make text, or entering groups would
   * have cost the most common gesture on the board.
   */
  test("a double click on empty canvas still starts text", async ({ page }) => {
    const board = await openBoard(page);
    await drawFilledBoxes(board, 1);

    const empty = at(board, OPEN_CANVAS.right - 120, OPEN_CANVAS.bottom - 120);
    await page.mouse.dblclick(empty.x, empty.y);
    await page.waitForTimeout(200);

    const kinds = (await sceneElements(page)).map((el) => el.type);
    expect(kinds, `expected a text element among ${kinds.join(", ")}`).toContain("text");
  });
});

test.describe("Ctrl+G", () => {
  test("groups, then ungroups on a second press", async ({ page }) => {
    const board = await openBoard(page);
    await drawFilledBoxes(board, 2);
    await focusBoard(board);

    await clickBox(board, 0);
    await clickBox(board, 1, true);
    await page.keyboard.press("Control+g");
    await page.waitForTimeout(140);
    expect(await groupIdsOf(board, 0), "first press groups").toHaveLength(1);

    await page.keyboard.press("Control+g");
    await page.waitForTimeout(140);
    expect(await groupIdsOf(board, 0), "second press undoes it").toHaveLength(0);
  });

  test("peels one level from a nested group", async ({ page }) => {
    const board = await openBoard(page);
    await buildNested(board);
    await clickBox(board, 0);
    expect(await selection(page)).toHaveLength(3);

    await page.keyboard.press("Control+g");
    await page.waitForTimeout(160);

    expect(await groupIdsOf(board, 0), "the inner group survives").toHaveLength(1);
    expect(await groupIdsOf(board, 2)).toHaveLength(0);
  });
});

/**
 * Align and distribute move groups as blocks (`ci_align_units.rs`). What this adds is the
 * inspector: it asks the engine what would move rather than counting elements, so three
 * elements that are a group and a shape offer align and not distribute.
 */
test.describe("align and distribute", () => {
  test("count a group as one", async ({ page }) => {
    const board = await openBoard(page);
    await drawFilledBoxes(board, 3);
    await focusBoard(board);
    await clickBox(board, 0);
    await clickBox(board, 1, true);
    await page.keyboard.press("Control+g");
    await page.waitForTimeout(140);

    await clickBox(board, 0);
    await clickBox(board, 2, true);
    expect(await selection(page), "the group and the third box").toHaveLength(3);

    const distribute = page.getByRole("button", { name: "Distribute horizontally" });
    await expect(distribute, "two blocks have nothing between them to space").toHaveCount(0);

    const [first, second] = await sceneElements(page);
    await page.getByRole("button", { name: "Align left" }).click();
    await page.waitForTimeout(140);

    // The group's left edge is the selection's, so the group stays and the box comes to it.
    const [a, b, c] = await sceneElements(page);
    expect(a!.x, "the group is one block").toBeCloseTo(first!.x, 1);
    expect(b!.x, "so its second box keeps its place").toBeCloseTo(second!.x, 1);
    expect(c!.x, "the lone box meets the group's left edge").toBeCloseTo(a!.x, 1);
  });
});
