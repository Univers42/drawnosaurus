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
import { editor } from "./textBoard.ts";

/**
 * The sticky note, with real keys and a real pointer: Excalidraw's `stickynote`
 * (`packages/element/src/stickyNote.ts@1118751f`), drawn by the engine — one element and
 * its label, the shadow and the date painted. `ci_sticky.rs` pins the numbers with a
 * fixed-width measurer; this is the same note with the browser's fonts and the panel.
 * `docs/reference/sticky.md`.
 */

type Element = SceneElement & {
  fontSize?: number;
  baseFontSize?: number;
  baseHeight?: number;
  created?: number;
};

/** Where a note is placed: the middle of the open canvas, clear of every panel. */
const AT = {
  x: (OPEN_CANVAS.left + OPEN_CANVAS.right) / 2,
  y: OPEN_CANVAS.top + 150,
};

/**
 * How far out a corner handle's centre sits from the corner it moves, in screen pixels:
 * the 4px frame margin and half the 8px handle (`HandleLayout::screen`).
 */
const HANDLE_OUT = 8;

const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });
const swatch = (page: Page, color: string) =>
  panel(page).getByRole("button", { name: color, exact: true });

async function elements(page: Page): Promise<Element[]> {
  return (await sceneElements(page)) as Element[];
}

async function notes(page: Page): Promise<Element[]> {
  return (await elements(page)).filter((element) => element.type === "stickynote");
}

async function labels(page: Page): Promise<Element[]> {
  return (await elements(page)).filter((element) => element.type === "text");
}

/** A world point on the page, at the camera the engine holds. */
async function onPage(board: Board, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const { x, y, scale } = await board.page.evaluate(() => window.__drawEngine!.camera);
  return { x: board.box.x + wx * scale + x, y: board.box.y + wy * scale + y };
}

/** N, then a click at `at` (canvas pixels): the note is placed and its label opens. */
async function placeNote(board: Board, at = AT): Promise<Element> {
  const { page, box } = board;
  await focusBoard(board);
  await page.keyboard.press("n");
  expect(await activeTool(page)).toBe("stickynote");
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect(editor(board)).toBeVisible();
  const [note] = await notes(page);
  if (!note) throw new Error("no note was placed");
  return note;
}

/** A note placed and `words` typed into it, committed. */
async function writeNote(board: Board, words: string): Promise<{ note: Element; label: Element }> {
  const placed = await placeNote(board);
  await board.page.keyboard.type(words);
  await board.page.keyboard.press("Escape");
  await expect(editor(board)).toHaveCount(0);
  const note = (await notes(board.page)).find((candidate) => candidate.id === placed.id)!;
  const label = (await labels(board.page)).find((candidate) => candidate.containerId === note.id);
  if (!label) throw new Error("the note kept no label");
  return { note, label };
}

/** The middle of a note, where its paper takes a click. */
async function clickNote(board: Board, note: Element): Promise<void> {
  const at = await onPage(board, note.x + note.width / 2, note.y + note.height / 2);
  await board.page.mouse.click(at.x, at.y);
}

