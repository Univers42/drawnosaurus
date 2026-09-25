import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  activeTool,
  chromaInk,
  clickElement,
  focusBoard,
  OPEN_CANVAS,
  openBoard,
  pickTool,
  relay,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * The properties panel, as Excalidraw's behaves.
 *
 * Reported: the panel lacked the tools to style what was selected, and what it showed
 * was the first selected element's style rather than the selection's — so a mixed
 * selection looked uniform, and the panel went stale after undo or a colleague's edit.
 * The panel now reads one summary from the engine, per revision (`selection_style.rs`).
 */

const AT = { x: OPEN_CANVAS.left + 100, y: OPEN_CANVAS.top + 80 };

const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });

const option = (page: Page, row: string, label: string) =>
  panel(page).getByRole("group", { name: row }).getByRole("button", { name: label, exact: true });

/** The option shown as current in a row, or `null` when none is — a mixed selection. */
async function pressed(page: Page, row: string): Promise<string | null> {
  const on = panel(page).getByRole("group", { name: row }).locator('button[aria-pressed="true"]');
  return (await on.count()) > 0 ? (await on.first().innerText()).trim() : null;
}

const swatch = (page: Page, color: string) =>
  panel(page).getByRole("button", { name: color, exact: true });

async function drawBox(board: Board, x = AT.x, y = AT.y): Promise<void> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 140, box.y + y + 90, { steps: 4 });
  await page.mouse.up();
}

async function field<K extends "strokeColor" | "backgroundColor" | "strokeWidth" | "opacity">(
  page: Page,
  key: K,
): Promise<unknown[]> {
  return (await sceneElements(page)).map((element) => element[key]);
}

test("a mixed selection marks nothing, and a choice applies to all of it", async ({ page }) => {
  const board = await openBoard(page);
  await drawBox(board);
  await option(page, "Stroke width", "L").click();
  await drawBox(board, AT.x + 250);
  await option(page, "Stroke width", "S").click();
  await swatch(page, "#e03131").click();
  expect(await field(page, "strokeWidth")).toEqual([4, 1]);

  await focusBoard(board);
  await page.keyboard.press("Control+a");
  await expect.poll(async () => (await selection(page)).length).toBe(2);
  await expect(panel(page)).toContainText("2 selected");
  expect(await pressed(page, "Stroke width"), "a width marked for a mixed selection").toBeNull();
  await expect(panel(page).getByRole("button", { name: "Stroke", exact: true })).toHaveAttribute(
    "title",
    "Stroke: mixed",
  );
  // What they share is still shown.
  expect(await pressed(page, "Stroke style")).toBe("──");

  await option(page, "Stroke width", "M").click();
  expect(await field(page, "strokeWidth")).toEqual([2, 2]);
  await expect.poll(() => pressed(page, "Stroke width")).toBe("M");
});

test("after undo and redo the panel shows the scene as it is", async ({ page }) => {
  const board = await openBoard(page);
  await drawBox(board);
  await clickElement(board, 0);
  await option(page, "Stroke width", "L").click();
  await expect.poll(() => pressed(page, "Stroke width")).toBe("L");

  // A smoke check, not the guard: it passes without the style revision too. The engine
  // lets go of the selection on undo and redo (`after_history_step`), which under the
  // select tool puts the panel away, and the click that brings it back reads it afresh.
  // The revision moving on undo and redo is pinned by `ci_selection_style.rs` ›
  // `undo_and_redo_move_it`; an edit the panel must follow with the selection held is the
  // colleague's, below.
  await page.keyboard.press("Control+z");
  expect(await field(page, "strokeWidth")).toEqual([2]);
  await expect(panel(page)).toBeHidden();
  await clickElement(board, 0);
  await expect.poll(() => pressed(page, "Stroke width"), { message: "stale after undo" }).toBe("M");

  await page.keyboard.press("Control+Shift+z");
  expect(await field(page, "strokeWidth")).toEqual([4]);
  await clickElement(board, 0);
  await expect.poll(() => pressed(page, "Stroke width"), { message: "stale after redo" }).toBe("L");
});

test("a colleague's edit to what is selected shows in the panel at once", async ({
  page,
  browser,
}) => {
  const live = relay();
  const board = await openBoard(page, "e2e", { live: live.join });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const theirs = await context.newPage();
  const thrown: string[] = [];
  theirs.on("pageerror", (error) => thrown.push(error.message));
  const colleague = await openBoard(theirs, "e2e", {
    live: live.join,
    hash: new URL(page.url()).hash,
  });

  await drawBox(board);
  await expect.poll(async () => (await sceneElements(theirs)).length).toBe(1);
  // Let go of it, and wait until the colleague sees it free.
  await focusBoard(board);
  const outline = { left: AT.x - 10, top: AT.y - 10, right: AT.x + 150, bottom: AT.y + 100 };
  await expect.poll(() => chromaInk(theirs, outline)).toBeLessThan(0.002);

  // Both take it at once: the host's word is held back, as if still on its way, so the
  // colleague's edit lands on a shape the host has selected.
  live.hold("1");
  await clickElement(board, 0);
  await expect.poll(() => pressed(page, "Stroke width")).toBe("M");
  await clickElement(colleague, 0);
  expect(await selection(theirs)).toHaveLength(1);
  await option(theirs, "Stroke width", "L").click();

  await expect.poll(async () => field(page, "strokeWidth")).toEqual([4]);
  expect(await selection(page), "the host still has it selected").toHaveLength(1);
  await expect
    .poll(() => pressed(page, "Stroke width"), { message: "the panel missed the colleague's edit" })
    .toBe("L");

  expect(thrown, "the colleague's page threw").toEqual([]);
  await context.close();
});

