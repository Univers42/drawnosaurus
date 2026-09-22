import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  clickElement,
  inkCentroidX,
  openBoard,
  pickTool,
  sceneElements,
  type Board,
} from "./board.ts";

/**
 * Text alignment, end to end: the control in the panel, the field on the element, and
 * the pixels on the canvas.
 *
 * The engine's `ci_text_align.rs` pins the arithmetic — `text_anchor_x` for the anchor
 * and `label_offset_y` for the label's position — but it cannot see whether the painter
 * calls either of them. Both used to be constants inlined in `wasm/paint.rs` and
 * `layout_label`, so a version of this change that added the fields and forgot the
 * painter would pass every Rust test and align nothing at all. This file is the half
 * that looks at the screen.
 *
 * Alignment is measured on a **bound label**, not on free text, and that is not
 * incidental: `set_element_text` sizes a free text element to its own glyphs, so its box
 * is exactly as wide as its content and all three alignments draw in the same place. A
 * label inherits the width of the shape holding it, which is the only case where the
 * three have room to differ.
 */

/** Canvas-relative, well inside `OPEN_CANVAS` so no floating panel covers it. */
const SHAPE = {
  left: OPEN_CANVAS.left + 60,
  top: OPEN_CANVAS.top + 80,
  right: OPEN_CANVAS.left + 560,
  bottom: OPEN_CANVAS.top + 380,
};

/**
 * The interior, inset past the outline.
 *
 * The rectangle's own stroke is ink too, and it is symmetric — including it would dilute
 * the centroid toward 0.5 and shrink the very difference this file exists to measure. 14
 * pixels clears a 2px stroke drawn roughly, plus its roundness.
 */
const INSIDE = {
  left: SHAPE.left + 14,
  top: SHAPE.top + 14,
  right: SHAPE.right - 14,
  bottom: SHAPE.bottom - 14,
};

async function at(board: Board, x: number, y: number): Promise<{ x: number; y: number }> {
  return { x: board.box.x + x, y: board.box.y + y };
}

/** A wide rectangle with a short label in it — short, so alignment has room to move it. */
async function shapeWithLabel(board: Board, label = "Hi"): Promise<void> {
  const { page } = board;
  await pickTool(page, "Rectangle");
  const from = await at(board, SHAPE.left, SHAPE.top);
  const to = await at(board, SHAPE.right, SHAPE.bottom);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  await pickTool(page, "Select");
  const middle = await at(board, (SHAPE.left + SHAPE.right) / 2, (SHAPE.top + SHAPE.bottom) / 2);
  await page.mouse.dblclick(middle.x, middle.y);
  await page.locator("textarea[aria-label='Text editor']").fill(label);
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(200);
}

function boundLabel(elements: Awaited<ReturnType<typeof sceneElements>>) {
  const label = elements.find((element) => element.type === "text");
  expect(label, "double-clicking the shape should have made a label").toBeTruthy();
  return label!;
}

/**
 * Clears the selection, because the selection frame is ink too.
 *
 * A bound label's frame is drawn around its *box*, which is the full inner width of the
 * shape — so it lays an even band of pixels right across the region and drowns the couple
 * of hundred that are actually glyphs. Measured with the label still selected, moving the
 * text from one edge to the other shifts the centroid by about 0.04 instead of 0.4, and
 * the test reads as a broken feature rather than a badly aimed measurement.
 */
async function deselect(board: Board): Promise<void> {
  const empty = {
    x: board.box.x + OPEN_CANVAS.right - 30,
    y: board.box.y + OPEN_CANVAS.bottom - 30,
  };
  await board.page.mouse.click(empty.x, empty.y);
  await board.page.waitForTimeout(120);
}

/** Selects the shape, sets one alignment, then clears the selection so the ink is the text. */
async function align(board: Board, control: string): Promise<void> {
  await pickTool(board.page, "Select");
  // Index 0 is the rectangle — `clickElement` aims at the top edge, which is where a
  // transparent shape is actually hit.
  await clickElement(board, 0);
  await board.page.getByRole("radio", { name: control }).click();
  await board.page.waitForTimeout(150);
  await deselect(board);
}