test.describe("the N tool", () => {
  test("a click places the default note centred on it and opens its label", async ({ page }) => {
    const board = await openBoard(page);
    const note = await placeNote(board);
    const centre = await onPage(board, note.x + note.width / 2, note.y + note.height / 2);
    expect({ width: note.width, height: note.height }).toEqual({ width: 250, height: 250 });
    expect(Math.abs(centre.x - (board.box.x + AT.x))).toBeLessThanOrEqual(10);
    expect(Math.abs(centre.y - (board.box.y + AT.y))).toBeLessThanOrEqual(10);
    expect(note.backgroundColor).toBe("#ffdf6b");
    expect(note.baseHeight).toBe(250);
    expect(typeof note.created).toBe("number");
    expect(await activeTool(page), "the tool is let go once the note is down").toBe("select");
  });

  test("typing fills the note's one label", async ({ page }) => {
    const board = await openBoard(page);
    const { note, label } = await writeNote(board, "hello");
    expect(await elements(page)).toHaveLength(2);
    expect(label.text).toBe("hello");
    expect(label.containerId).toBe(note.id);
    expect(note.boundTextId).toBe(label.id);
    expect(label.strokeColor, "the label is written in the note's ink").toBe(note.strokeColor);
  });

  test("a note left empty keeps no label", async ({ page }) => {
    const board = await openBoard(page);
    await placeNote(board);
    await page.keyboard.press("Escape");
    await expect(editor(board)).toHaveCount(0);
    expect((await elements(page)).map((element) => element.type)).toEqual(["stickynote"]);
  });

  test("a drag sizes a square note, far edge kept", async ({ page }) => {
    const board = await openBoard(page);
    const { box } = board;
    await focusBoard(board);
    await page.keyboard.press("n");
    const from = { x: box.x + AT.x + 100, y: box.y + AT.y + 100 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x - 180, from.y - 120, { steps: 8 });
    await page.mouse.up();
    await expect(editor(board)).toBeVisible();
    await page.keyboard.press("Escape");
    const [note] = await notes(page);
    expect(note!.width).toBeCloseTo(note!.height, 5);
    const far = await onPage(board, note!.x + note!.width, note!.y + note!.height);
    expect(Math.abs(far.x - from.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(far.y - from.y)).toBeLessThanOrEqual(1);
  });
});

test.describe("the label", () => {
  test("shrinks its font before the note grows, then grows the note", async ({ page }) => {
    const board = await openBoard(page);
    const placed = await placeNote(board);
    await page.keyboard.type("one");
    const start = (await labels(page))[0]?.fontSize;
    expect(start, "a label is there while typing").toBeDefined();

    // A few lines more than the note holds at the size it started at: the font steps
    // down, the note keeps its size.
    await page.keyboard.type("\ntwo\nthree\nfour\nfive\nsix\nseven\neight");
    await expect.poll(async () => (await labels(page))[0]?.fontSize).toBeLessThan(start!);
    expect((await notes(page))[0]!.height).toBe(placed.height);
    expect((await labels(page))[0]!.fontSize).toBeGreaterThanOrEqual(16);

    // Far more than it holds at the floor: the font stops at 16 and the note grows down.
    await page.keyboard.type("\n9\n10\n11\n12\n13\n14\n15\n16");
    await expect.poll(async () => (await notes(page))[0]!.height).toBeGreaterThan(placed.height);
    const [grown] = await notes(page);
    expect((await labels(page))[0]!.fontSize).toBe(16);
    expect(grown!.y, "it grows down, its top kept").toBeCloseTo(placed.y, 5);
    expect(grown!.baseHeight, "the height asked for is kept").toBe(placed.height);

    // Taking the lines back takes the growth and the shrinking back.
    await page.keyboard.press("Control+a");
    await page.keyboard.type("short");
    await expect.poll(async () => (await notes(page))[0]!.height).toBe(placed.height);
    expect((await labels(page))[0]!.fontSize).toBe(start);
    await page.keyboard.press("Escape");
    expect(await elements(page)).toHaveLength(2);
  });
});

test.describe("resizing a note", () => {
  test("a corner scales the note and its label's size; a side frees one side", async ({ page }) => {
    const board = await openBoard(page);
    const { note, label } = await writeNote(board, "hi");
    const size = label.fontSize!;
    await clickNote(board, note);
    await expect.poll(() => selection(page)).toEqual([note.id]);

    const corner = await onPage(board, note.x + note.width, note.y + note.height);
    await page.mouse.move(corner.x + HANDLE_OUT, corner.y + HANDLE_OUT);
    await page.mouse.down();
    await page.mouse.move(corner.x + HANDLE_OUT + 100, corner.y + HANDLE_OUT + 20, { steps: 8 });
    await page.mouse.up();
    const [scaled] = await notes(page);
    expect(scaled!.width).toBeGreaterThan(note.width);
    expect(scaled!.width, "square, as the corner is proportional").toBeCloseTo(scaled!.height, 5);
    expect({ x: scaled!.x, y: scaled!.y }).toEqual({ x: note.x, y: note.y });
    const [bigger] = await labels(page);
    expect(bigger!.fontSize).toBeGreaterThan(size);

    // The east side, level with the middle: width only.
    const east = await onPage(board, scaled!.x + scaled!.width, scaled!.y + scaled!.height / 2);
    await page.mouse.move(east.x + HANDLE_OUT, east.y);
    await page.mouse.down();
    await page.mouse.move(east.x + HANDLE_OUT - 120, east.y, { steps: 8 });
    await page.mouse.up();
    const [narrowed] = await notes(page);
    expect(narrowed!.width).toBeLessThan(scaled!.width - 100);
    expect(narrowed!.height).toBeCloseTo(scaled!.height, 5);
  });
});

test.describe("a note's colours", () => {
  test("the panel offers a note's picks and calls its stroke the text colour", async ({ page }) => {
    const board = await openBoard(page);
    const { note } = await writeNote(board, "ink");
    await clickNote(board, note);
    await expect.poll(() => selection(page)).toEqual([note.id]);

    await expect(
      panel(page).getByRole("button", { name: "Text color", exact: true }),
    ).toBeVisible();
    for (const color of ["#ffdf6b", "#fcc2d7", "#b2f2bb", "#a5d8ff", "#ffd8a8"]) {
      await expect(swatch(page, color), color).toBeVisible();
    }
    await expect(swatch(page, "transparent"), "a note is never transparent").toHaveCount(0);
    await expect(panel(page).getByRole("group", { name: "Fill style" })).toHaveCount(0);

    await swatch(page, "#b2f2bb").click();
    await swatch(page, "#e03131").click();
    const [painted] = await notes(page);
    const [label] = await labels(page);
    expect(painted!.backgroundColor).toBe("#b2f2bb");
    expect({ note: painted!.strokeColor, label: label!.strokeColor }).toEqual({
      note: "#e03131",
      label: "#e03131",
    });
  });

  test("a pick with the tool and nothing selected colours the next note", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await page.keyboard.press("n");
    await swatch(page, "#a5d8ff").click();
    await page.mouse.click(board.box.x + AT.x, board.box.y + AT.y);
    await expect(editor(board)).toBeVisible();
    await page.keyboard.press("Escape");
    expect((await notes(page))[0]!.backgroundColor).toBe("#a5d8ff");
  });
});

