import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  activeTool,
  camera,
  focusBoard,
  openBoard,
  pickTool,
  sceneElements,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * Aiming an arrow into a Ctrl+D pack of squares, with real keys and a real pointer.
 *
 * `ci_binding_dense.rs` pins the rule — the shape whose outline is nearest wins, so a
 * click just outside a packed square binds that square and finishes the arrow. This
 * checks the pack a person makes is the pack the rule was measured on (Ctrl+D ten units
 * down and right, as on excalidraw.com), and that a click in it really does finish: the
 * user's report was a pack where no click ever did.
 */

interface Bound extends SceneElement {
  endBindMode?: "inside" | "orbit" | null;
}

/** A 100×100 square dragged out with the rectangle tool, its corner at a canvas point. */
async function drawSquare(board: Board, x: number, y: number): Promise<void> {
  const { page, box } = board;
  const { scale } = await camera(page);
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 100 * scale, box.y + y + 100 * scale, { steps: 8 });
  await page.mouse.up();
}

/** Where a world point is on the page. */
async function onPage(board: Board, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const { x, y, scale } = await camera(board.page);
  return { x: board.box.x + wx * scale + x, y: board.box.y + wy * scale + y };
}

async function rectangles(board: Board): Promise<SceneElement[]> {
  return (await sceneElements(board.page)).filter((el) => el.type === "rectangle");
}

/**
 * A square, 29 Ctrl+D copies of it, and a lone square away from the pack. Returns the
 * pack bottom to top, and the lone square.
 */
async function packAndLone(board: Board): Promise<{ pack: SceneElement[]; lone: SceneElement }> {
  const { page } = board;
  await focusBoard(board);
  await drawSquare(board, OPEN_CANVAS.left + 40, OPEN_CANVAS.top + 20);
  for (let i = 0; i < 29; i++) await page.keyboard.press("Control+d");
  await page.keyboard.press("Escape");
  await drawSquare(board, OPEN_CANVAS.left + 560, OPEN_CANVAS.top + 300);
  await page.keyboard.press("Escape");
  const all = await rectangles(board);
  expect(all, "thirty in the pack and the lone one").toHaveLength(31);
  return { pack: all.slice(0, 30), lone: all[30]! };
}

async function theArrow(board: Board): Promise<Bound> {
  const arrows = (await sceneElements(board.page)).filter((el) => el.type === "arrow");
  expect(arrows, "one arrow on the board").toHaveLength(1);
  return arrows[0] as Bound;
}

