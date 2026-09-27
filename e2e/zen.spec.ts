import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, sceneElements, type Board } from "./board.ts";

/**
 * Zen mode: `Alt+Z` takes the oracle's chrome away and leaves the canvas.
 *
 * The pure decision is in `apps/web/src/lib/draw-chrome/zen.ts` and proven in
 * `zen.test.ts`; the web suite runs in vitest's `node` environment and renders no
 * component, so nothing short of this file can show that the `{#if}`s in
 * `DrawSurface.svelte`, `DrawZoomBar.svelte` and `DrawToolbar.svelte` are actually wired
 * to the table, or that the exit button lands where it should.
 *
 * What the oracle hides is narrower than "the chrome", and that is the point of these
 * assertions: the style panel and the undo/redo row go, the top bar, the tool strip and
 * the zoom controls stay (`docs/reference/shortcuts.md`).
 */

/** The style panel: an `<aside aria-label="Style inspector">`, so a complementary landmark. */
const INSPECTOR = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });

/** The bottom bar: zoom, fit, undo, redo. Zen mode keeps the first three. */
const ZOOM_BAR = (page: Page) => page.getByRole("group", { name: "Zoom and history controls" });

const UNDO = (page: Page) => page.getByRole("button", { name: /^Undo/ });
const EXIT_ZEN = (page: Page) => page.getByRole("button", { name: /Exit zen mode/ });

/**
 * A rectangle drawn by hand and left selected, which is what `panelVisible` waits on —
 * the style panel is not on the board at all with nothing selected, so a test that pressed
 * a tool key and hoped would be asserting about a panel that was never there.
 */
async function drawSelectedRectangle(page: Page, board: Board): Promise<void> {
  await page.getByRole("button", { name: /^Rectangle \(/ }).click();
  await page.mouse.move(board.box.x + 520, board.box.y + 240);
  await page.mouse.down();
  await page.mouse.move(board.box.x + 800, board.box.y + 460, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await sceneElements(page)).length, { timeout: 2_000 })
    .toBeGreaterThan(0);
}

async function zenOn(page: Page): Promise<void> {
  await page.keyboard.press("Alt+KeyZ");
  await expect(EXIT_ZEN(page), "the way out appears with the flag").toBeVisible();
}

test.describe("zen mode", () => {
  test("Alt+Z takes the style panel and the undo row, and keeps the canvas and the rest", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await drawSelectedRectangle(page, board);
    await expect(INSPECTOR(page), "the style panel is up to be taken away").toBeVisible();

    await zenOn(page);

    await expect(INSPECTOR(page), "the style panel is gone").toHaveCount(0);
    await expect(UNDO(page), "the undo row is gone").toHaveCount(0);
    await expect(ZOOM_BAR(page), "the zoom bar stays").toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Zoom in/ }),
      "and so do the zoom actions inside it",
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open main menu" }),
      "the top bar stays",
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Rectangle \(/ }),
      "the tool strip stays",
    ).toBeVisible();

    // The point of the feature: the board is still there.
    expect(await page.evaluate(() => window.__drawEngine!.camera.scale)).toBeGreaterThan(0);
    expect(await sceneElements(page), "and the scene is untouched").toHaveLength(1);

    await page.keyboard.press("Alt+KeyZ");
    await expect(INSPECTOR(page), "and it all comes back").toBeVisible();
  });

  test("the exit button puts the chrome back", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await drawSelectedRectangle(page, board);
    await expect(INSPECTOR(page)).toBeVisible();

    await zenOn(page);
    await EXIT_ZEN(page).click();

    await expect(EXIT_ZEN(page)).toHaveCount(0);
    await expect(INSPECTOR(page)).toBeVisible();
  });

  test("the exit button is readable, not bare inherited text", async ({ page }) => {
    // The regression a jsdom cascade check found and a browser cannot: `.exit-zen-mode` at
    // (0,1,0) lost to `.draw-chrome button` at (0,1,1) on padding, background, border,
    // colour and — through its `font: inherit` shorthand — size and weight, so the one
    // control that has to be legible rendered as 16px body text on no background at all.
    const board = await openBoard(page);
    await focusBoard(board);
    await zenOn(page);

    const button = EXIT_ZEN(page);
    await expect(button).toBeVisible();
    const painted = await button.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        fontSize: style.fontSize,
        background: style.backgroundColor,
        padding: style.paddingTop,
      };
    });
    // The chrome's small type, not the page's.
    expect(parseFloat(painted.fontSize), "font-size").toBeLessThan(14);
    expect(painted.background, "has a panel behind it").not.toBe("rgba(0, 0, 0, 0)");
    expect(parseFloat(painted.padding), "has padding").toBeGreaterThan(0);
  });

  test("Alt+Z does nothing while a text box is being edited", async ({ page }) => {
    // The trap the guard exists for: hiding the chrome mid-sentence, with no way back.
    const board = await openBoard(page);
    await focusBoard(board);
    await page.keyboard.press("t");
    await page.keyboard.type("hello");
    const editorField = page.locator("textarea[aria-label='Text editor']");
    await expect(editorField).toBeFocused();

    await page.keyboard.press("Alt+KeyZ");

    await expect(EXIT_ZEN(page), "zen mode did not latch on").toHaveCount(0);
    await expect(editorField, "and the text is still being edited").toBeFocused();
  });

  test("Alt+Z does not latch on while presenting, where its way out is hidden", async ({
    page,
  }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    await drawSelectedRectangle(page, board);

    await page.keyboard.press("Control+Alt+KeyP");
    await expect(page.getByRole("group", { name: "Presentation controls" })).toBeVisible();

    await page.keyboard.press("Alt+KeyZ");

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("group", { name: "Presentation controls" }),
      "leaving Present",
    ).toHaveCount(0);
    await expect(EXIT_ZEN(page), "no invisible zen mode was left behind").toHaveCount(0);
    await expect(INSPECTOR(page), "and the chrome is intact").toBeVisible();
  });
});

/**
 * The regression this file would have caught on its own, had it existed when the guard did.
 *
 * Zen mode brought a `KeyTarget` guard into `appShortcut`, and the guard answered
 * `"overlay"` with `null`. The main menu is a `role="menu"`, so `insideOverlay` saw it and
 * `insideDialog` did not — and two chords the menu *prints* beside its own items, `Alt+S`
 * (`:314`) and `Ctrl+Alt+P` (`:256`), stopped working. `e2e/shortcuts.spec.ts` names `Alt+S`
 * in its own comment for exactly this reason but only exercises `Ctrl+O`, which is handled
 * inline and so was unaffected.
 */
test.describe("the main menu's own chords", () => {
  test("Alt+S still reaches snap-to-objects while the menu is open", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    const objectsSnap = () => page.evaluate(() => window.__drawEngine!.getObjectsSnap());
    expect(await objectsSnap()).toBe(false);

    await page.getByRole("button", { name: "Open main menu" }).click();
    const menu = page.getByRole("menu", { name: "Main menu" });
    await expect(menu).toBeVisible();
    await expect(menu, "the menu took the focus").toBeFocused();

    await page.keyboard.press("Alt+KeyS");

    expect(await objectsSnap(), "the chord the menu prints is not a dead key").toBe(true);
  });

  test("Ctrl+Alt+P still reaches Present while the menu is open", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);

    await page.getByRole("button", { name: "Open main menu" }).click();
    await expect(page.getByRole("menu", { name: "Main menu" })).toBeVisible();

    await page.keyboard.press("Control+Alt+KeyP");

    await expect(page.getByRole("group", { name: "Presentation controls" })).toBeVisible();
  });
});
