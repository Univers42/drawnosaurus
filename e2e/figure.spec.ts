import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  activeTool,
  focusBoard,
  openBoard,
  pickTool,
  sceneElements,
  selection,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * The `figure` element: a parametric outline (polygon/star/parallelogram/trapezoid/
 * cylinder/document) with no equivalent in the oracle — `ci_figure.rs` pins the geometry,
 * the style-patch pipeline and the flowchart clone structurally; this is the half only a
 * real browser proves — that the toolbar and the panel actually reach those, and that a
 * genuine pointer drag binds an arrow to the outline. `docs/reference/figure.md`.
 */

type Figure = SceneElement & {
  figure?: { kind: string; sides?: number; ratio?: number };
};

const AT = {
  x: (OPEN_CANVAS.left + OPEN_CANVAS.right) / 2,
  y: (OPEN_CANVAS.top + OPEN_CANVAS.bottom) / 2,
};

const editor = (page: Page) => page.locator("textarea[aria-label='Text editor']");
const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });
const shapeKind = (page: Page, label: string) =>
  panel(page).getByRole("radio", { name: label, exact: true });

async function elements(page: Page): Promise<Figure[]> {
  return (await sceneElements(page)) as Figure[];
}

async function figures(page: Page): Promise<Figure[]> {
  return (await elements(page)).filter((element) => element.type === "figure");
}

/**
 * A drag of the Shapes tool at the canvas centre, kind picked first if given.
 *
 * A plain click is not enough: a generic shape's draft under a couple of pixels either
 * way is discarded as too small to keep (`engine/pointer_end.rs::end_draft`) — only the
 * sticky note special-cases a click into a default size. So this drags, exactly as
 * `console.spec.ts`'s `drawBox` does for a rectangle.
 */
async function placeFigure(board: Board, kind?: string): Promise<Figure> {
  const { page, box } = board;
  await focusBoard(board);
  await pickTool(page, "Shapes");
  expect(await activeTool(page)).toBe("figure");
  if (kind) await shapeKind(page, kind).click();
  await page.mouse.move(box.x + AT.x, box.y + AT.y);
  await page.mouse.down();
  await page.mouse.move(box.x + AT.x + 140, box.y + AT.y + 90, { steps: 4 });
  await page.mouse.up();
  const [placed] = await figures(page);
  if (!placed) throw new Error("no figure was placed");
  return placed;
}

/** A world point on the page, at the camera the engine holds. */
async function onPage(board: Board, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const { x, y, scale } = await board.page.evaluate(() => window.__drawEngine!.camera);
  return { x: board.box.x + wx * scale + x, y: board.box.y + wy * scale + y };
}

test.describe("the Shapes tool", () => {
  test("a drag places the default hexagon, selected", async ({ page }) => {
    const board = await openBoard(page);
    const placed = await placeFigure(board);
    expect(placed.figure).toEqual({ kind: "polygon", sides: 6 });
    expect(await selection(page)).toEqual([placed.id]);
    expect(await activeTool(page), "the tool is let go once the figure is down").toBe("select");
  });

  test("the Shape row picks a kind before anything is drawn", async ({ page }) => {
    const board = await openBoard(page);
    const placed = await placeFigure(board, "Trapezoid");
    expect(placed.figure?.kind).toBe("trapezoid");
  });

  test("the Shape row also restyles an already-selected figure", async ({ page }) => {
    const board = await openBoard(page);
    const placed = await placeFigure(board);
    expect(placed.figure?.kind).toBe("polygon");

    await shapeKind(page, "Star").click();

    await expect
      .poll(async () => (await figures(page)).find((f) => f.id === placed.id)?.figure?.kind)
      .toBe("star");
  });
});

test.describe("the sides stepper", () => {
  test("changes a selected polygon's sides, as one undo step", async ({ page }) => {
    const board = await openBoard(page);
    const placed = await placeFigure(board);

    const sides = panel(page).getByRole("spinbutton", { name: "Sides" });
    await expect(sides).toHaveValue("6");
    await sides.fill("9");
    await sides.press("Enter");
    await expect.poll(async () => (await figures(page))[0]?.figure?.sides).toBe(9);

    // The key listener is on the editor container, not the window (`docs/reference` —
    // see `CLAUDE.md`); typing into the panel's own input leaves focus there, so Ctrl+Z
    // needs the board focused again first, exactly as the opacity drag test does.
    await focusBoard(board);
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => (await figures(page)).find((f) => f.id === placed.id)?.figure?.sides)
      .toBe(6);
  });
});

