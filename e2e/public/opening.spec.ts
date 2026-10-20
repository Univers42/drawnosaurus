import { expect, test } from "../fixtures.ts";
import { sceneElements } from "../board.ts";
import { card, drawAndSave, drawingReady, openApp, openMyDrawings } from "./drawing.ts";

/**
 * Opening the public build — the spec's scenario 1 and its Goal 1.
 *
 * `/` was the gallery, whose "+ New Board" stays disabled until a name is typed and does
 * not say so: a newcomer could not find a way to draw. Now `/` opens the drawing last open
 * in this browser, and a new one the first time, as Excalidraw does.
 */

const types = async (page: Parameters<typeof sceneElements>[0]) =>
  (await sceneElements(page)).map((element) => element.type);

test("opening the app lands in a drawing, and opening it again brings back the same one", async ({
  page,
}) => {
  const { board, slug } = await openApp(page);
  await drawAndSave(board);

  await page.goto("/");

  await expect(page).toHaveURL(new RegExp(`/boards/${slug}$`));
  await drawingReady(page);
  await expect.poll(() => types(page)).toEqual(["rectangle"]);
});

test("a drawing deleted from the gallery is not opened again, as a blank under its id", async ({
  page,
}) => {
  const { board, slug } = await openApp(page);
  await drawAndSave(board);
  await openMyDrawings(page);
  page.once("dialog", (dialog) => void dialog.accept());
  await card(page, slug).getByTitle("Delete board").click();
  await expect(card(page, slug)).toHaveCount(0);

  const reopened = await openApp(page);

  expect(reopened.slug).not.toBe(slug);
  expect(await types(page)).toEqual([]);
});
