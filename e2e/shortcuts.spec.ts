import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  activeTool,
  camera,
  clickElement,
  focusBoard,
  listenForPicker,
  openBoard,
  OPEN_CANVAS,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * Keyboard shortcuts, through a real browser and a real keyboard.
 *
 * One test per line of `prompt/shortkey.md`'s essential and navigation sections, named
 * after what the line promises. The engine's own suite
 * (`engine/crates/draw-engine/tests/ci_shortcuts.rs`) already pins the table against
 * Excalidraw's; what those tests cannot see is whether a key press ever *reaches* it —
 * the listener is on the editor container, the host dispatches modifiers itself, and a
 * shortcut can be shadowed by the browser, by a panel, or by a second listener.
 *
 * That last one is not hypothetical here: `9` used to select the sticky note and open the
 * image picker in the same keystroke, because `preventDefault` does not stop the engine's
 * own listener.
 */

/**
 * A rectangle drawn by hand, for the shortcuts that need something to act on.
 *
 * The tool is picked every time: it reverts to select after each shape unless the lock is
 * on, so a second call that skipped this would drag a marquee instead of drawing.
 */
async function drawRectangle(
  page: Page,
  board: Board,
  from = { x: 520, y: 240 },
  to = { x: 800, y: 460 },
): Promise<void> {
  await page.getByRole("button", { name: /^Rectangle \(/ }).click();
  await page.mouse.move(board.box.x + from.x, board.box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(board.box.x + to.x, board.box.y + to.y, { steps: 6 });
  await page.mouse.up();
  // Asserted here rather than left to fail three lines later in whatever test called
  // this: a drag that lands nowhere leaves an empty scene, and the error that follows is
  // an undefined property read that says nothing about the gesture.
  await expect
    .poll(async () => (await sceneElements(page)).length, { timeout: 2_000 })
    .toBeGreaterThan(0);
}

test.describe("tool shortcuts", () => {
  // Excalidraw's table, letter and digit. Each row is one line of the cheat sheet.
  const LETTERS: [string, string][] = [
    ["v", "select"],
    ["r", "rectangle"],
    ["d", "diamond"],
    ["o", "ellipse"],
    ["a", "arrow"],
    ["l", "line"],
    ["p", "freedraw"],
    ["x", "freedraw"],
    ["t", "text"],
    ["e", "eraser"],
    ["h", "hand"],
    ["f", "frame"],
    ["k", "laser"],
    ["b", "bucketfill"],
  ];

  for (const [key, tool] of LETTERS) {
    test(`${key.toUpperCase()} selects ${tool}`, async ({ page }) => {
      const board = await openBoard(page);
      await focusBoard(board);
      // Away from the target first, so a test cannot pass because the tool was already
      // active — `select` is where the board starts, and it is in this list.
      await page.keyboard.press("r");
      if (tool === "rectangle") await page.keyboard.press("o");

      await page.keyboard.press(key);

      expect(await activeTool(page)).toBe(tool);
    });
  }

  const DIGITS: [string, string][] = [
    ["1", "select"],
    ["2", "rectangle"],
    ["3", "diamond"],
    ["4", "ellipse"],
    ["5", "arrow"],
    ["6", "line"],
    ["7", "freedraw"],
    ["8", "text"],
    ["9", "image"],
    ["0", "eraser"],
  ];

  for (const [key, tool] of DIGITS) {
    test(`${key} selects ${tool}`, async ({ page }) => {
      const board = await openBoard(page);
      await focusBoard(board);
      await page.keyboard.press("l");
      // The image tool opens the file picker, and a picker nobody answers is dismissed
      // at once by a headless browser — which, correctly, puts the tool back to Select.
      // Listening holds it open, as a person choosing a file does.
      const listening = key === "9" ? await listenForPicker(page) : null;

      await page.keyboard.press(key);

      await listening?.opened;
      expect(await activeTool(page)).toBe(tool);
    });
  }

  test("Shift+X selects draw-to-shape, where X alone is freehand", async ({ page }) => {
    // The one chord in the table, and the reason the keymap takes a modifier at all.
    const board = await openBoard(page);
    await focusBoard(board);

    await page.keyboard.press("x");
    expect(await activeTool(page)).toBe("freedraw");

    await page.keyboard.press("Shift+X");
    expect(await activeTool(page)).toBe("autoshape");
  });

  test("a tool shortcut works with caps lock on", async ({ page }) => {
    // Excalidraw made tool keys case-insensitive; a keyboard sends "R" with shift down.
    const board = await openBoard(page);
    await focusBoard(board);

    await page.keyboard.press("Shift+R");

    expect(await activeTool(page)).toBe("rectangle");
  });

  test("pressing E twice goes back to the tool it interrupted", async ({ page }) => {
    // The eraser is a toggle tool. You are drawing rectangles, you rub something out, and
    // you want to be drawing rectangles again — without the return trip that costs a
    // second keystroke and you have to remember what you were holding.
    const board = await openBoard(page);
    await focusBoard(board);

    await page.keyboard.press("r");
    await page.keyboard.press("e");
    expect(await activeTool(page)).toBe("eraser");

    await page.keyboard.press("e");
    expect(await activeTool(page)).toBe("rectangle");
  });

  test("pressing H twice goes back to the tool it interrupted", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);

    await page.keyboard.press("a");
    await page.keyboard.press("h");
    expect(await activeTool(page)).toBe("hand");

    await page.keyboard.press("h");
    expect(await activeTool(page)).toBe("arrow");
  });

  test("a tool that does not toggle stays put when its key is pressed again", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);

    await page.keyboard.press("r");
    await page.keyboard.press("r");

    expect(await activeTool(page)).toBe("rectangle");
  });

  test("the toolbar badge prints the key that actually works", async ({ page }) => {
    // A badge advertising a key the engine ignores is worse than no badge: it is where
    // someone goes to *learn* the shortcut. Autoshape printed `G` for exactly as long as
    // the engine's keymap could not express a modifier.
    await openBoard(page);
    await page.getByRole("button", { name: /^More tools/ }).click();

    const autoshape = page.getByRole("menuitemradio", { name: /Draw to shape/ });
    await expect(autoshape).toContainText("⇧X");
  });
});

