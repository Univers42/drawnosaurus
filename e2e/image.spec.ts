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
 * Images: in, on screen where they are, and movable.
 *
 * Reported as "the image cannot be dragged or dropped, we cannot work with it". Four
 * causes, each of which these pin, and each run red against the old code:
 *
 * - the picture was painted offset from its own element — translated to the element and
 *   then drawn at the element's position again — so what you grabbed was not the image;
 * - a dismissed picker left the tool on Image, under which the engine ignores presses, so
 *   nothing could be picked up until another tool was chosen by hand;
 * - a drop that landed on a floating panel was not cancelled, and a file drop nobody
 *   cancels is opened by the browser in place of the board;
 * - a pasted image fell through to the engine, which pasted its internal clipboard.
 *
 * See `docs/reference/images.md`.
 *
 * The picture is a solid red block, so "is it drawn here" is a colour, not a guess.
 */

const PICTURE = { width: 200, height: 120 };

/** A solid red PNG, made by the browser itself so the suite needs no fixture file. */
async function redPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, PICTURE);
  return Buffer.from(base64, "base64");
}

/**
 * Where the red is on the canvas, canvas-relative CSS pixels — or null if there is none.
 *
 * Measured from pixels rather than read from the model, because the bug was the two
 * disagreeing: the element was in one place and its picture in another.
 */
function redBox(
  page: Page,
): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
    if (left === Infinity) return null;
    return { left: left / scale, top: top / scale, right: right / scale, bottom: bottom / scale };
  });
}

/** Where an element is on screen, canvas-relative, from the model and the camera. */
async function onScreen(page: Page, element: SceneElement) {
  const { x, y, scale } = await page.evaluate(() => window.__drawEngine!.camera);
  return {
    left: element.x * scale + x,
    top: element.y * scale + y,
    right: (element.x + element.width) * scale + x,
    bottom: (element.y + element.height) * scale + y,
  };
}

async function images(page: Page): Promise<SceneElement[]> {
  return (await sceneElements(page)).filter((el) => el.type === "image");
}

/** Inserts the picture through the toolbar and the file picker, as a person does. */
async function insertThroughPicker(board: Board, file: Buffer): Promise<void> {
  const { page } = board;
  const chooser = page.waitForEvent("filechooser");
  await pickTool(page, "Insert image");
  await (await chooser).setFiles({ name: "red.png", mimeType: "image/png", buffer: file });
  await expect.poll(async () => (await images(page)).length).toBe(1);
}

/** Waits until the picture has decoded and been painted. */
async function paintedRed(page: Page) {
  await expect
    .poll(() => redBox(page), { message: "the picture should be painted" })
    .not.toBeNull();
  return (await redBox(page))!;
}

/**
 * A file dropped at a canvas-relative point, on whatever element is on top there.
 *
 * Dispatched rather than performed: a file drag starts in the operating system, and
 * Playwright can only drag things that are already on the page. Reports whether the
 * `dragover` and the `drop` were each cancelled. Both matter: a browser only delivers a
 * drop to a target whose dragover was cancelled, and opens a drop nobody cancels in
 * place of the page.
 */
async function dropFile(
  board: Board,
  at: { x: number; y: number },
  file: { name: string; type: string; base64: string },
): Promise<{ over: boolean; drop: boolean }> {
  return board.page.evaluate(
    ({ point, file }) => {
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
      const target = document.elementFromPoint(point.x, point.y)!;
      const init = { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y };
      const over = !target.dispatchEvent(
        new DragEvent("dragover", { ...init, dataTransfer: transfer }),
      );
      const drop = !target.dispatchEvent(
        new DragEvent("drop", { ...init, dataTransfer: transfer }),
      );
      return { over, drop };
    },
    { point: { x: board.box.x + at.x, y: board.box.y + at.y }, file },
  );
}