test.describe("around the note", () => {
  test("an arrow dragged onto a note binds to it", async ({ page }) => {
    const board = await openBoard(page);
    const { note } = await writeNote(board, "target");
    await pickTool(page, "Arrow");
    const from = await onPage(board, note.x - 200, note.y + note.height / 2);
    const to = await onPage(board, note.x + note.width / 2, note.y + note.height / 2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    const arrow = (await elements(page)).find((element) => element.type === "arrow");
    expect(arrow?.endBinding).toBe(note.id);
  });

  test("Ctrl+D copies the note with its own label and its own date", async ({ page }) => {
    const board = await openBoard(page);
    const { note } = await writeNote(board, "copy me");
    await clickNote(board, note);
    await expect.poll(() => selection(page)).toEqual([note.id]);
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await notes(page)).length).toBe(2);
    const copy = (await notes(page)).find((candidate) => candidate.id !== note.id)!;
    const copied = (await labels(page)).find((candidate) => candidate.containerId === copy.id);
    expect(copied?.text).toBe("copy me");
    expect(copy.boundTextId).toBe(copied?.id);
    expect(copied!.x).toBeGreaterThanOrEqual(copy.x);
    expect(copied!.y).toBeGreaterThanOrEqual(copy.y);
    expect(copied!.x + copied!.width).toBeLessThanOrEqual(copy.x + copy.width);
    expect(copy.created).toBeGreaterThanOrEqual(note.created!);
  });

  test("undo takes back the typing, then the note", async ({ page }) => {
    const board = await openBoard(page);
    await writeNote(board, "gone");
    await focusBoard(board);
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => (await elements(page)).map((element) => element.type))
      .toEqual(["stickynote"]);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await elements(page)).length).toBe(0);
  });
});