test.describe("the ratio slider", () => {
  test("previews live while dragging and commits once on release", async ({ page }) => {
    const board = await openBoard(page);
    await placeFigure(board, "Star");

    const slider = panel(page).getByRole("slider", { name: "Ratio" });
    await slider.scrollIntoViewIfNeeded();
    const track = await slider.boundingBox();
    if (!track) throw new Error("the ratio slider has no box");
    const y = track.y + track.height / 2;
    await page.mouse.move(track.x + track.width - 2, y);
    await page.mouse.down();
    await page.mouse.move(track.x + 2, y, { steps: 8 });
    const during = (await figures(page))[0]?.figure?.ratio;
    expect(during, "the drag is shown as it goes").toBeLessThan(0.9);
    await page.mouse.up();

    const after = (await figures(page))[0]?.figure?.ratio;
    expect(after).toBe(during);

    // One step of undo takes back the whole drag, preview and commit together, to the
    // untouched figure: no ratio was ever written to it before the slider was dragged.
    // Refocus the board first — the slider left keyboard focus on itself, outside the
    // editor container the undo shortcut listens on.
    await focusBoard(board);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await figures(page))[0]?.figure?.ratio).toBeUndefined();
  });
});

test.describe("around a figure", () => {
  test("an arrow dragged onto a star binds to its outline", async ({ page }) => {
    const board = await openBoard(page);
    const star = await placeFigure(board, "Star");
    await pickTool(page, "Arrow");
    const from = await onPage(board, star.x - 200, star.y + star.height / 2);
    const to = await onPage(board, star.x + star.width / 2, star.y + star.height / 2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    const arrow = (await elements(page)).find((element) => element.type === "arrow");
    expect(arrow?.endBinding).toBe(star.id);
  });

  test("Ctrl+D duplicates a figure with its own kind and params", async ({ page }) => {
    const board = await openBoard(page);
    const placed = await placeFigure(board, "Cylinder");
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await figures(page)).length).toBe(2);
    const copy = (await figures(page)).find((candidate) => candidate.id !== placed.id)!;
    expect(copy.figure).toEqual(placed.figure);
  });
});

test("palette → add a figure → label it → grow a second node of the same kind", async ({
  page,
}) => {
  // Mirrors `keyboardDiagram.spec.ts`: the one thing only a real browser proves is that
  // closing the palette hands keyboard focus back to the board, so Enter and Ctrl+Arrow
  // reach it — and that the flowchart clone `engine/flowchart.rs` documents (a figure
  // chain keeps its kind with no digit override) actually lands through those keys.
  const board = await openBoard(page);
  await focusBoard(board);

  const paletteInput = page.getByRole("combobox", { name: "Command palette" });
  const before = await sceneElements(page);
  await page.keyboard.press("Control+/");
  await expect(paletteInput).toBeFocused();
  await page.keyboard.type("add star");
  await page.keyboard.press("Enter");
  await expect(paletteInput).toHaveCount(0);

  const afterInsert = await figures(page);
  expect(afterInsert).toHaveLength(1);
  const nodeA = afterInsert[0]!;
  expect(nodeA.figure?.kind).toBe("star");
  expect(await selection(page)).toEqual([nodeA.id]);

  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("first");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);

  // Ctrl+Right grows a second, bound node off the one the palette just made — a figure
  // chain keeps its kind with no digit override (`engine/flowchart.rs`).
  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Control");
  await expect.poll(async () => (await figures(page)).length).toBe(2);
  const nodeB = (await figures(page)).find((f) => f.id !== nodeA.id)!;
  expect(nodeB.figure?.kind, "a figure chain keeps its kind").toBe("star");
  const arrow = (await sceneElements(page)).find(
    (element) => element.type === "arrow" && element.startBinding === nodeA.id,
  );
  expect(arrow?.endBinding, "the two nodes are joined").toBe(nodeB.id);
  // The starting figure, its label, the grown figure and the arrow joining them.
  expect(await sceneElements(page)).toHaveLength(before.length + 4);
});