/**
 * Chooses the image tool and leaves its picker open, as it is while a person looks for
 * a file. Listening for the picker is what holds it open: one nobody answers is closed
 * at once by a headless browser, which puts the tool straight back to Select.
 */
async function imageToolWaitingOnPicker(board: Board): Promise<void> {
  const { page } = board;
  const picker = page.waitForEvent("filechooser");
  await focusBoard(board);
  await page.keyboard.press("9");
  await picker;
  expect(await activeTool(page), "setup: the image tool is waiting on its picker").toBe("image");
}

const MIDDLE = {
  x: (OPEN_CANVAS.left + OPEN_CANVAS.right) / 2,
  y: (OPEN_CANVAS.top + OPEN_CANVAS.bottom) / 2,
};

test("the picture is painted inside its own element", async ({ page }) => {
  const board = await openBoard(page);
  await insertThroughPicker(board, await redPng(page));

  const [image] = await images(page);
  const expected = await onScreen(page, image!);
  const red = await paintedRed(page);

  // To within the antialiased edge. The bug put the picture a whole element-position away.
  for (const side of ["left", "top", "right", "bottom"] as const) {
    expect(
      Math.abs(red[side] - expected[side]),
      `${side}: ${red[side]} vs ${expected[side]}`,
    ).toBeLessThan(3);
  }
});

test("after the picker the tool is Select and the image is selected", async ({ page }) => {
  const board = await openBoard(page);
  await insertThroughPicker(board, await redPng(page));

  expect(await activeTool(page)).toBe("select");
  expect(await selection(page)).toEqual([(await images(page))[0]!.id]);
});

test("an image can be picked up by its picture and dragged", async ({ page }) => {
  const board = await openBoard(page);
  await insertThroughPicker(board, await redPng(page));
  const before = (await images(page))[0]!;
  // Deselected first, so the press has to hit the image rather than a selection box.
  await focusBoard(board);
  const red = await paintedRed(page);

  // Aimed at the pixels, not at the model: where the picture *looks* like it is.
  const grab = {
    x: board.box.x + (red.left + red.right) / 2,
    y: board.box.y + (red.top + red.bottom) / 2,
  };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 150, grab.y + 80, { steps: 8 });
  await page.mouse.up();

  const after = (await images(page))[0]!;
  const { scale } = await page.evaluate(() => window.__drawEngine!.camera);
  expect(after.x - before.x).toBeCloseTo(150 / scale, 0);
  expect(after.y - before.y).toBeCloseTo(80 / scale, 0);
  expect(after.width, "moved, not resized").toBeCloseTo(before.width, 3);
});

test("a dropped image lands where it was dropped and can be moved straight away", async ({
  page,
}) => {
  const board = await openBoard(page);
  const base64 = (await redPng(page)).toString("base64");
  // Dropped while the image tool is waiting on its picker, the state in which presses
  // were being ignored: the drop has to hand back Select itself.
  await imageToolWaitingOnPicker(board);

  const cancelled = await dropFile(board, MIDDLE, { name: "red.png", type: "image/png", base64 });

  expect(cancelled, "cancelled, or the browser opens the file").toEqual({ over: true, drop: true });
  await expect.poll(async () => (await images(page)).length).toBe(1);
  const red = await paintedRed(page);
  expect((red.left + red.right) / 2).toBeCloseTo(MIDDLE.x, -1);
  expect((red.top + red.bottom) / 2).toBeCloseTo(MIDDLE.y, -1);
  expect(await activeTool(page)).toBe("select");

  // The half of the report that mattered: it can be worked with.
  const before = (await images(page))[0]!;
  await page.mouse.move(board.box.x + MIDDLE.x, board.box.y + MIDDLE.y);
  await page.mouse.down();
  await page.mouse.move(board.box.x + MIDDLE.x - 100, board.box.y + MIDDLE.y + 40, { steps: 6 });
  await page.mouse.up();
  expect((await images(page))[0]!.x).toBeLessThan(before.x - 50);
});

