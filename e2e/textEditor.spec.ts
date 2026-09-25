import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  activeTool,
  camera,
  focusBoard,
  OPEN_CANVAS,
  openBoard,
  pickTool,
  regionInk,
  sceneElements,
  selection,
  shownZoomPercent,
  type Board,
  type SceneElement,
} from "./board.ts";
import { writeText } from "./textBoard.ts";

/**
 * Typing a text: what is typed is on screen once, where and as the canvas will draw it.
 *
 * Reported: a second copy of the text sat beside the one being typed, in another size, and
 * jumped on commit. The canvas now leaves the text being typed to the editor, which is a
 * bare textarea in the text's own font, scaled and turned by the camera onto the box the
 * engine lays it out in (`engine/text_session.rs`, `textEditor.ts`), as Excalidraw's
 * `textWysiwyg` is (`packages/excalidraw/wysiwyg/textWysiwyg.tsx@1118751f`).
 */

/** 240 × 80, well inside `OPEN_CANVAS` so no floating panel covers it. */
const SHAPE = {
  left: OPEN_CANVAS.left + 120,
  top: OPEN_CANVAS.top + 120,
  right: OPEN_CANVAS.left + 360,
  bottom: OPEN_CANVAS.top + 200,
};

const editor = (page: Page): Locator => page.locator("textarea[aria-label='Text editor']");

async function drawShape(board: Board, shape = SHAPE): Promise<void> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + shape.left, box.y + shape.top);
  await page.mouse.down();
  await page.mouse.move(box.x + shape.right, box.y + shape.bottom, { steps: 8 });
  await page.mouse.up();
  await pickTool(page, "Select");
}

async function byType(page: Page, type: "text" | "rectangle"): Promise<SceneElement> {
  const found = (await sceneElements(page)).find((element) => element.type === type);
  if (!found) throw new Error(`no ${type} on the board`);
  return found;
}

/** An element's unrotated box on the canvas, at the camera the engine holds. */
async function onCanvas(page: Page, element: SceneElement) {
  const { x, y, scale } = await camera(page);
  return {
    left: element.x * scale + x,
    top: element.y * scale + y,
    right: (element.x + element.width) * scale + x,
    bottom: (element.y + element.height) * scale + y,
  };
}

/** Double-clicks the middle of the shape, wherever the camera put it. */
async function openLabel(board: Board): Promise<Locator> {
  const box = await onCanvas(board.page, await byType(board.page, "rectangle"));
  await board.page.mouse.dblclick(
    board.box.x + (box.left + box.right) / 2,
    board.box.y + (box.top + box.bottom) / 2,
  );
  await expect(editor(board.page)).toBeFocused();
  return editor(board.page);
}

/** Two painted frames, so the canvas shows the state the last call left. */
function painted(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

test("the text being typed is on screen once: the editor's, not also the canvas's", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawShape(board);
  await openLabel(board);
  await page.keyboard.type("Hello there");
  await painted(page);

  const label = await onCanvas(page, await byType(page, "text"));
  expect(label.right - label.left, "the label was laid out as it was typed").toBeGreaterThan(40);
  expect(await regionInk(page, label), "the canvas painted it under the editor").toBe(0);
  await expect(editor(page)).toHaveValue("Hello there");

  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await painted(page);
  expect(await regionInk(page, label), "and it is the canvas's once committed").toBeGreaterThan(
    0.02,
  );
});

test("the editor is the text's own box, in world units, scaled and moved by the camera", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawShape(board);
  await page.getByRole("button", { name: /^Zoom in/ }).click();
  await expect.poll(() => shownZoomPercent(page)).toBeGreaterThan(100);
  const node = await openLabel(board);
  await page.keyboard.type("Hi");

  const check = async () => {
    const { scale } = await camera(page);
    const label = await onCanvas(page, await byType(page, "text"));
    const style = await node.evaluate((textarea) => {
      const computed = getComputedStyle(textarea);
      const rect = textarea.getBoundingClientRect();
      return {
        fontSize: computed.fontSize,
        transform: computed.transform,
        left: rect.left,
        top: rect.top,
      };
    });
    // 20 units, not 20 × zoom px: the scale is the transform's.
    expect(style.fontSize).toBe("20px");
    expect(Number(style.transform.match(/matrix\(([^,]+)/)?.[1])).toBeCloseTo(scale, 3);
    expect(style.left - board.box.x).toBeCloseTo(label.left, 0);
    expect(style.top - board.box.y).toBeCloseTo(label.top, 0);
  };
  await check();

  // Zoomed from the keyboard while typing, and panned: it stays on the text.
  await page.keyboard.press("Control+=");
  await expect(editor(page), "the zoom key ended the edit").toBeFocused();
  await check();
  const before = (await camera(page)).y;
  await page.mouse.move(
    board.box.x + OPEN_CANVAS.right - 40,
    board.box.y + OPEN_CANVAS.bottom - 40,
  );
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await camera(page)).y).not.toBe(before);
  await check();
});