test.describe("navigation shortcuts", () => {
  test("Ctrl+= zooms in and Ctrl+- zooms out", async ({ page }) => {
    // Zoom eases over 250ms (`CAMERA_ZOOM_MS`); reduced motion lands each step in one
    // frame so two reads back to back compare settled values, not a moving target.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const board = await openBoard(page);
    await focusBoard(board);
    const start = (await camera(page)).scale;

    await page.keyboard.press("Control+Equal");
    const zoomedIn = (await camera(page)).scale;
    expect(zoomedIn).toBeGreaterThan(start);

    await page.keyboard.press("Control+Minus");
    expect((await camera(page)).scale).toBeLessThan(zoomedIn);
  });

  test("Ctrl+0 resets the zoom to 100%", async ({ page }) => {
    // Same as above: a settled read after each key, not one mid-ease.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const board = await openBoard(page);
    await focusBoard(board);
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");
    expect((await camera(page)).scale).toBeGreaterThan(1);

    await page.keyboard.press("Control+0");

    expect((await camera(page)).scale).toBeCloseTo(1, 5);
  });

  test("Shift+1 zooms to fit the content", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);
    // Somewhere the shape plainly is not.
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");

    await page.keyboard.press("Shift+Digit1");

    const after = await camera(page);
    // The shape's centre should now be near the middle of the viewport.
    const centre = await page.evaluate(() => {
      const element = JSON.parse(window.__drawEngine!.exportJson()).elements[0];
      const engine = window.__drawEngine!;
      const { x, y, scale } = engine.camera;
      return {
        sx: (element.x + element.width / 2) * scale + x,
        sy: (element.y + element.height / 2) * scale + y,
      };
    });
    expect(centre.sx).toBeGreaterThan(board.box.width * 0.3);
    expect(centre.sx).toBeLessThan(board.box.width * 0.7);
    expect(centre.sy).toBeGreaterThan(board.box.height * 0.3);
    expect(centre.sy).toBeLessThan(board.box.height * 0.7);
    expect(after.scale).toBeGreaterThan(0);
  });

  test("Shift+2 zooms to the selection rather than the board", async ({ page }) => {
    // The whole point of having it as well as Shift+1: a fit has to hold every shape, so
    // the one you are working on ends up as small as the furthest stray one allows.
    const board = await openBoard(page);
    // Two shapes far apart, so fitting both is much further out than framing one. The
    // tool reverts to select after each shape unless it is locked, so the second gesture
    // needs the tool picked again — without that it is a marquee drag, the board holds
    // one element, and fit and zoom-to-selection agree exactly.
    await drawRectangle(page, board, { x: 460, y: 190 }, { x: 560, y: 260 });
    await drawRectangle(page, board, { x: 1000, y: 540 }, { x: 1140, y: 640 });
    expect(await sceneElements(page)).toHaveLength(2);
    await focusBoard(board);

    await page.keyboard.press("Shift+Digit1");
    const fitted = (await camera(page)).scale;

    await page.getByRole("button", { name: /^Select \(/ }).click();
    await clickElement(board, 0);
    expect(await selection(page)).toHaveLength(1);

    await page.keyboard.press("Shift+Digit2");

    expect((await camera(page)).scale).toBeGreaterThan(fitted);
  });

  test("Shift+2 with nothing selected leaves the camera alone", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);
    await page.keyboard.press("Escape");
    const before = await camera(page);

    await page.keyboard.press("Shift+Digit2");

    expect(await camera(page)).toEqual(before);
  });

  test("Page Down moves a screenful, Page Up brings it back", async ({ page }) => {
    // Paging keeps a strip of the outgoing view, so the two presses are not a whole
    // viewport each — but down then up has to land exactly where it started, or reading
    // a long board and coming back leaves you somewhere you did not choose.
    const board = await openBoard(page);
    await focusBoard(board);
    const before = await camera(page);

    await page.keyboard.press("PageDown");
    const paged = await camera(page);
    expect(before.y - paged.y).toBeGreaterThan(board.box.height * 0.5);
    expect(before.y - paged.y).toBeLessThan(board.box.height);
    expect(paged.x).toBeCloseTo(before.x, 5);

    await page.keyboard.press("PageUp");
    expect((await camera(page)).y).toBeCloseTo(before.y, 5);
  });

  test("Shift+Page Down pages sideways", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    const before = await camera(page);

    await page.keyboard.press("Shift+PageDown");

    const after = await camera(page);
    expect(before.x - after.x).toBeGreaterThan(board.box.width * 0.5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  test("Space+drag pans without changing the tool", async ({ page }) => {
    // The point of the gesture: pan in the middle of drawing and carry on drawing. If it
    // left you on the hand tool it would be no better than pressing H.
    const board = await openBoard(page);
    await focusBoard(board);
    await page.keyboard.press("r");
    const before = await camera(page);

    await page.keyboard.down("Space");
    await page.mouse.move(board.box.x + 700, board.box.y + 400);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 780, board.box.y + 460, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Space");

    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x + 80, 0);
    expect(after.y).toBeCloseTo(before.y + 60, 0);
    expect(await activeTool(page)).toBe("rectangle");
    expect(await sceneElements(page)).toHaveLength(0);
  });
});

