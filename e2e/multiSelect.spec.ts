import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  chromaInk,
  openBoard,
  pickTool,
  regionInk,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * The chrome that wraps a selection.
 *
 * `ci_multi_select.rs` pins the *logic* — what a marquee catches, what shift adds and
 * removes, what a drag carries — and all fifteen of those passed without a line of the
 * engine changing. What no engine test can see is whether any of it is **drawn**: the
 * selection can be perfectly correct and still show nothing, which is precisely the
 * report this file exists to answer.
 *
 * # How it measures
 *
 * Two rectangles with a gap between them, selected together. The frame that wraps them
 * runs across the *gap*, where there is otherwise nothing at all — so a thin patch over
 * the gap is empty when nothing is selected and has ink in it when the frame is there.
 * Whole-canvas ink cannot answer this: a one-pixel outline around shapes that are already
 * drawn moves that number by less than antialiasing does.
 *
 * Every case takes its control from the same patch before selecting, rather than from a
 * remembered constant, so a change in theme, DPR or antialiasing moves both numbers
 * together and the comparison survives it.
 */

/**
 * Canvas-relative. Two boxes with a gap between them, and **at different heights**.
 *
 * The heights differ on purpose. Level with each other, the group frame's top edge and
 * the lower box's own border land on the same line, and no measurement can tell which of
 * the two it is looking at — which is the whole question below.
 */
const LEFT = { x: OPEN_CANVAS.left + 60, y: OPEN_CANVAS.top + 60, w: 140, h: 110 };
const RIGHT = { x: OPEN_CANVAS.left + 320, y: OPEN_CANVAS.top + 190, w: 140, h: 110 };

function at(board: Board, x: number, y: number): { x: number; y: number } {
  return { x: board.box.x + x, y: board.box.y + y };
}