test("the shape grows as its label is typed and shrinks back, no further than it was", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawShape(board);
  const start = (await byType(page, "rectangle")).height;
  await openLabel(board);

  for (const line of ["one", "two", "three", "four"]) {
    await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  }
  // Grown while typing — before any commit, which is what an autosave would see.
  const grown = (await byType(page, "rectangle")).height;
  expect(grown).toBeGreaterThan(start);
  const label = await byType(page, "text");
  expect(label.text).toBe("one\ntwo\nthree\nfour\n");

  await page.keyboard.press("Control+a");
  await page.keyboard.type("one");
  expect((await byType(page, "rectangle")).height).toBe(start);
  await page.keyboard.press("Control+Enter");
  expect((await byType(page, "rectangle")).height).toBe(start);
});

test("Escape keeps what was typed, leaves the shape selected, and Enter opens it again", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawShape(board);
  await openLabel(board);
  await page.keyboard.type("Kept");
  await page.keyboard.press("Escape");

  await expect(editor(page)).toHaveCount(0);
  expect((await byType(page, "text")).text).toBe("Kept");
  expect(await selection(page)).toEqual([(await byType(page, "rectangle")).id]);
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Kept");
});

test("Tab indents the line and Shift+Tab takes it back, the editor keeping the keys", async ({
  page,
}) => {
  const board = await openBoard(page);
  await page.mouse.dblclick(
    board.box.x + OPEN_CANVAS.left + 200,
    board.box.y + OPEN_CANVAS.top + 200,
  );
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("one");
  await page.keyboard.press("Tab");
  await expect(editor(page)).toHaveValue("    one");
  await expect(editor(page)).toBeFocused();
  expect((await byType(page, "text")).text).toBe("    one");
  await page.keyboard.press("Shift+Tab");
  await expect(editor(page)).toHaveValue("one");
});

test("letters typed are text, never a tool, a picker or a style", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);
  await openLabel(board);
  // S and G open the colour pickers, the digits and letters pick tools, ? the shortcuts.
  const typed = "sgrdoa1234?[x]";
  await page.keyboard.type(typed);

  await expect(editor(page)).toHaveValue(typed);
  await expect(editor(page)).toBeFocused();
  expect(await activeTool(page)).toBe("select");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await byType(page, "text")).text).toBe(typed);
});

test("a turned shape's label is typed turned with it", async ({ page }) => {
  const board = await openBoard(page);
  const shape = {
    id: "turned",
    type: "rectangle",
    x: 600,
    y: 300,
    width: 240,
    height: 100,
    angle: Math.PI / 6,
    strokeColor: "#1e1e1e",
    backgroundColor: "#ffc9c9",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 0,
    isDeleted: false,
    groupIds: [],
  };
  await page.evaluate((element) => {
    const engine = window.__drawEngine!;
    engine.loadScene(JSON.stringify({ type: "osidraw", version: 1, elements: [element] }));
  }, shape);
  const { x, y, scale } = await camera(page);
  const middle = { x: (600 + 120) * scale + x, y: (300 + 50) * scale + y };
  await page.mouse.dblclick(board.box.x + middle.x, board.box.y + middle.y);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("turned");

  const drawn = await editor(page).evaluate((textarea) => {
    const [a, b] = getComputedStyle(textarea)
      .transform.match(/-?[\d.e-]+/g)!
      .map(Number);
    const rect = textarea.getBoundingClientRect();
    return {
      angle: Math.atan2(b!, a!),
      middle: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    };
  });
  expect(drawn.angle).toBeCloseTo(Math.PI / 6, 3);
  // Turned about the shape's middle, as the canvas turns the label.
  expect(Math.abs(drawn.middle.x - (board.box.x + middle.x))).toBeLessThan(2);
  expect(Math.abs(drawn.middle.y - (board.box.y + middle.y))).toBeLessThan(2);
});

