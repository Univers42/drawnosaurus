import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, focusBoard, openBoard, pickTool, regionInk, sceneElements } from "./board.ts";
import type { Board, SceneElement } from "./board.ts";

/**
 * A label is laid out as Excalidraw lays it out: wrapped inside its shape's text box,
 * the shape grown to hold it, in its own font family (`engine/.../text/layout.rs`,
 * `ci_text_model.rs`). This is the half a person sees — the editor they type into, the
 * canvas once they are done, the SVG they export.
 */

/** The dev handle's text methods, which `board.ts`'s shared declaration does not list. */
interface TextEngine {
  readonly camera: { x: number; y: number; scale: number };
  exportJson(): string;
  exportSvg(padding?: number): string | null;
  measureText(text: string, fontSize: number, family?: number): { width: number };
  setFontFamily(id: number): void;
  fontsLoaded(): void;
}

/** 160 × 80: small enough that every label below outgrows it. */
const SHAPE = {
  left: OPEN_CANVAS.left + 80,
  top: OPEN_CANVAS.top + 80,
  right: OPEN_CANVAS.left + 240,
  bottom: OPEN_CANVAS.top + 160,
};

const PADDING = 5;

/**
 * The width a label wraps at, per shape: `getBoundTextMaxWidth`
 * (`element/src/textElement.ts@1118751f:511-540`).
 */
const MAX_WIDTH: Record<string, (width: number) => number> = {
  rectangle: (width) => width - 2 * PADDING,
  ellipse: (width) => Math.round((width / 2) * Math.SQRT2) - 2 * PADDING,
  diamond: (width) => Math.round(width / 2) - 2 * PADDING,
};

const TEXT = "the quick brown fox jumps over the lazy dog and back again";

const editor = (board: Board): Locator => board.page.locator("textarea[aria-label='Text editor']");

async function drawShape(board: Board, tool: string): Promise<void> {
  const { page, box } = board;
  await pickTool(page, tool);
  await page.mouse.move(box.x + SHAPE.left, box.y + SHAPE.top);
  await page.mouse.down();
  await page.mouse.move(box.x + SHAPE.right, box.y + SHAPE.bottom, { steps: 8 });
  await page.mouse.up();
  await pickTool(page, "Select");
}

async function shapeAndLabel(page: Page): Promise<{ shape: SceneElement; label: SceneElement }> {
  const elements = await sceneElements(page);
  const shape = elements.find((element) => element.type !== "text");
  const label = elements.find((element) => element.type === "text");
  if (!shape || !label) throw new Error("expected a shape and its label");
  return { shape, label };
}

/** Double-clicks the middle of the shape, wherever the camera put it, for its label editor. */
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

/** Where the editor's text box is on the page, and whether its text runs past it. */
function textBox(node: Locator) {
  return node.evaluate((textarea) => {
    const style = getComputedStyle(textarea);
    const left =
      textarea.getBoundingClientRect().left + textarea.clientLeft + parseFloat(style.paddingLeft);
    const width =
      textarea.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return {
      left,
      right: left + width,
      width,
      overflows: textarea.scrollWidth > textarea.clientWidth,
    };
  });
}

/** The shape's box on the page, at the camera the engine holds. */
async function onPage(board: Board, shape: SceneElement) {
  const { x, scale } = await board.page.evaluate(() => window.__drawEngine!.camera);
  return {
    left: board.box.x + shape.x * scale + x,
    right: board.box.x + (shape.x + shape.width) * scale + x,
  };
}