test("with the tool locked, a drop keeps the image tool", async ({ page }) => {
  const board = await openBoard(page);
  await page.getByRole("button", { name: /^Keep tool active after drawing/ }).click();
  await imageToolWaitingOnPicker(board);
  const base64 = (await redPng(page)).toString("base64");

  await dropFile(board, MIDDLE, { name: "red.png", type: "image/png", base64 });

  await expect.poll(async () => (await images(page)).length).toBe(1);
  expect(await activeTool(page)).toBe("image");
});

test("a drop on a floating panel still lands, instead of replacing the board", async ({ page }) => {
  const board = await openBoard(page);
  const base64 = (await redPng(page)).toString("base64");
  // The toolbar floats over the canvas: the drop lands on a button, not on the canvas.
  const button = await page.getByRole("button", { name: /^Rectangle \(/ }).boundingBox();
  const at = {
    x: button!.x + button!.width / 2 - board.box.x,
    y: button!.y + button!.height / 2 - board.box.y,
  };

  const cancelled = await dropFile(board, at, { name: "red.png", type: "image/png", base64 });

  expect(cancelled).toEqual({ over: true, drop: true });
  await expect.poll(async () => (await images(page)).length).toBe(1);
});

test("a dropped file that is not an image is refused, and still cancelled", async ({ page }) => {
  const board = await openBoard(page);

  const cancelled = await dropFile(board, MIDDLE, {
    name: "notes.pdf",
    type: "application/pdf",
    base64: btoa("%PDF-1.4"),
  });

  expect(cancelled, "a PDF nobody cancels is opened by the browser in this tab").toEqual({
    over: true,
    drop: true,
  });
  await expect(page.getByRole("status")).toContainText(/./);
  expect(await images(page)).toHaveLength(0);
});

test("dismissing the picker gives the board back", async ({ page }) => {
  const board = await openBoard(page);
  // Something to select afterwards, drawn with its top edge in the open.
  await pickTool(page, "Rectangle");
  await page.mouse.move(board.box.x + 520, board.box.y + 240);
  await page.mouse.down();
  await page.mouse.move(board.box.x + 640, board.box.y + 320, { steps: 4 });
  await page.mouse.up();
  await focusBoard(board);

  // Nobody answers the picker, so the headless browser closes it straight away — with
  // the same trusted `cancel` a person closing the dialog produces.
  await pickTool(page, "Insert image");

  await expect.poll(() => activeTool(page)).toBe("select");
  // And the board answers presses again: a marquee catches the rectangle.
  await page.mouse.move(board.box.x + 500, board.box.y + 220);
  await page.mouse.down();
  await page.mouse.move(board.box.x + 660, board.box.y + 340, { steps: 4 });
  await page.mouse.up();
  expect(await selection(page)).toHaveLength(1);
});

test("pasting an image places it, rather than the shapes copied earlier", async ({ page }) => {
  const board = await openBoard(page);
  // Something on the internal clipboard, so a paste that fell through to it would show.
  await pickTool(page, "Rectangle");
  await page.mouse.move(board.box.x + 500, board.box.y + 220);
  await page.mouse.down();
  await page.mouse.move(board.box.x + 620, board.box.y + 300, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("Control+c");
  const base64 = (await redPng(page)).toString("base64");
  // From the image tool, so the return to Select is the paste's doing.
  await imageToolWaitingOnPicker(board);
  await page.mouse.move(board.box.x + MIDDLE.x, board.box.y + MIDDLE.y);

  // Dispatched: a real paste reads the system clipboard, which a headless browser does
  // not share with the test. The event is the one the browser would deliver.
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "image.png", { type: "image/png" }));
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
  }, base64);

  await expect.poll(async () => (await images(page)).length).toBe(1);
  expect((await sceneElements(page)).filter((el) => el.type === "rectangle")).toHaveLength(1);
  expect(await selection(page)).toEqual([(await images(page))[0]!.id]);
  expect(await activeTool(page)).toBe("select");
});