test("a click on a label selects its shape", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);
  await openLabel(board);
  await page.keyboard.type("Label");
  await page.keyboard.press("Escape");
  await focusBoard(board);
  expect(await selection(page)).toEqual([]);

  // The middle of a shape with no fill, off its outline: only the label is there.
  const label = await onCanvas(page, await byType(page, "text"));
  await page.mouse.click(
    board.box.x + (label.left + label.right) / 2,
    board.box.y + (label.top + label.bottom) / 2,
  );
  expect(await selection(page)).toEqual([(await byType(page, "rectangle")).id]);

  // And so does a right-click, which opens the menu on what it selects
  // (`openContextMenu`, `App.tsx@1118751f:13276-13279`).
  await page.keyboard.press("Escape");
  await focusBoard(board);
  await page.mouse.click(
    board.box.x + (label.left + label.right) / 2,
    board.box.y + (label.top + label.bottom) / 2,
    { button: "right" },
  );
  expect(await selection(page)).toEqual([(await byType(page, "rectangle")).id]);
});

test("the opacity slider restyles the text being typed, which stays open", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);
  const node = await openLabel(board);
  await page.keyboard.type("Half");
  // A slider takes no typing, so the oracle keeps the edit open for it
  // (`isWritableElement`, `packages/common/src/utils.ts@1118751f:99-118`).
  const slider = page.getByRole("slider", { name: "Opacity" });
  const track = (await slider.boundingBox())!;
  await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2);

  await expect(node).toBeFocused();
  const chosen = Number(await slider.inputValue());
  expect(chosen).toBeLessThan(100);
  await page.keyboard.type(" there");
  await page.keyboard.press("Escape");
  const label = await byType(page, "text");
  expect(label.text).toBe("Half there");
  expect(label.opacity).toBe(chosen);
});

test("Undo while typing ends the edit, then undoes it, as the oracle's does", async ({ page }) => {
  const board = await openBoard(page);
  await drawShape(board);
  await openLabel(board);
  await page.keyboard.type("one");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(" two");

  // Undo sits beside the zoom buttons, outside them (`Footer.tsx@1118751f:48-62`).
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(editor(page)).toHaveCount(0);
  expect((await byType(page, "text")).text).toBe("one");
  await page.getByRole("button", { name: /^Redo/ }).click();
  expect((await byType(page, "text")).text).toBe("one two");
});

test("a colour picked in the panel restyles the text being typed, which stays open", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawShape(board);
  const node = await openLabel(board);
  await page.keyboard.type("Red");
  await page.getByRole("button", { name: "#e03131", exact: true }).first().click();

  await expect(node).toBeFocused();
  await expect(node).toHaveCSS("color", "rgb(224, 49, 49)");
  await page.keyboard.type("der");
  await page.keyboard.press("Escape");
  const label = await byType(page, "text");
  expect(label.text).toBe("Redder");
  expect(label.strokeColor).toBe("#e03131");
});

