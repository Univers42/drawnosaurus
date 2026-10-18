import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, uploadedThumbnails } from "./board.ts";

/**
 * The gallery shows a picture of a board, end to end through the page's own code: a
 * drawing is saved, the page renders a thumbnail with the engine and PUTs it, and the
 * gallery then loads that PNG into a card.
 *
 * What is under test is the wiring. The scale and size of the picture are the engine's
 * (`exportThumbnail`) and the storage is the API's (`apps/api/tests/integration/
 * thumbnails.test.ts`); here the API is a stub that records the PUT and serves it back.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test("a drawn board uploads a PNG thumbnail that the gallery then shows", async ({ page }) => {
  const board = await openBoard(page, "thumbs1");

  await pickTool(page, "Rectangle");
  await page.mouse.move(board.box.x + OPEN_CANVAS.left + 60, board.box.y + OPEN_CANVAS.top + 60);
  await page.mouse.down();
  await page.mouse.move(board.box.x + OPEN_CANVAS.left + 300, board.box.y + OPEN_CANVAS.top + 220, {
    steps: 8,
  });
  await page.mouse.up();

  // Autosave (~0.8s) then the 3s debounce; the stub records the body.
  await expect.poll(() => uploadedThumbnails(page).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const uploaded = uploadedThumbnails(page)[0];
  expect([...(uploaded?.subarray(0, 8) ?? [])]).toEqual(PNG_SIGNATURE);

  await page.route("**/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/thumbnail")) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: uploaded ?? Buffer.alloc(0),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        boards: [
          {
            slug: "thumbs1",
            title: "With a picture",
            elementCount: 1,
            bounds: { minX: 0, minY: 0, maxX: 240, maxY: 160 },
            rev: 2,
            createdAt: "2026-10-17T10:00:00.000Z",
            updatedAt: "2026-10-17T10:00:00.000Z",
            thumbnailAt: "2026-10-17T10:00:05.000Z",
          },
        ],
        nextCursor: null,
      }),
    });
  });
  await page.goto("/");

  const picture = page.locator(".card-preview img");
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
});
