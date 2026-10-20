import { expect, type Page } from "@playwright/test";
import { OPEN_CANVAS, pickTool, type Board } from "../board.ts";

/**
 * The public build in a browser: no API and no relay, its drawings in this page's
 * IndexedDB (`apps/web/src/lib/store/browser.ts`).
 *
 * Nothing here is stubbed, unlike `board.ts`'s `openBoard`: this build has no server to
 * stand in for, and `nothingLeaves.spec.ts` holds that it calls none. Each test gets a
 * browser context of its own, so its IndexedDB and localStorage start empty.
 */

/** A drawing's address as `/` mints it: 26 base32 characters, and no `#room=` key. */
export const DRAWING_URL = /\/boards\/([a-z2-7]{26})$/;

/** Waits for the drawing's engine, as `openBoard` does, and returns where to aim. */
export async function drawingReady(page: Page): Promise<Board> {
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => window.__drawEngine !== undefined);
  // The page is still opening its drawing when the engine appears; see `openBoard`.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the canvas has no box to aim at");
  return { page, canvas, box };
}

/** Opens the app at `/`, and the drawing it lands in. */
export async function openApp(page: Page): Promise<{ board: Board; slug: string }> {
  await page.goto("/");
  await expect(page).toHaveURL(DRAWING_URL);
  const slug = DRAWING_URL.exec(page.url())?.[1] ?? "";
  return { board: await drawingReady(page), slug };
}

/** A rectangle, drawn inside `OPEN_CANVAS`. Returns before the autosave's debounce ends. */
export async function drawRectangle({ page, box }: Board): Promise<void> {
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + OPEN_CANVAS.left + 60, box.y + OPEN_CANVAS.top + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + OPEN_CANVAS.left + 300, box.y + OPEN_CANVAS.top + 220, {
    steps: 8,
  });
  await page.mouse.up();
}

export const saveLine = (page: Page) => page.getByLabel("Save status", { exact: true });

/**
 * A rectangle, saved. "Saved" is also what an untouched drawing reads, so the save line
 * has to read "Unsaved changes" first — the 800 ms debounce leaves ample time to see it.
 */
export async function drawAndSave(board: Board): Promise<void> {
  await drawRectangle(board);
  await expect(saveLine(board.page)).toHaveText("Unsaved changes");
  await expect(saveLine(board.page)).toHaveText("Saved");
}

/** Opens "My drawings" from the board's main menu, and waits for the gallery. */
export async function openMyDrawings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open main menu" }).click();
  await page.getByRole("menuitem", { name: "My drawings" }).click();
  await expect(page).toHaveURL(/\/gallery$/);
}

/** The gallery's card for `slug`. */
export const card = (page: Page, slug: string) => page.locator(`a[href="/boards/${slug}"]`);

/**
 * When the drawing's gallery picture was stored, or null while it has none — read from
 * the page's own database. Only once the page has opened that database: opened here first,
 * it would be made empty, at a version the app would then not upgrade.
 */
export function pictureStoredAt(page: Page, slug: string): Promise<string | null> {
  return page.evaluate(async (wanted) => {
    const name = "drawnosaurus-drafts";
    if (!(await indexedDB.databases()).some((database) => database.name === name)) {
      throw new Error(`${name} is not open yet`);
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const row = await new Promise<{ thumbnailAt?: string } | undefined>((resolve, reject) => {
        const request = database.transaction("drawings").objectStore("drawings").get(wanted);
        request.onsuccess = () => resolve(request.result as { thumbnailAt?: string } | undefined);
        request.onerror = () => reject(request.error);
      });
      return row?.thumbnailAt ?? null;
    } finally {
      database.close();
    }
  }, slug);
}