test("the colour picker closed while typing gives the keys back to the typing", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawShape(board);
  const node = await openLabel(board);
  await page.keyboard.type("Red");
  await page.getByRole("button", { name: "Stroke", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Stroke colour picker" });
  await expect(picker).toBeVisible();
  // Everything the press on the panel left pending has run: the keys come back when the
  // picker closes, not because a press ended while it was open.
  await painted(page);
  // The picker has the keys while it is open: B is red.
  await page.keyboard.press("b");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  // Back to typing, as the oracle's editor takes the focus back
  // (`textWysiwyg.tsx@1118751f:1008-1016`) — not to the board, where "e" is the eraser.
  await expect(node).toBeFocused();
  await page.keyboard.type("der");
  await expect(node).toHaveValue("Redder");
  await page.keyboard.press("Escape");
  const label = await byType(page, "text");
  expect(label.text).toBe("Redder");
  expect(label.strokeColor).toBe("#e03131");
  expect(await activeTool(page)).toBe("select");
});

test("with the text tool kept, a press on the board only ends the edit", async ({ page }) => {
  const board = await openBoard(page);
  await pickTool(page, "Text");
  await page.getByRole("button", { name: /^Keep tool active after drawing/ }).click();
  const at = { x: board.box.x + OPEN_CANVAS.left + 200, y: board.box.y + OPEN_CANVAS.top + 200 };
  await page.mouse.click(at.x, at.y);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("one");

  await page.mouse.click(at.x + 200, at.y + 100);
  await expect(editor(page)).toHaveCount(0);
  const texts = (await sceneElements(page)).filter((element) => element.type === "text");
  expect(texts.map((text) => text.text)).toEqual(["one"]);

  // The next press starts one, the tool being kept.
  await page.mouse.click(at.x + 200, at.y + 100);
  await expect(editor(page)).toBeFocused();
});

test("a new text's first line is centred on the point it was started at", async ({ page }) => {
  const board = await openBoard(page);
  await pickTool(page, "Text");
  const at = { x: OPEN_CANVAS.left + 200, y: OPEN_CANVAS.top + 200 };
  await page.mouse.click(board.box.x + at.x, board.box.y + at.y);
  await page.keyboard.type("Hi");
  await page.keyboard.press("Escape");

  const text = await onCanvas(page, await byType(page, "text"));
  // One 20px line of Excalifont is 25 tall (`App.tsx@1118751f:7019-7027`).
  expect(text.top).toBeCloseTo(at.y - 12.5, 0);
  expect(text.left).toBeCloseTo(at.x, 0);
});

test("a new text is snapped to the grid when the grid is on", async ({ page }) => {
  const board = await openBoard(page);
  await page.evaluate(() => window.__drawEngine!.setGrid({ enabled: true }));
  await pickTool(page, "Text");
  const at = { x: OPEN_CANVAS.left + 203, y: OPEN_CANVAS.top + 197 };
  await page.mouse.click(board.box.x + at.x, board.box.y + at.y);
  await page.keyboard.type("Hi");
  await page.keyboard.press("Escape");

  const grid = await page.evaluate(() => window.__drawEngine!.getGrid());
  const text = await onCanvas(page, await byType(page, "text"));
  expect(text.left % grid.size).toBeCloseTo(0, 0);
  expect(text.top % grid.size).toBeCloseTo(0, 0);
});

test("a click on a text that was already the sole selection opens the caret there", async ({
  page,
}) => {
  const board = await openBoard(page);
  await pickTool(page, "Text");
  const at = { x: OPEN_CANVAS.left + 200, y: OPEN_CANVAS.top + 200 };
  await page.mouse.click(board.box.x + at.x, board.box.y + at.y);
  await page.keyboard.type("hello");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);

  // Reopening from scratch — Enter, same as every other entry point — selects it all.
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  const whole = await editor(page).evaluate((n) => [
    (n as HTMLTextAreaElement).selectionStart,
    (n as HTMLTextAreaElement).selectionEnd,
  ]);
  expect(whole).toEqual([0, 5]);
  await page.keyboard.press("Escape");

  // A click on it, already the sole selection, opens at the click instead
  // (`getCaretIndexFromInitialSceneCoords`, `textWysiwyg.tsx@1118751f:491-538`).
  const box = await onCanvas(page, await byType(page, "text"));
  await page.mouse.click(board.box.x + (box.left + box.right) / 2, board.box.y + box.top + 5);
  await expect(editor(page)).toBeFocused();
  const caret = await editor(page).evaluate((n) => [
    (n as HTMLTextAreaElement).selectionStart,
    (n as HTMLTextAreaElement).selectionEnd,
  ]);
  expect(caret[0]).toBe(caret[1]);
  expect(caret[0]).toBeGreaterThan(0);
  expect(caret[0]).toBeLessThan(5);
});

test("a fixed-width text shows its box outline while it is typed, an auto-sizing one none", async ({
  page,
}) => {
  const board = await openBoard(page);
  const fixed = {
    id: "fixed",
    type: "text",
    x: OPEN_CANVAS.left + 100,
    y: OPEN_CANVAS.top + 100,
    width: 160,
    height: 25,
    angle: 0,
    text: "",
    fontSize: 20,
    textAlign: "left",
    verticalAlign: "top",
    autoResize: false,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 0,
    isDeleted: false,
    groupIds: [],
  };
  await page.evaluate((element) => {
    window.__drawEngine!.loadScene(
      JSON.stringify({ type: "osidraw", version: 1, elements: [element] }),
    );
  }, fixed);

  const box = await onCanvas(page, await byType(page, "text"));
  await page.mouse.dblclick(
    board.box.x + (box.left + box.right) / 2,
    board.box.y + (box.top + box.bottom) / 2,
  );
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveClass(/boxed/);
  await expect(editor(page)).toHaveCSS("outline-style", "dashed");
  await page.keyboard.press("Escape");

  // The common case — a text that grows with what is typed — has none: its own edges are
  // already the box.
  await pickTool(page, "Text");
  await page.mouse.click(board.box.x + OPEN_CANVAS.left + 400, board.box.y + OPEN_CANVAS.top + 300);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).not.toHaveClass(/boxed/);
});

