import { expect, test } from "../fixtures.ts";
import { sceneElements } from "../board.ts";
import {
  card,
  drawAndSave,
  drawRectangle,
  drawingReady,
  openApp,
  openMyDrawings,
  saveLine,
} from "./drawing.ts";

/**
 * "My drawings" in the public build — the spec's scenario 2 and its Goal 2: the gallery
 * lists what this browser holds, one click from a drawing and back.
 *
 * What it lists: a drawing once something is drawn on it, and one created with a name
 * even while it is empty. A drawing only visited is not listed — `/` opens one on every
 * first visit, and visiting must not fill the gallery with blanks.
 */

test("a drawing is listed once drawn on, and My drawings goes there and back", async ({ page }) => {
  const { slug } = await openApp(page);
  await openMyDrawings(page);
  await expect(page.getByRole("heading", { name: "No drawings yet" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/boards/${slug}$`));
  await drawAndSave(await drawingReady(page));
  await openMyDrawings(page);

  await expect(card(page, slug)).toContainText("1 element");
  await card(page, slug).click();
  await expect(page).toHaveURL(new RegExp(`/boards/${slug}$`));
  await drawingReady(page);
  await expect.poll(async () => (await sceneElements(page)).length).toBe(1);
});

test("a drawing created in the gallery with a name is still listed after a reload", async ({
  page,
}) => {
  await page.goto("/gallery");
  await page.getByPlaceholder("New board title…").fill("Named, nothing drawn");
  await page.getByRole("button", { name: "+ New Board" }).click();
  const named = page.getByRole("link", { name: /Named, nothing drawn/ });
  await expect(named).toBeVisible();

  await page.reload();

  await expect(named).toBeVisible();
  await expect(named).toContainText("0 elements");
});

/**
 * Leaving a drawing with an edit still inside the autosave's debounce: the list it opens
 * has the edit. Opened at its address rather than through `/`, so this needs nothing but
 * the board page.
 *
 * Not, on its own, proof of the hold (`boards/holdForSave.ts`). Without the hold the page's
 * flush still starts as the navigation does, and IndexedDB runs that write before the
 * gallery's later read of the same store, so the list has the edit either way — this passed
 * three times out of three with the hold turned off. What only the hold does is the next
 * test.
 */
test("an edit not yet saved when My drawings is chosen is in the list it opens", async ({
  page,
}) => {
  const slug = "heldedit1";
  await page.goto(`/boards/${slug}`);
  const board = await drawingReady(page);

  await drawRectangle(board);
  // Not saved yet: the list below is the way-out save's, not the debounce's.
  await expect(saveLine(page)).toHaveText("Unsaved changes");
  await openMyDrawings(page);

  await expect(card(page, slug)).toContainText("1 element");
});

declare global {
  interface Window {
    /** Set by the test below: every IndexedDB `put` refused as a full quota would be. */
    __quotaFull?: boolean;
  }
}

/**
 * The hold, wired in `routes/boards/[slug]/+page.svelte`: a navigation away from an edit not
 * yet saved waits for the save, and when the save fails the person stays on the drawing, the
 * save line saying so. There is no draft behind the public build's saver, so a failure
 * nobody stayed to see would have lost the edit unseen. The quota is filled by refusing
 * every `put` the page makes, as a browser out of room refuses it.
 */
test("a save that fails on the way to My drawings keeps the person on the drawing, told", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
      if (window.__quotaFull) throw new DOMException("the quota is used up", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  const slug = "refusededit1";
  await page.goto(`/boards/${slug}`);
  const board = await drawingReady(page);
  await drawRectangle(board);
  await expect(saveLine(page)).toHaveText("Unsaved changes");

  await page.evaluate(() => {
    window.__quotaFull = true;
  });
  await page.getByRole("button", { name: "Open main menu" }).click();
  await page.getByRole("menuitem", { name: "My drawings" }).click();

  await expect(saveLine(page)).toContainText("Not saved");
  await expect(page).toHaveURL(new RegExp(`/boards/${slug}$`));
});
