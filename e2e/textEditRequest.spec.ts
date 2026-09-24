import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, sceneElements, shownZoomPercent } from "./board.ts";
import type { Board } from "./board.ts";

/**
 * The text editor overlay, against the request the engine opens it with.
 *
 * The request was serialised snake_case while the host reads camelCase, so `fontSize`,
 * `textAlign` and `containerId` all arrived `undefined`: the overlay's font size was NaN
 * — invalid CSS, so the browser's 13.33px textarea default — its alignment `start`, and
 * a label was edited as free text, unwrapped and as wide as its longest line. The engine
 * pins the wire names (`ci_text_model_compat.rs`); this is the half that looks at the
 * overlay the person types into.
 */

/** A 300 × 200 rectangle, well inside `OPEN_CANVAS` so no floating panel covers it. */
const SHAPE = {
  left: OPEN_CANVAS.left + 60,
  top: OPEN_CANVAS.top + 80,
  right: OPEN_CANVAS.left + 360,
  bottom: OPEN_CANVAS.top + 280,
};

const editor = (board: Board): Locator => board.page.locator("textarea[aria-label='Text editor']");

async function drawShape(board: Board): Promise<void> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + SHAPE.left, box.y + SHAPE.top);
  await page.mouse.down();
  await page.mouse.move(box.x + SHAPE.right, box.y + SHAPE.bottom, { steps: 8 });
  await page.mouse.up();
  await pickTool(page, "Select");
}

/**
 * Double-clicks the middle of the rectangle, wherever the camera has put it, and waits
 * for its label editor.
 */
async function openLabelEditor(board: Board): Promise<Locator> {
  const middle = await board.page.evaluate(() => {
    const engine = window.__drawEngine!;
    const shape = JSON.parse(engine.exportJson()).elements[0];
    const { x, y, scale } = engine.camera;
    return {
      x: (shape.x + shape.width / 2) * scale + x,
      y: (shape.y + shape.height / 2) * scale + y,
    };
  });
  await board.page.mouse.dblclick(board.box.x + middle.x, board.box.y + middle.y);
  await expect(editor(board)).toBeVisible();
  return editor(board);
}

function computed(node: Locator) {
  return node.evaluate((textarea) => {
    const style = getComputedStyle(textarea);
    return {
      fontSize: style.fontSize,
      textAlign: style.textAlign,
      /** The width text wraps at: the box less its padding (`clientWidth` has no border). */
      contentWidth:
        textarea.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: textarea.getBoundingClientRect().height,
    };
  });
}

test("a label editor opens at the label's font size and alignment", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);

  const style = await computed(await openLabelEditor(board));

  // A new label is 20 units and centred; at 100% that is 20 CSS px.
  expect(style.fontSize).toBe("20px");
  expect(style.textAlign).toBe("center");
});

test("its font follows the zoom", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);
  await page.getByRole("button", { name: /^Zoom in/ }).click();
  // The readout follows the camera on the next frame, not synchronously with the click.
  await expect.poll(() => shownZoomPercent(page)).toBeGreaterThan(100);
  const zoom = await shownZoomPercent(page);

  const style = await computed(await openLabelEditor(board));

  expect(parseFloat(style.fontSize)).toBeCloseTo((20 * zoom) / 100, 1);
});

test("a right-aligned label is edited right-aligned", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);
  await (await openLabelEditor(board)).fill("Hi");
  await page.keyboard.press("Control+Enter");
  await expect(editor(board)).toHaveCount(0);

  // The shape is still selected after the edit, and its label follows its alignment.
  await page.getByRole("radio", { name: "Align text right" }).click();
  const style = await computed(await openLabelEditor(board));

  expect(style.textAlign).toBe("right");
});

test("a label wraps at its shape's width instead of widening", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);
  const node = await openLabelEditor(board);
  const label = (await sceneElements(page)).find((element) => element.type === "text");
  expect(label, "double-clicking the shape should have made a label").toBeTruthy();

  await node.fill("the quick brown fox jumps over the lazy dog, then over it again and again");
  const style = await computed(node);

  // It wraps where the canvas will: at the label's own width, which is the shape's inner
  // width. Free text instead grows to fit its longest line, which here would be several
  // times the shape.
  expect(style.contentWidth).toBeCloseTo(label!.width, 0);
  // And it grows down to show every line rather than scrolling them out of sight.
  expect(style.height).toBeGreaterThan(3 * 20 * 1.25);
});