test.describe("the colour picker", () => {
  test("opens from the row, and its keys, shades and hex field pick", async ({ page }) => {
    const board = await openBoard(page);
    await drawBox(board);
    await clickElement(board, 0);
    const stroke = () => field(page, "strokeColor");

    await panel(page).getByRole("button", { name: "Stroke", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Stroke colour picker" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: / — [a-z]$/ })).toHaveCount(15);
    await expect(picker).toContainText("No shades available for this color");
    const canEyeDrop = await page.evaluate(() => "EyeDropper" in window);
    await expect(picker.getByRole("button", { name: "Pick color from canvas" })).toHaveCount(
      canEyeDrop ? 1 : 0,
    );

    // B is red, at the stroke's default shade; then its shades are offered.
    await page.keyboard.press("b");
    await expect.poll(stroke).toEqual(["#e03131"]);
    await expect(picker.getByRole("button", { name: "Shade" })).toHaveCount(5);
    await page.keyboard.press("Shift+Digit1");
    await expect.poll(stroke).toEqual(["#fff5f5"]);
    // S is blue here, not the stroke picker's key: at the shade now in use.
    await page.keyboard.press("s");
    await expect.poll(stroke).toEqual(["#e7f5ff"]);

    const hex = picker.getByRole("textbox", { name: "Hex code" });
    await hex.fill("1971C2");
    await expect.poll(stroke).toEqual(["#1971c2"]);
    await hex.fill("zz");
    await expect(picker.getByRole("alert")).toHaveText("Not a valid color");
    expect(await stroke(), "an invalid colour was applied").toEqual(["#1971c2"]);

    await hex.press("Escape");
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
  });

  test("S and G open the pickers for a selection, and transparent is a colour", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await drawBox(board);
    await clickElement(board, 0);

    await page.keyboard.press("g");
    const background = page.getByRole("dialog", { name: "Background colour picker" });
    await expect(background).toBeVisible();
    await page.keyboard.press("w");
    await expect.poll(() => field(page, "backgroundColor")).toEqual(["#ffffff"]);
    await page.keyboard.press("q");
    await expect.poll(() => field(page, "backgroundColor")).toEqual(["transparent"]);
    await page.keyboard.press("Escape");
    await expect(background).toBeHidden();

    await page.keyboard.press("s");
    await expect(page.getByRole("dialog", { name: "Stroke colour picker" })).toBeVisible();
    expect(await activeTool(page), "S also switched to the lasso").toBe("select");
  });
});

test("a shape's stroke colour and opacity reach its label, and nothing else does", async ({
  page,
}) => {
  const board = await openBoard(page);
  await drawBox(board);
  await page.mouse.dblclick(board.box.x + AT.x + 70, board.box.y + AT.y + 45);
  await page.locator("textarea[aria-label='Text editor']").fill("Hi");
  await page.keyboard.press("Control+Enter");
  await expect
    .poll(async () => (await sceneElements(page)).map((e) => e.type))
    .toEqual(["rectangle", "text"]);
  // The label is selected once written, and its box covers the shape's: let go first.
  await focusBoard(board);
  await clickElement(board, 0);
  expect(await selection(page)).toEqual([(await sceneElements(page))[0]!.id]);
  // The label counts: its size is on the panel for the shape.
  await expect(panel(page).getByRole("group", { name: "Font size" })).toBeVisible();

  await swatch(page, "#e03131").click();
  await swatch(page, "#ffc9c9").click();
  await option(page, "Stroke width", "L").click();
  await panel(page).getByRole("slider", { name: "Opacity" }).fill("50");

  const [shape, label] = await sceneElements(page);
  expect(shape).toMatchObject({
    strokeColor: "#e03131",
    backgroundColor: "#ffc9c9",
    strokeWidth: 4,
    opacity: 50,
  });
  expect(label, "the label kept its own background and width").toMatchObject({
    strokeColor: "#e03131",
    backgroundColor: "transparent",
    strokeWidth: 2,
    opacity: 50,
  });
});

test.describe("copy and paste styles", () => {
  async function twoBoxes(board: Board): Promise<void> {
    const { page } = board;
    await drawBox(board);
    await option(page, "Stroke width", "L").click();
    await swatch(page, "#e03131").click();
    await drawBox(board, AT.x + 250);
    await option(page, "Stroke width", "S").click();
    await swatch(page, "#1971c2").click();
    expect(await field(page, "strokeColor")).toEqual(["#e03131", "#1971c2"]);
  }

  test("with Ctrl+Alt+C and Ctrl+Alt+V", async ({ page }) => {
    const board = await openBoard(page);
    await twoBoxes(board);

    await clickElement(board, 0);
    await page.keyboard.press("Control+Alt+c");
    await expect(page.getByText("Copied styles.")).toBeVisible();
    await clickElement(board, 1);
    await page.keyboard.press("Control+Alt+v");

    await expect.poll(() => field(page, "strokeColor")).toEqual(["#e03131", "#e03131"]);
    expect(await field(page, "strokeWidth")).toEqual([4, 4]);
    expect(await sceneElements(page), "styles pasted as a new element").toHaveLength(2);
    await expect.poll(() => pressed(page, "Stroke width")).toBe("L");
  });

  test("from the context menu", async ({ page }) => {
    const board = await openBoard(page);
    await twoBoxes(board);

    await clickElement(board, 1, { button: "right" });
    await page.getByRole("menuitem", { name: /^Copy styles/ }).click();
    await expect(page.getByText("Copied styles."), "the menu copied without a word").toBeVisible();
    await clickElement(board, 0, { button: "right" });
    await page.getByRole("menuitem", { name: /^Paste styles/ }).click();

    await expect.poll(() => field(page, "strokeColor")).toEqual(["#1971c2", "#1971c2"]);
    expect(await field(page, "strokeWidth")).toEqual([1, 1]);
  });
});

test("the menu names front and back chords the keys act on", async ({ page }) => {
  // The hints follow the platform, and each has to be a chord the keymap takes. They
  // named Ctrl+Shift+] off a Mac, which the engine's keymap at this pin passes over.
  const board = await openBoard(page);
  await drawBox(board);
  await drawBox(board, AT.x + 250);
  const order = async () => (await sceneElements(page)).map((element) => element.id);
  const [first, second] = await order();
  const KEY: Record<string, string> = { Ctrl: "Control", "]": "BracketRight", "[": "BracketLeft" };

  async function pressHinted(item: string, index: number): Promise<void> {
    await clickElement(board, index, { button: "right" });
    const hint = await page
      .getByRole("menuitem", { name: new RegExp(`^${item}`) })
      .locator(".hint")
      .innerText();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await clickElement(board, index);
    await page.keyboard.press(
      hint
        .split("+")
        .map((key) => KEY[key] ?? key)
        .join("+"),
    );
  }

  await pressHinted("Bring to front", 0);
  expect(await order(), "the chord named for bring to front did nothing").toEqual([second, first]);
  await pressHinted("Send to back", 1);
  expect(await order(), "the chord named for send to back did nothing").toEqual([first, second]);
});

test("an opacity drag shows as it goes and is one step of undo", async ({ page }) => {
  const board = await openBoard(page);
  await drawBox(board);
  await clickElement(board, 0);

  const slider = panel(page).getByRole("slider", { name: "Opacity" });
  await slider.scrollIntoViewIfNeeded();
  const track = await slider.boundingBox();
  if (!track) throw new Error("the opacity slider has no box");
  const y = track.y + track.height / 2;
  await page.mouse.move(track.x + track.width - 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.3, y, { steps: 8 });
  const during = (await field(page, "opacity"))[0] as number;
  expect(during, "the drag is not shown until it ends").toBeLessThan(50);
  await page.mouse.up();

  const after = (await field(page, "opacity"))[0] as number;
  expect(after).toBe(during);
  await expect(panel(page)).toContainText(`Opacity — ${after}%`);

  await clickElement(board, 0);
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => field(page, "opacity"), { message: "one undo did not undo the whole drag" })
    .toEqual([100]);
});