/**
 * The confirming Enter, Tab and Escape belong to the IME's composition, not to the
 * editor's own bindings for those keys, or a still-composing word is cut in two by the
 * key that was meant to keep composing it. Driven through CDP because that is the only
 * way to raise a real `isComposing`/keyCode-229 keydown — a dispatched event is the
 * documented exception here, as `Input.dispatchKeyEvent` already is for Alt+S in
 * `objectsSnap.spec.ts`, for the same reason: the browser is the only thing that can
 * produce it.
 */
test("Ctrl/Cmd+Enter, Tab and Escape are held while an IME composes, and act once it commits", async ({
  page,
}) => {
  const board = await openBoard(page);
  await pickTool(page, "Text");
  const at = { x: OPEN_CANVAS.left + 200, y: OPEN_CANVAS.top + 200 };
  await page.mouse.click(board.box.x + at.x, board.box.y + at.y);
  await expect(editor(page)).toBeFocused();

  const cdp = await page.context().newCDPSession(page);
  const compose = () =>
    cdp.send("Input.imeSetComposition", { text: "n", selectionStart: 1, selectionEnd: 1 });
  const dispatch = async (key: string, windowsVirtualKeyCode: number, modifiers = 0) => {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode,
      modifiers,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode,
      modifiers,
    });
  };

  // Ctrl+Enter mid-composition: held, so the edit stays open under it.
  await compose();
  await dispatch("Enter", 13, 2 /* Ctrl */);
  await expect(editor(page)).toHaveCount(1);
  await expect(editor(page)).toBeFocused();

  // Tab mid-composition: held, so it is not four spaces.
  await compose();
  await dispatch("Tab", 9);
  await expect(editor(page)).not.toHaveValue(/^ {4}/);

  // Escape mid-composition: held too — an IME's own Escape cancels its composition, and
  // must not also end the whole edit out from under it.
  await compose();
  await dispatch("Escape", 27);
  await expect(editor(page)).toHaveCount(1);

  // The control: once the IME commits — `Input.insertText`, the same way a real one
  // finalises a still-open composition — the same keys do what they always did. Without
  // this the three checks above would just as well pass for keys that are simply broken.
  await cdp.send("Input.insertText", { text: "ん" });
  await expect(editor(page)).toHaveValue("ん");
  await dispatch("Tab", 9);
  await expect(editor(page)).toHaveValue("    ん");
  await dispatch("Escape", 27);
  await expect(editor(page)).toHaveCount(0);
  expect((await byType(page, "text")).text).toBe("    ん");
});

test("pasting this board's own clipboard JSON inserts the elements' text, not the JSON", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawShape(board);
  await openLabel(board);
  await page.keyboard.type("shape label");
  await page.keyboard.press("Control+Enter");
  await writeText(board, { x: 950, y: 300 }, "free words");

  // Everything on the board — a shape with a label, and a separate free text — copied.
  await focusBoard(board);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  const json = await page.evaluate(() => window.__drawEngine!.copySelection());
  expect(json).toBeTruthy();

  // A fresh, empty text editor: pasting into it must not fall through to the canvas's
  // own paste listener, which owns anything not landing in a field
  // (`DrawSurface.svelte` › `onChromePaste`, `isOwnedElsewhere`).
  const before = new Set((await sceneElements(page)).map((existing) => existing.id));
  await page.mouse.dblclick(
    board.box.x + OPEN_CANVAS.left + 60,
    board.box.y + OPEN_CANVAS.bottom - 60,
  );
  await expect(editor(page)).toBeFocused();

  // Dispatched: a real paste reads the system clipboard, which a headless browser does
  // not share with the test (`e2e/image.spec.ts`). The event is the one the browser
  // would deliver, carrying what Ctrl+C above put there.
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(data, "text/plain");
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
  }, json!);

  await expect(editor(page)).toHaveValue(/shape label/);
  await expect(editor(page)).toHaveValue(/free words/);
  const value = await editor(page).inputValue();
  expect(value, "not the raw clipboard JSON").not.toContain("osidraw");
  expect(value, "not the raw clipboard JSON").not.toContain("{");

  await page.keyboard.press("Control+Enter");
  // The text just made — not the shape's label or the earlier free text, both also
  // `type: "text"` and both still holding a copy of the words just pasted.
  const pasted = (await sceneElements(page)).find((el) => el.type === "text" && !before.has(el.id));
  expect(pasted?.text).toBe(value);
});
