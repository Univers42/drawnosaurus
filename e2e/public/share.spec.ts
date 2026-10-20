import { expect, test } from "../fixtures.ts";
import { relay, sceneElements } from "../board.ts";
import { drawRectangle, openApp } from "./drawing.ts";
import { qrSource } from "../../apps/web/src/lib/draw-chrome/qr.ts";

/**
 * The Share dialog of the public build: one action, "Share live", and then the link.
 *
 * The link is the drawing's address with its secret in the fragment — the secret never
 * reaches a server, and it is what lets the person who opens it read the drawing and
 * seal the live frames. The QR code carries the same link, so a phone can open it.
 */

test("the Share dialog shows the link, copies it, and the QR code encodes it", async ({
  page,
}) => {
  // The relay, stubbed: a shared drawing opens its live link, and there is no relay
  // behind this dev server to open it to.
  await page.routeWebSocket(/\/ws$/, relay().join);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { board, slug } = await openApp(page);
  await drawRectangle(board);

  await page.getByRole("button", { name: "Share & collaborate" }).click();
  await page.getByRole("button", { name: "Share live" }).click();

  const link = page.getByLabel("Share link");
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(url).toContain(`#room=`);
  expect(url).toContain(`/boards/${slug}`);
  // The address bar carries it too, so the link can be copied from there.
  expect(page.url()).toBe(url);

  // Copy puts the link on the clipboard.
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  // The QR code encodes the same link: the code the app draws for that link, byte for byte.
  const qr = page.getByRole("img", { name: "QR code for collaboration link" });
  await expect(qr).toBeVisible();
  expect(await qr.locator("img").getAttribute("src")).toBe(qrSource(url));
});

test("the dialog again shows the same link, and the drawing is still there", async ({ page }) => {
  await page.routeWebSocket(/\/ws$/, relay().join);
  const { board, slug } = await openApp(page);
  await drawRectangle(board);

  await page.getByRole("button", { name: "Share & collaborate" }).click();
  await page.getByRole("button", { name: "Share live" }).click();
  const first = await page.getByLabel("Share link").inputValue();
  await page.getByRole("button", { name: "Close dialog" }).click();

  // The drawing is still shared: the same link, and no second copy written.
  await page.getByRole("button", { name: "Share & collaborate" }).click();
  await expect(page.getByLabel("Share link")).toHaveValue(first);
  await expect(page.getByRole("button", { name: "Share live" })).toHaveCount(0);

  // And the drawing is on the board, whole.
  expect((await sceneElements(page)).length).toBe(1);
  expect(first).toContain(`/boards/${slug}`);
});