async function drawBox(board: Board, box: typeof LEFT, kind = "Rectangle"): Promise<void> {
  const { page } = board;
  await pickTool(page, kind);
  const from = at(board, box.x, box.y);
  const to = at(board, box.x + box.w, box.y + box.h);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Drops whatever the last gesture left selected. */
async function deselect(board: Board): Promise<void> {
  await pickTool(board.page, "Select");
  await board.page.mouse.click(
    board.box.x + OPEN_CANVAS.right - 30,
    board.box.y + OPEN_CANVAS.bottom - 30,
  );
  await board.page.waitForTimeout(120);
}

/**
 * The patch the frame's top edge crosses, over the gap between the two boxes.
 *
 * Generous vertically — the frame sits a few pixels above the shapes and the exact offset
 * is the painter's business, not this test's — and strictly inside the gap horizontally,
 * so no part of either rectangle can contribute to it whatever the band's height.
 */
const GAP_BAND = {
  left: LEFT.x + LEFT.w + 20,
  top: LEFT.y - 24,
  right: RIGHT.x - 20,
  bottom: LEFT.y + 4,
};

/**
 * The patch a box of the *lower* shape's own would cross, and nothing else can.
 *
 * It sits above that shape but far below the group frame's top edge, which is up at the
 * higher box; and it is inset from the shape's sides, so the group frame's verticals miss
 * it too. Ink here means the element got a box of its own — which it no longer does.
 */
const OWN_BORDER_BAND = {
  left: RIGHT.x + 20,
  top: RIGHT.y - 16,
  right: RIGHT.x + RIGHT.w - 20,
  bottom: RIGHT.y - 2,
};

/** Along the lower shape's top edge, inset from its corners: where a trace of it runs. */
const OWN_EDGE_BAND = {
  left: RIGHT.x + 20,
  // Tight: a box of its own would run four pixels above the edge, and must miss this.
  top: RIGHT.y - 2,
  right: RIGHT.x + RIGHT.w - 20,
  bottom: RIGHT.y + 3,
};

async function drawTwoBoxes(
  page: Parameters<typeof openBoard>[0],
  lower = "Rectangle",
): Promise<Board> {
  const board = await openBoard(page);
  await drawBox(board, LEFT);
  await drawBox(board, RIGHT, lower);
  await deselect(board);
  return board;
}

/** Rubber-bands around both boxes. */
async function marqueeBoth(board: Board): Promise<void> {
  const { page } = board;
  await pickTool(page, "Select");
  const from = at(board, LEFT.x - 30, LEFT.y - 40);
  const to = at(board, RIGHT.x + RIGHT.w + 30, RIGHT.y + RIGHT.h + 30);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe("the frame around a multi-selection", () => {
  test("is actually drawn", async ({ page }) => {
    const board = await drawTwoBoxes(page);

    const empty = await regionInk(page, GAP_BAND);
    await marqueeBoth(board);

    expect(await selection(page), "both boxes should be selected").toHaveLength(2);
    const framed = await regionInk(page, GAP_BAND);
    expect(
      framed,
      `the frame should put ink across the gap: ${empty} before, ${framed} after`,
    ).toBeGreaterThan(empty + 0.01);
  });

  test("goes away again when the selection is dropped", async ({ page }) => {
    const board = await drawTwoBoxes(page);
    const empty = await regionInk(page, GAP_BAND);

    await marqueeBoth(board);
    expect(await regionInk(page, GAP_BAND)).toBeGreaterThan(empty + 0.01);

    await deselect(board);
    expect(
      await regionInk(page, GAP_BAND),
      "nothing selected, nothing drawn over the gap",
    ).toBeCloseTo(empty, 2);
  });

  /**
   * Each selected element is shown by its own shape, traced in the selection colour.
   *
   * Excalidraw puts a padded box around every selected element
   * (`interactiveScene.ts@1118751f:1864-1890`) inside the dotted box around them all
   * (`:2027-2052`), and so did we. On a board of neighbouring shapes that is a lattice of
   * rectangles over everything, the same for a circle as for a rectangle — reported as
   * "the multi-selector selects all the div around the shapes; we should see the selected
   * element, just the shape". Without *something* per element, though, you could see that
   * a region was held but not which shapes in it were; so each is traced along its edge.
   */
  test("traces each selected element along its own edge, in the selection colour", async ({
    page,
  }) => {
    const board = await drawTwoBoxes(page);
    const before = await chromaInk(page, OWN_EDGE_BAND);

    await marqueeBoth(board);

    expect(await selection(page)).toHaveLength(2);
    const traced = await chromaInk(page, OWN_EDGE_BAND);
    expect(
      traced,
      `the lower box's edge should be traced: ${before} before, ${traced} after`,
    ).toBeGreaterThan(before + 0.05);
  });

  test("draws no box around each one", async ({ page }) => {
    const board = await drawTwoBoxes(page);
    const empty = await regionInk(page, OWN_BORDER_BAND);

    await marqueeBoth(board);

    expect(await selection(page)).toHaveLength(2);
    expect(
      await regionInk(page, OWN_BORDER_BAND),
      "a box was drawn around the lower shape, outside its own edge",
    ).toBeCloseTo(empty, 2);
  });

  test("an ellipse is traced round its curve, not boxed", async ({ page }) => {
    // Where the report was plainest: a box around a circle points at the corners, where
    // the circle is not.
    const board = await drawTwoBoxes(page, "Ellipse");
    const top = {
      left: RIGHT.x + RIGHT.w / 2 - 15,
      top: RIGHT.y - 2,
      right: RIGHT.x + RIGHT.w / 2 + 15,
      bottom: RIGHT.y + 3,
    };
    const corner = {
      left: RIGHT.x - 12,
      top: RIGHT.y - 12,
      right: RIGHT.x + 16,
      bottom: RIGHT.y + 16,
    };
    const curveBefore = await chromaInk(page, top);
    const cornerBefore = await regionInk(page, corner);

    await marqueeBoth(board);

    expect(await selection(page)).toHaveLength(2);
    expect(await chromaInk(page, top), "the top of the curve is not traced").toBeGreaterThan(
      curveBefore + 0.05,
    );
    expect(
      await regionInk(page, corner),
      "something was drawn at the corner of the ellipse's box, where the ellipse is not",
    ).toBeCloseTo(cornerBefore, 2);
  });

  /**
   * The control that separates "the group frame is missing" from "no selection chrome
   * draws at all" — the two look identical from the report and need different fixes.
   */
  test("a single shape gets its frame too", async ({ page }) => {
    const board = await drawTwoBoxes(page);
    // A patch just above the left box, where only its own frame can reach.
    const band = {
      left: LEFT.x + 20,
      top: LEFT.y - 24,
      right: LEFT.x + LEFT.w - 20,
      bottom: LEFT.y - 4,
    };
    const empty = await regionInk(page, band);

    await pickTool(page, "Select");
    const edge = at(board, LEFT.x + LEFT.w / 2, LEFT.y);
    await page.mouse.click(edge.x, edge.y);
    await page.waitForTimeout(150);

    expect(await selection(page)).toHaveLength(1);
    expect(await regionInk(page, band)).toBeGreaterThan(empty + 0.01);
  });
});

test.describe("multi-select gestures reach the engine", () => {
  test("shift-click adds a second shape", async ({ page }) => {
    const board = await drawTwoBoxes(page);
    await pickTool(page, "Select");

    const first = at(board, LEFT.x + LEFT.w / 2, LEFT.y);
    await page.mouse.click(first.x, first.y);
    expect(await selection(page)).toHaveLength(1);

    const second = at(board, RIGHT.x + RIGHT.w / 2, RIGHT.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(second.x, second.y);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(120);

    expect(await selection(page), "shift should have added rather than replaced").toHaveLength(2);
  });

  test("shift-click takes one back out", async ({ page }) => {
    const board = await drawTwoBoxes(page);
    await marqueeBoth(board);
    expect(await selection(page)).toHaveLength(2);

    const second = at(board, RIGHT.x + RIGHT.w / 2, RIGHT.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(second.x, second.y);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(120);

    expect(await selection(page)).toHaveLength(1);
  });

  test("dragging one member carries the other", async ({ page }) => {
    const board = await drawTwoBoxes(page);
    await marqueeBoth(board);

    const before = (await sceneElements(page)).map((el) => el.x);

    const grab = at(board, LEFT.x + LEFT.w / 2, LEFT.y);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) {
      await page.mouse.move(grab.x + (70 * step) / 5, grab.y);
    }
    await page.mouse.up();
    await page.waitForTimeout(150);

    const after = (await sceneElements(page)).map((el) => el.x);
    expect(after, "both boxes should still be on the board").toHaveLength(2);
    expect(after[0]! - before[0]!, "the one that was grabbed").toBeCloseTo(70, 0);
    expect(after[1]! - before[1]!, "and the one that was not").toBeCloseTo(70, 0);
  });

  /**
   * Shift on a held member takes it out on the release, and only if nothing moved, so a
   * shift-drag still carries everything (`ci_multi_select.rs`). Taken out on the press,
   * the drag moved the other box and left the grabbed one behind.
   */
  test("a shift-drag from a held member carries both", async ({ page }) => {
    const board = await drawTwoBoxes(page);
    await marqueeBoth(board);
    const before = (await sceneElements(page)).map((el) => el.x);

    const grab = at(board, RIGHT.x + RIGHT.w / 2, RIGHT.y);
    await page.keyboard.down("Shift");
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) {
      await page.mouse.move(grab.x + (70 * step) / 5, grab.y);
    }
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.waitForTimeout(150);

    const after = (await sceneElements(page)).map((el) => el.x);
    expect(after[1]! - before[1]!, "the one that was grabbed").toBeCloseTo(70, 0);
    expect(after[0]! - before[0]!, "and the one that was not").toBeCloseTo(70, 0);
    expect(await selection(page), "a drag takes nothing out").toHaveLength(2);
  });
});

/**
 * The rubber band itself, *while* it is being dragged.
 *
 * Every other case here measures after release, which is why this was missed: the
 * `Marquee` arm updated its rectangle and never asked for a frame, so the selection came
 * out right and nothing was drawn for the whole length of the drag. Found through
 * `editor-inspector` — mid-gesture the engine reported `kind: "marquee"` and the inside of
 * the rectangle read zero ink.
 */
test.describe("the rubber band", () => {
  test("is drawn while it is being dragged, not only once it is let go", async ({ page }) => {
    const board = await drawTwoBoxes(page);
    await pickTool(page, "Select");
    // A patch inside where the band will be and clear of both boxes — empty until the
    // band's tinted fill covers it.
    const inside = {
      left: RIGHT.x + RIGHT.w + 60,
      top: RIGHT.y + 20,
      right: RIGHT.x + RIGHT.w + 120,
      bottom: RIGHT.y + 60,
    };
    const empty = await regionInk(page, inside);

    const from = at(board, LEFT.x - 30, LEFT.y - 40);
    const to = at(board, RIGHT.x + RIGHT.w + 160, RIGHT.y + RIGHT.h + 30);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.waitForTimeout(120);

    const during = await regionInk(page, inside);
    await page.mouse.up();

    expect(
      during,
      `the band should be on screen mid-drag: ${empty} before, ${during} during`,
    ).toBeGreaterThan(empty + 0.5);
  });
});
