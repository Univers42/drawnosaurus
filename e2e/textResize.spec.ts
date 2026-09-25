import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, clickElement, openBoard, sceneElements, selection } from "./board.ts";
import type { Board, SceneElement } from "./board.ts";

/**
 * Text is laid out again as it is resized, as Excalidraw lays it out
 * (`resizeSingleTextElement`, `handleBindTextResize`; `engine/.../ci_text_resize.rs`), and a
 * handle is taken where it is drawn (`getResizeOffsetXY`; `ci_handles.rs`). The engine
 * tests pin the numbers with a fixed-width measurer; this is the same drag with a real
 * mouse and the browser's fonts. `docs/reference/resize.md` › Text and labels.
 */

/**
 * How far out a corner or side handle's centre sits from the edge it moves, in screen
 * pixels: the 4px frame margin and half the 8px handle (`HandleLayout::screen`).
 */
const HANDLE_OUT = 8;
/** A text has no side handles: its side is taken on the frame line, 4px out (`side_at`). */
const FRAME_LINE_OUT = 4;

const TEXT = "hello world foo bar";

type Element = SceneElement & {
  fontSize?: number;
  autoResize?: boolean;
  originalText?: string;
};

const BASE = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  roundness: null,
  seed: 1,
  groupIds: [],
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
};

const label = (containerId: string | null) => ({
  ...BASE,
  id: containerId ? "label" : "text",
  type: "text",
  x: 0,
  y: 0,
  width: 200,
  height: 25,
  text: TEXT,
  originalText: TEXT,
  fontSize: 20,
  fontFamily: 5,
  lineHeight: 1.25,
  containerId,
});

const rect = (width: number, height: number, boundTextId: string | null) => ({
  ...BASE,
  id: "rect",
  type: "rectangle",
  x: 0,
  y: 0,
  width,
  height,
  boundTextId,
});

/**
 * Loads `elements` with their origin 80px inside the open canvas, lays their text out in
 * Excalifont, and selects the first by a click on its top edge — where a shape with no
 * fill is hit, and never on its label.
 *
 * The face arrives on its own time, and its arrival lays every text out again: before or
 * after the drag, depending on the run. So the spec waits for it and lays the text out
 * once it is in, as the app does when a face arrives, and every drag starts from the
 * geometry the face gives.
 */
async function load(board: Board, elements: Record<string, unknown>[]): Promise<void> {
  await board.page.evaluate(
    ({ elements, at }) => {
      const engine = window.__drawEngine!;
      const origin = engine.screenToWorld(at.x, at.y);
      const placed = elements.map((element) => ({
        ...element,
        x: (element.x as number) + origin.x,
        y: (element.y as number) + origin.y,
      }));
      const file = { type: "osidraw", version: 1, source: "e2e", elements: placed };
      if (!engine.loadScene(JSON.stringify(file))) throw new Error("the scene was refused");
    },
    { elements, at: { x: OPEN_CANVAS.left + 80, y: OPEN_CANVAS.top + 80 } },
  );
  await board.page.evaluate(async () => {
    await document.fonts.load("20px Excalifont");
    (window.__drawEngine as unknown as { fontsLoaded(): void }).fontsLoaded();
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
  await clickElement(board, 0);
}

async function element(board: Board, id: string): Promise<Element> {
  const found = (await sceneElements(board.page)).find((element) => element.id === id);
  if (!found) throw new Error(`no element ${id}`);
  return found as Element;
}

/** A world point on the page, at the camera the engine holds. */
async function onPage(board: Board, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const { x, y, scale } = await board.page.evaluate(() => window.__drawEngine!.camera);
  return { x: board.box.x + wx * scale + x, y: board.box.y + wy * scale + y };
}

/** Presses at `from` (page pixels) and moves by each step of `by`, in order, leaving it pressed. */
async function pressAndMove(
  board: Board,
  from: { x: number; y: number },
  ...by: { dx: number; dy: number }[]
): Promise<void> {
  const { page } = board;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const { dx, dy } of by) {
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  }
}

test("a free text's east side wraps it at the width it is given", async ({ page }) => {
  const board = await openBoard(page);
  await load(board, [label(null)]);
  expect(await selection(page)).toEqual(["text"]);
  const before = await element(board, "text");
  expect(before.text).toBe(TEXT);

  // On the frame line, level with the middle of the east side: a text has no side handle.
  const side = await onPage(board, before.x + before.width, before.y + before.height / 2);
  const narrower = 100 - before.width;
  await pressAndMove(board, { x: side.x + FRAME_LINE_OUT, y: side.y }, { dx: narrower, dy: 0 });
  await page.mouse.up();

  const after = await element(board, "text");
  expect(after.text, "the words are wrapped, not squeezed").toContain("\n");
  expect(after.text!.replace(/\n/g, " ")).toBe(TEXT);
  expect(after.autoResize).toBe(false);
  expect(after.width).toBeCloseTo(100, 0);
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.fontSize).toBe(20);
  // The west side held.
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
});

