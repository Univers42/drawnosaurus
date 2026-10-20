import { expect, test } from "../fixtures.ts";
import { interLoaded } from "../appFont.ts";
import { openApp } from "./drawing.ts";

/**
 * The public build's text is in Inter, as the Docker build's is (`e2e/appFont.spec.ts`).
 * That it comes from the app's own files, and from nowhere else, is `nothingLeaves.spec.ts`.
 */
test("the app's text is in Inter", async ({ page }) => {
  await openApp(page);
  await expect.poll(() => interLoaded(page)).toBe(true);
});