for (const [tool, kind] of [
  ["Rectangle", "rectangle"],
  ["Ellipse", "ellipse"],
  ["Diamond", "diamond"],
] as const) {
  test(`a ${kind}'s label wraps inside it as it is typed and once committed`, async ({ page }) => {
    const board = await openBoard(page);
    await drawShape(board, tool);
    const node = await openLabelEditor(board);
    const drawn = (await shapeAndLabel(page)).shape;
    const maxWidth = MAX_WIDTH[kind]!(drawn.width);

    // Typed a key at a time, as a person does, and looked at half way through.
    const half = TEXT.slice(0, TEXT.length / 2);
    await page.keyboard.type(half);
    const typing = await textBox(node);
    const box = await onPage(board, drawn);
    expect(typing.width).toBeCloseTo(maxWidth, 0);
    expect(typing.overflows, "the editor's text runs past its box").toBe(false);
    expect(typing.left).toBeGreaterThanOrEqual(box.left);
    expect(typing.right).toBeLessThanOrEqual(box.right);

    await page.keyboard.type(TEXT.slice(half.length));
    expect((await textBox(node)).overflows).toBe(false);
    await page.keyboard.press("Control+Enter");
    await expect(editor(board)).toHaveCount(0);

    const { shape, label } = await shapeAndLabel(page);
    // Wrapped from what was typed, at the shape's text width, never wider.
    expect(label.text).toContain("\n");
    expect(label.text!.replace(/\n/g, " ")).toBe(TEXT);
    expect(label.width).toBeLessThanOrEqual(maxWidth + 0.5);
    // The shape grew to hold it, and holds it on every side.
    expect(shape.height).toBeGreaterThan(drawn.height);
    expect(shape.width).toBe(drawn.width);
    expect(label.x).toBeGreaterThanOrEqual(shape.x);
    expect(label.x + label.width).toBeLessThanOrEqual(shape.x + shape.width);
    expect(label.y).toBeGreaterThanOrEqual(shape.y);
    expect(label.y + label.height).toBeLessThanOrEqual(shape.y + shape.height);

    // And the canvas agrees: no ink beside the shape, where an overflowing line would be.
    // The click lets go of the label, whose selection frame and handles reach 4-5px past
    // the shape's edge; read the canvas once a frame has been painted without them.
    await focusBoard(board);
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    const { x, y, scale } = await page.evaluate(() => window.__drawEngine!.camera);
    const top = shape.y * scale + y;
    // A grown diamond runs off the bottom, and off the canvas every pixel reads as ink.
    const bottom = Math.min((shape.y + shape.height) * scale + y, board.box.height);
    const left = shape.x * scale + x;
    const right = (shape.x + shape.width) * scale + x;
    expect(await regionInk(page, { left: right + 4, right: right + 160, top, bottom })).toBe(0);
    expect(await regionInk(page, { left: left - 160, right: left - 4, top, bottom })).toBe(0);
  });
}

/** Whether the browser has loaded a face of `family` from `fonts.css`. */
function faceLoaded(page: Page, family: string): Promise<unknown> {
  return page.waitForFunction(
    (name) =>
      [...document.fonts].some(
        (face) => face.family.replace(/"/g, "") === name && face.status === "loaded",
      ),
    family,
  );
}

/** The widest of `lines` in `font`, measured on a canvas of its own. */
function widest(page: Page, lines: string[], font: string): Promise<number> {
  return page.evaluate(
    ({ lines, font }) => {
      const probe = document.createElement("canvas").getContext("2d")!;
      probe.font = font;
      return Math.max(...lines.map((line) => probe.measureText(line || " ").width));
    },
    { lines, font },
  );
}

test("a font family change re-wraps the label, and its font arriving re-lays it unstamped", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawShape(board, "Rectangle");
  // Narrow in a proportional face, as wide as any other letter in a monospaced one.
  const narrow = "iiii iiii iiii iiii iiii iiii iiii iiii";
  await (await openLabelEditor(board)).fill(narrow);
  await page.keyboard.press("Control+Enter");
  const before = await shapeAndLabel(page);
  const maxWidth = MAX_WIDTH.rectangle!(before.shape.width);

  // The family picker is a later package; the engine call is what it will make. Read in
  // the same task, so the label is as the change left it: laid out in the fallback,
  // since nothing had asked for Cascadia yet.
  const changed = await page.evaluate(() => {
    const engine = window.__drawEngine as unknown as TextEngine;
    const counted = window as unknown as { fontsLoadedCalls: number };
    counted.fontsLoadedCalls = 0;
    const loaded = engine.fontsLoaded.bind(engine);
    engine.fontsLoaded = () => {
      counted.fontsLoadedCalls += 1;
      loaded();
    };
    engine.setFontFamily(3);
    const label = JSON.parse(engine.exportJson()).elements.find(
      (element: SceneElement) => element.type === "text",
    );
    return { version: label.version as number, width: label.width as number };
  });

  const after = await shapeAndLabel(page);
  expect(after.label.text!.split("\n").length).toBeGreaterThan(
    before.label.text!.split("\n").length,
  );
  expect(after.label.text!.replace(/\n/g, " ")).toBe(narrow);
  expect(after.shape.height).toBeGreaterThan(before.shape.height);

  // Drawing in Cascadia asked the browser for it; once it is in, the page tells the
  // engine, which lays the label out again in the real face: other widths than the
  // fallback's, and not an edit.
  await faceLoaded(page, "Cascadia");
  await expect
    .poll(async () => Math.abs((await shapeAndLabel(page)).label.width - changed.width))
    .toBeGreaterThan(0.5);
  expect(
    await page.evaluate(() => (window as unknown as { fontsLoadedCalls: number }).fontsLoadedCalls),
  ).toBeGreaterThan(0);
  const settled = await shapeAndLabel(page);
  expect(settled.label.version).toBe(changed.version);
  const lines = settled.label.text!.split("\n");
  expect(settled.label.width).toBeCloseTo(await widest(page, lines, "20px Cascadia"), 1);
  for (const line of lines) {
    expect(await widest(page, [line], "20px Cascadia")).toBeLessThanOrEqual(maxWidth + 0.5);
  }
});