test.describe("horizontal alignment", () => {
  test("the three alignments put the label in three different places", async ({ page }) => {
    const board = await openBoard(page);
    await shapeWithLabel(board);
    await deselect(board);

    const centred = await inkCentroidX(page, INSIDE);
    expect(centred, "no ink inside the shape — the label was never drawn").not.toBeNaN();

    await align(board, "Align text left");
    const left = await inkCentroidX(page, INSIDE);

    await align(board, "Align text right");
    const right = await inkCentroidX(page, INSIDE);

    // The shape is 500 wide and the label is two characters, so with nothing but the
    // glyphs in the region the three land near 0.03, 0.5 and 0.97. A quarter of the
    // width is a wide margin around that and still far outside anything a
    // still-hard-coded painter could produce, which would leave all three identical.
    expect(left, `left ${left} should sit left of centre ${centred}`).toBeLessThan(centred - 0.25);
    expect(right, `right ${right} should sit right of centre ${centred}`).toBeGreaterThan(
      centred + 0.25,
    );
  });

  test("the choice is recorded on the element, not just painted", async ({ page }) => {
    const board = await openBoard(page);
    await shapeWithLabel(board);

    await page.getByRole("radio", { name: "Align text right" }).click();
    await page.waitForTimeout(150);

    expect(boundLabel(await sceneElements(page)).textAlign).toBe("right");
  });

  /**
   * The migration guard, from the outside. A label nobody has aligned carries no value
   * at all — writing one on creation would be indistinguishable from a deliberate choice
   * and would re-align every board saved before the field existed.
   */
  test("a label nobody has aligned carries no alignment", async ({ page }) => {
    const board = await openBoard(page);
    await shapeWithLabel(board);
    expect(boundLabel(await sceneElements(page)).textAlign).toBeUndefined();
  });
});

test.describe("vertical alignment", () => {
  test("it moves the label inside the shape", async ({ page }) => {
    const board = await openBoard(page);
    await shapeWithLabel(board);

    const middle = boundLabel(await sceneElements(page)).y;

    await page.getByRole("radio", { name: "Align text top" }).click();
    await page.waitForTimeout(150);
    const top = boundLabel(await sceneElements(page)).y;

    await page.getByRole("radio", { name: "Align text bottom" }).click();
    await page.waitForTimeout(150);
    const bottom = boundLabel(await sceneElements(page)).y;

    expect(top, `top ${top} must sit above middle ${middle}`).toBeLessThan(middle);
    expect(bottom, `bottom ${bottom} must sit below middle ${middle}`).toBeGreaterThan(middle);
  });

  /**
   * Vertical alignment is a *position*, so setting it has to relayout there and then.
   * Storing the value and waiting for some later unrelated edit to move the label is the
   * shape this bug would take, and the scene would look correct the whole time.
   */
  test("the pixels move too, not only the element's y", async ({ page }) => {
    const board = await openBoard(page);
    await shapeWithLabel(board);

    const topHalf = { ...INSIDE, bottom: (INSIDE.top + INSIDE.bottom) / 2 };
    await align(board, "Align text bottom");
    const inkInTopHalf = await inkCentroidX(page, topHalf);

    await align(board, "Align text top");
    const afterMovingUp = await inkCentroidX(page, topHalf);

    // Bottom-aligned there is nothing in the top half at all, so the centroid is NaN.
    // Top-aligned there is.
    expect(inkInTopHalf, "bottom-aligned text should not be in the top half").toBeNaN();
    expect(afterMovingUp, "top-aligned text should be in the top half").not.toBeNaN();
  });
});

test.describe("the panel", () => {
  /**
   * A shape with a label in it is the only thing you *can* select once it has one —
   * clicking the shape selects the shape, and the label is not separately selectable. So
   * gating the text controls on "a text element is selected" makes them unreachable for
   * every label on the board, which is the case they exist for.
   */
  test("a shape with a label offers the text controls", async ({ page }) => {
    const board = await openBoard(page);
    await shapeWithLabel(board);

    await pickTool(page, "Select");
    const onTheShape = await at(board, SHAPE.left + 20, SHAPE.top + 6);
    await page.mouse.click(onTheShape.x, onTheShape.y);
    await page.waitForTimeout(150);

    await expect(page.getByRole("radio", { name: "Align text left" })).toBeVisible();
  });
});
