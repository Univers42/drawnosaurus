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

/**
 * A drawing not shared has no live link (`realtime/liveRoom.ts`), so there is nothing to say
 * about one: no "Live collaboration offline" on the header, which every drawing showed while
 * it tried a relay that does not exist. And no socket is opened (`nothingLeaves.spec.ts`).
 *
 * The Share button is there, as in the Docker build: the public build has a Share dialog of
 * its own now, and the drawing goes live when it is shared — not before, so nothing is
 * connected and nothing is written while it is only being drawn on.
 */
test("a drawing not shared shows no live status, and offers the Share of a live link", async ({
  page,
}) => {
  await openApp(page);

  await expect(page.getByLabel("Live collaboration", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share & collaborate" })).toHaveCount(1);
  await page.getByRole("button", { name: "Open main menu" }).click();
  await expect(page.getByRole("menuitem", { name: "My drawings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Live collaboration…" })).toBeVisible();
});
