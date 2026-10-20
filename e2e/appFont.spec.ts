import { expect, test } from "./fixtures.ts";
import { interLoaded } from "./appFont.ts";
import { openBoard } from "./board.ts";

/**
 * The app's text is in Inter, and the app serves it: nothing is asked of Google's font CDN,
 * which the Docker build used to load it from. The public build holds the same in
 * `e2e/public/appFont.spec.ts`.
 */
test("the app's text is in Inter, served by the app and not by Google", async ({ page }) => {
  const google: string[] = [];
  const own: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.host)) google.push(request.url());
    if (url.pathname.startsWith("/fonts/Inter/")) own.push(url.pathname);
  });

  await openBoard(page, "appfont");
  await expect.poll(() => interLoaded(page)).toBe(true);

  // Soft, so a failure lists both.
  expect.soft(google, "what was asked of Google's font CDN").toEqual([]);
  expect.soft(own.length, "the requests for the app's own Inter files").toBeGreaterThan(0);
});
