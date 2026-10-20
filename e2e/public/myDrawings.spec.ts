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
 * The hold (`boards/holdForSave.ts`, wired in `routes/boards/[slug]/+page.svelte`): an edit
 * still inside the autosave's debounce when the person leaves is saved before they arrive.
 * Opened at its address rather than through `/`, so this needs nothing but the hold.
 */
test("an edit not yet saved when My drawings is chosen is in the list it opens", async ({
  page,
}) => {
  const slug = "heldedit1";
  await page.goto(`/boards/${slug}`);
  const board = await drawingReady(page);

  await drawRectangle(board);
  // Not saved yet: what the list shows below is the hold's doing, not the debounce's.
  await expect(saveLine(page)).toHaveText("Unsaved changes");
  await openMyDrawings(page);

  await expect(card(page, slug)).toContainText("1 element");
});