test.describe("selection and editing shortcuts", () => {
  test("Ctrl+A selects everything", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);

    await page.keyboard.press("Control+a");

    expect(await selection(page)).toHaveLength(1);
  });

  test("Escape clears the selection", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);
    await page.keyboard.press("Control+a");
    expect(await selection(page)).toHaveLength(1);

    await page.keyboard.press("Escape");

    expect(await selection(page)).toHaveLength(0);
  });

  test("Delete removes the selection", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);
    await page.keyboard.press("Control+a");

    await page.keyboard.press("Delete");

    expect(await sceneElements(page)).toHaveLength(0);
  });

  test("Ctrl+Z undoes and Ctrl+Shift+Z redoes", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);
    expect(await sceneElements(page)).toHaveLength(1);

    await page.keyboard.press("Control+z");
    expect(await sceneElements(page)).toHaveLength(0);

    await page.keyboard.press("Control+Shift+z");
    expect(await sceneElements(page)).toHaveLength(1);
  });

  test("Ctrl+D duplicates the selection", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);
    await page.keyboard.press("Control+a");

    await page.keyboard.press("Control+d");

    expect(await sceneElements(page)).toHaveLength(2);
  });

  test("an arrow key nudges the selection by one point", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);
    await page.keyboard.press("Control+a");
    const before = (await sceneElements(page))[0] as unknown as { x: number; y: number };

    await page.keyboard.press("ArrowRight");

    const after = (await sceneElements(page))[0] as unknown as { x: number; y: number };
    expect(after.x).toBeCloseTo(before.x + 1, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  test("Shift+arrow nudges by a larger step", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await focusBoard(board);
    await page.keyboard.press("Control+a");
    const before = (await sceneElements(page))[0] as unknown as { x: number };

    await page.keyboard.press("Shift+ArrowRight");

    const after = (await sceneElements(page))[0] as unknown as { x: number };
    expect(after.x).toBeGreaterThan(before.x + 1);
  });
});