/** Click-mode: a click on the lone square starts a path; the cursor goes to `to`. */
async function startPathTo(board: Board, lone: SceneElement, to: { x: number; y: number }) {
  const { page } = board;
  await pickTool(page, "Arrow");
  const from = await onPage(board, lone.x + lone.width / 2, lone.y + lone.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.click(from.x, from.y);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(60);
}

test.describe("an arrow aimed into a Ctrl+D pack", () => {
  test("Ctrl+D copies ten units down and right", async ({ page }) => {
    const board = await openBoard(page);
    const { pack } = await packAndLone(board);
    for (let i = 1; i < pack.length; i++) {
      expect(pack[i]!.x - pack[i - 1]!.x, `copy ${i}`).toBeCloseTo(10, 6);
      expect(pack[i]!.y - pack[i - 1]!.y, `copy ${i}`).toBeCloseTo(10, 6);
    }
  });

  test("a click just outside a packed square binds it and finishes", async ({ page }) => {
    const board = await openBoard(page);
    const { pack, lone } = await packAndLone(board);
    // 2.3 above the fourth square's top edge: inside the three squares under it, but
    // nearest the fourth's outline.
    const square = pack[3]!;
    const target = await onPage(board, square.x + square.width / 2 + 1.3, square.y - 2.3);
    await startPathTo(board, lone, target);
    await expect(page.getByRole("button", { name: /^Arrow \(/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(120);

    expect(await activeTool(page), "the click finished the arrow").toBe("select");
    await expect(page.getByRole("button", { name: /^Arrow \(/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const arrow = await theArrow(board);
    expect(arrow.startBinding).toBe(lone.id);
    expect(arrow.endBinding, "bound to the square aimed at").toBe(square.id);
    expect(arrow.endBindMode).toBe("orbit");
  });

  test("a double click inside a packed square labels the arrow, not the square", async ({
    page,
  }) => {
    const board = await openBoard(page);
    const { pack, lone } = await packAndLone(board);
    // Inside the seventh square and nearest its own outline (excalidraw.com: r6, inside)
    // — the first click places a waypoint, the second finishes there.
    const square = pack[6]!;
    const target = await onPage(board, pack[0]!.x + 71.3, pack[0]!.y + 70.7);
    await startPathTo(board, lone, target);

    await page.mouse.dblclick(target.x, target.y);
    await page.waitForTimeout(150);

    expect(await activeTool(page), "the double click finished the arrow").toBe("select");
    const arrow = await theArrow(board);
    expect(arrow.endBinding).toBe(square.id);
    expect(arrow.endBindMode).toBe("inside");
    const labels = (await sceneElements(page)).filter((el) => el.type === "text");
    expect(
      labels.map((el) => el.containerId),
      "the label opened on the new arrow",
    ).toEqual([arrow.id]);
  });

  test("a double click whose first click binds in orbit types a free text, not a label", async ({
    page,
  }) => {
    const board = await openBoard(page);
    const { pack, lone } = await packAndLone(board);
    // As above: 2.3 above the fourth square's top edge, inside the three under it. The
    // first click binds the fourth in orbit and finishes; the end moves onto its outline,
    // along the line to the lone square, away from the pointer — so the double click is
    // not on the arrow, and excalidraw.com types a free text there.
    const square = pack[3]!;
    const target = await onPage(board, square.x + square.width / 2 + 1.3, square.y - 2.3);
    await startPathTo(board, lone, target);

    await page.mouse.dblclick(target.x, target.y);
    await page.waitForTimeout(150);

    expect(await activeTool(page)).toBe("select");
    const arrow = await theArrow(board);
    expect(arrow.endBinding).toBe(square.id);
    expect(arrow.endBindMode).toBe("orbit");
    const texts = (await sceneElements(page)).filter((el) => el.type === "text");
    expect(
      texts.map((el) => el.containerId ?? null),
      "a free text, on no square and not on the arrow",
    ).toEqual([null]);
  });
});

test.describe("an arrow aimed beside a sticky note", () => {
  /**
   * A note from the N tool is a group whose filled shadow sits three units down and right
   * of it, underneath. Beside the note's right edge the shadow's outline is nearer than
   * the note's, so the nearest-outline rule would bind the shadow — in orbit, three units
   * off the note, or inside it, a waypoint, up to three units out. A locked shape is never
   * a candidate (dc2c16d9), and the shadow is locked, so the note is what binds.
   */
  test("a click beside its right edge binds the note and finishes", async ({ page }) => {
    const board = await openBoard(page);
    const centre = {
      x: board.box.x + OPEN_CANVAS.left + 400,
      y: board.box.y + OPEN_CANVAS.top + 200,
    };
    await focusBoard(board);
    await pickTool(page, "Sticky Note");
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press("Escape");
    const rects = (await sceneElements(page)).filter((el) => el.type === "rectangle");
    expect(
      rects.map((el) => el.backgroundColor),
      "the shadow, then the note",
    ).toEqual(["#000000", "#ffdf6b"]);
    const [shadow, note] = [rects[0]!, rects[1]!];
    const name = (id: string | null | undefined) =>
      id === note.id ? "note" : id === shadow.id ? "shadow" : (id ?? null);

    const outcomes = [];
    for (const beyond of [2.5, 6, 12]) {
      await pickTool(page, "Arrow");
      const from = await onPage(board, note.x - 250, note.y + note.height / 2);
      const to = await onPage(board, note.x + note.width + beyond, note.y + note.height / 2);
      await page.mouse.move(from.x, from.y);
      await page.mouse.click(from.x, from.y);
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.waitForTimeout(60);
      await page.mouse.click(to.x, to.y);
      await page.waitForTimeout(120);
      const finished = (await activeTool(page)) === "select";
      // A waypoint instead: Escape finishes the path there.
      if (!finished) await page.keyboard.press("Escape");
      const arrows = (await sceneElements(page)).filter((el) => el.type === "arrow") as Bound[];
      const arrow = arrows.at(-1)!;
      outcomes.push({ beyond, finished, end: name(arrow.endBinding), mode: arrow.endBindMode });
      await page.keyboard.press("Escape");
    }
    expect(outcomes).toEqual(
      [2.5, 6, 12].map((beyond) => ({ beyond, finished: true, end: "note", mode: "orbit" })),
    );
  });
});