test("an opacity drag that ends where it began still lets a colleague's edit in", async ({
  page,
}) => {
  // Chromium fires no `change` when the thumb is let go at its starting value, and the
  // previews had left the shape mid-gesture: every newer copy a colleague sent was
  // refused until some unrelated edit of ours.
  const board = await openBoard(page);
  await drawBox(board);
  await clickElement(board, 0);

  const slider = panel(page).getByRole("slider", { name: "Opacity" });
  await slider.scrollIntoViewIfNeeded();
  const track = await slider.boundingBox();
  if (!track) throw new Error("the opacity slider has no box");
  const y = track.y + track.height / 2;
  await page.mouse.move(track.x + track.width - 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.3, y, { steps: 6 });
  expect((await field(page, "opacity"))[0], "setup: the drag previews").toBeLessThan(50);
  await page.mouse.move(track.x + track.width - 2, y, { steps: 6 });
  await page.mouse.up();
  expect(await field(page, "opacity")).toEqual([100]);

  const accepted = await page.evaluate(() => {
    const engine = window.__drawEngine!;
    const [shape] = JSON.parse(engine.exportJson()).elements;
    return engine.applyRemotePatch(
      JSON.stringify({
        type: "osidraw",
        version: 1,
        elements: [{ ...shape, strokeColor: "#2f9e44", version: shape.version + 5 }],
      }),
    );
  });
  expect(accepted, "the colleague's edit was refused").toBe(true);
  expect(await field(page, "strokeColor")).toEqual(["#2f9e44"]);
});