test.describe("the board keeps its keys to itself", () => {
  test("no shortcut fires twice for one key press", async ({ page }) => {
    // `preventDefault` does not stop a second listener on the same key, and this board has
    // two: the engine's on the canvas and the host's on the container. `9` once selected
    // the sticky note *and* opened the image picker in a single keystroke.
    // Counted at the source. Chromium folds two picker opens in one keystroke into one
    // file-chooser event, so counting those could never see the double fire this is for.
    await page.addInitScript(() => {
      const opens = { count: 0 };
      (window as unknown as { __pickerOpens: typeof opens }).__pickerOpens = opens;
      const click = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
        if (this.type === "file") opens.count += 1;
        return click.call(this);
      };
    });
    const board = await openBoard(page);
    await focusBoard(board);
    // Held open by listening; see the digit shortcuts above.
    const listening = await listenForPicker(page);

    await page.keyboard.press("9");

    await listening.opened;
    expect(await activeTool(page)).toBe("image");
    const opens = await page.evaluate(
      () => (window as unknown as { __pickerOpens: { count: number } }).__pickerOpens.count,
    );
    expect(opens, "9 opens the picker once").toBe(1);
  });

  test("a shortcut does not scroll the page under the canvas", async ({ page }) => {
    // Space, the arrow keys and Ctrl+Equal all mean something to the browser too. The
    // board is full-viewport, so a page that scrolled would take the canvas with it.
    const board = await openBoard(page);
    await focusBoard(board);

    for (const key of ["Space", "ArrowDown", "ArrowRight"]) {
      await page.keyboard.press(key);
    }

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(board.box.y).toBe(0);
  });
});

test.describe("grid", () => {
  test("Ctrl+' toggles the grid", async ({ page }) => {
    // The oracle matches this on `event.code === "Quote"` — the physical key — not on the
    // apostrophe character. `prompt/shortkey.md` says backquote; it is a community cheat
    // sheet and the oracle disagrees, so the oracle wins.
    const board = await openBoard(page);
    await focusBoard(board);
    const gridOn = () => page.evaluate(() => window.__drawEngine!.getGrid().enabled);
    const before = await gridOn();

    await page.keyboard.press("Control+Quote");

    expect(await gridOn()).toBe(!before);
  });
});

test("the open canvas region really is clear of chrome", async ({ page }) => {
  // The harness constant every drawing spec depends on. When a panel grows, gestures
  // start being swallowed silently and the specs that use it fail somewhere else
  // entirely — so it is worth one test that says what went wrong.
  const board = await openBoard(page);
  for (const point of [
    { x: OPEN_CANVAS.left, y: OPEN_CANVAS.top },
    { x: OPEN_CANVAS.right, y: OPEN_CANVAS.top },
    { x: OPEN_CANVAS.left, y: OPEN_CANVAS.bottom },
    { x: OPEN_CANVAS.right, y: OPEN_CANVAS.bottom },
  ]) {
    const tag = await page.evaluate((at) => document.elementFromPoint(at.x, at.y)?.tagName ?? "", {
      x: board.box.x + point.x,
      y: board.box.y + point.y,
    });
    expect(tag, `${point.x},${point.y} is covered by ${tag}`).toBe("CANVAS");
  }
});