test("new text is written in Excalifont, and laid out in it once its face is in", async ({
  page,
}) => {
  const board = await openBoard(page);
  await page.mouse.dblclick(
    board.box.x + OPEN_CANVAS.left + 120,
    board.box.y + OPEN_CANVAS.top + 120,
  );
  await expect(editor(board)).toBeVisible();
  const words = "Hello Excalidraw";
  await page.keyboard.type(words);
  await page.keyboard.press("Control+Enter");
  await expect(editor(board)).toHaveCount(0);

  const text = await page.evaluate(() =>
    JSON.parse(window.__drawEngine!.exportJson()).elements.find(
      (element: SceneElement) => element.type === "text",
    ),
  );
  expect(text.fontFamily).toBe(5);

  // The face is served, and the browser has it: the text measures as Excalifont does,
  // not as `sans-serif`, the next name in its stack.
  await faceLoaded(page, "Excalifont");
  const excalifont = await widest(page, [words], "20px Excalifont");
  const fallback = await widest(page, [words], "20px sans-serif");
  expect(Math.abs(excalifont - fallback)).toBeGreaterThan(1);
  await expect
    .poll(async () => (await sceneElements(page)).find((el) => el.type === "text")!.width)
    .toBeCloseTo(excalifont, 1);
});

test("the SVG export draws each label line in its family, inside its shape", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board, "Rectangle");
  await (await openLabelEditor(board)).fill(TEXT);
  await page.keyboard.press("Control+Enter");
  const { label } = await shapeAndLabel(page);

  const exported = await page.evaluate(() => {
    const engine = window.__drawEngine as unknown as TextEngine;
    const holder = document.createElement("div");
    holder.innerHTML = engine.exportSvg() ?? "";
    document.body.append(holder);
    const svg = holder.querySelector("svg")!;
    // The first rect is the background; the second is the shape.
    const shape = svg.querySelectorAll("rect")[1]!.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")].map((text) => {
      const box = text.getBoundingClientRect();
      return {
        content: text.textContent,
        family: text.getAttribute("font-family"),
        left: box.left,
        right: box.right,
      };
    });
    holder.remove();
    return { shape: { left: shape.left, right: shape.right }, texts };
  });

  expect(exported.texts.map((text) => text.content)).toEqual(label.text!.split("\n"));
  for (const text of exported.texts) {
    // New text is Excalifont, as in Excalidraw, with its fallbacks.
    expect(text.family).toMatch(/^Excalifont, /);
    expect(text.left).toBeGreaterThanOrEqual(exported.shape.left);
    expect(text.right).toBeLessThanOrEqual(exported.shape.right);
  }
});