test("a free text's corner grows its font with its height", async ({ page }) => {
  const board = await openBoard(page);
  await load(board, [label(null)]);
  const before = await element(board, "text");

  const corner = await onPage(board, before.x + before.width, before.y + before.height);
  await pressAndMove(
    board,
    { x: corner.x + HANDLE_OUT, y: corner.y + HANDLE_OUT },
    { dx: 40, dy: before.height },
  );
  await page.mouse.up();

  const after = await element(board, "text");
  expect(after.fontSize).toBeCloseTo(40, 1);
  expect(after.height).toBeCloseTo(2 * before.height, 1);
  expect(after.width).toBeCloseTo(2 * before.width, 1);
  expect(after.text, "the lines are the same lines, scaled").toBe(TEXT);
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
});

test("narrowing a labelled rectangle wraps its label as it goes, and stops at one character of it", async ({
  page,
}) => {
  const board = await openBoard(page);
  await load(board, [rect(320, 80, "label"), label("rect")]);
  expect(await selection(page)).toEqual(["rect"]);
  const before = await element(board, "rect");

  const side = await onPage(board, before.x + before.width, before.y + before.height / 2);
  const from = { x: side.x + HANDLE_OUT, y: side.y };
  await pressAndMove(board, from, { dx: -before.width / 2, dy: 0 });

  // Mid-drag, not at the release: the label is laid out on every move.
  const halfway = await element(board, "label");
  expect(halfway.text, "the label wraps while the drag is still going").toContain("\n");
  expect(halfway.text!.replace(/\n/g, " ")).toBe(TEXT);
  expect((await element(board, "rect")).width).toBeCloseTo(before.width / 2, 0);

  // Right onto the west side: the shape stops at one character's room. (Past it, it
  // turns over as any shape does, at least that wide — `resizeSingleElement` clamps the
  // magnitude, `resizeElements.ts@1118751f:759-801`.)
  await page.mouse.move(from.x - before.width, from.y, { steps: 10 });
  const narrowest = await element(board, "rect");
  const words = await element(board, "label");
  expect(narrowest.x).toBeCloseTo(before.x, 1);
  expect(narrowest.width).toBeGreaterThan(10);
  expect(narrowest.width).toBeLessThan(60);
  expect(words.width, "every line fits in the padded room").toBeLessThanOrEqual(
    narrowest.width - 10 + 0.5,
  );
  expect(narrowest.height, "the shape grew to hold the label").toBeGreaterThanOrEqual(
    words.height + 10 - 0.5,
  );
  await page.mouse.up();

  const committed = await element(board, "rect");
  expect(committed.width).toBeCloseTo(narrowest.width, 1);
  // Words broken between characters where one line cannot hold them, from the source.
  const kept = await element(board, "label");
  expect(kept.text!.replace(/\s/g, "")).toBe(TEXT.replace(/ /g, ""));
  expect(kept.originalText).toBe(TEXT);
});

test("a handle taken where it is drawn moves its corner no further than the pointer", async ({
  page,
}) => {
  const board = await openBoard(page);
  await load(board, [rect(200, 120, null)]);
  const before = await element(board, "rect");

  const corner = await onPage(board, before.x + before.width, before.y + before.height);
  const handle = { x: corner.x + HANDLE_OUT, y: corner.y + HANDLE_OUT };
  await pressAndMove(board, handle, { dx: 1, dy: 1 });
  const nudged = await element(board, "rect");
  expect(nudged.width, "no jump to the pointer on the first pull").toBeCloseTo(before.width + 1, 1);
  expect(nudged.height).toBeCloseTo(before.height + 1, 1);

  await page.mouse.move(handle.x + 40, handle.y + 30, { steps: 4 });
  await page.mouse.up();
  const after = await element(board, "rect");
  expect(after.width).toBeCloseTo(before.width + 40, 1);
  expect(after.height).toBeCloseTo(before.height + 30, 1);
});

test("a side-resized text takes its own width back from the menu, or from the wrap row", async ({
  page,
}) => {
  const board = await openBoard(page);
  await load(board, [label(null)]);
  const before = await element(board, "text");

  /** The east side pulled in to 100: a fixed width, the words wrapped at it. */
  async function narrow(): Promise<Element> {
    const now = await element(board, "text");
    const side = await onPage(board, now.x + now.width, now.y + now.height / 2);
    await pressAndMove(
      board,
      { x: side.x + FRAME_LINE_OUT, y: side.y },
      { dx: 100 - now.width, dy: 0 },
    );
    await page.mouse.up();
    const fixed = await element(board, "text");
    expect(fixed.autoResize).toBe(false);
    expect(fixed.text).toContain("\n");
    return fixed;
  }

  /** Its own width again: its typed line, measured, its left edge where it was. */
  async function ownWidth(): Promise<void> {
    await expect.poll(async () => (await element(board, "text")).autoResize).toBe(true);
    const auto = await element(board, "text");
    expect(auto.text).toBe(TEXT);
    expect(auto.width).toBeCloseTo(before.width, 0);
    expect(auto.x).toBeCloseTo(before.x, 1);
  }

  // "Enable text auto-resizing" (`actionTextAutoResize.ts@1118751f`), on a right click.
  const fixed = await narrow();
  const middle = await onPage(board, fixed.x + fixed.width / 2, fixed.y + fixed.height / 2);
  await page.mouse.click(middle.x, middle.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Enable text auto-resizing", exact: true }).click();
  await ownWidth();

  // The panel's Text wrap row, Grow.
  await narrow();
  await page
    .getByRole("complementary", { name: "Style inspector" })
    .getByRole("group", { name: "Text wrap" })
    .getByRole("button", { name: "Grow" })
    .click();
  await ownWidth();
});
