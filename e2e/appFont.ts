import type { Page } from "@playwright/test";

/**
 * The app's own typeface, Inter (`apps/web/src/app.css`): the one its chrome is set in, in
 * both builds. Not a canvas face; those are `apps/web/src/lib/draw-chrome/fonts.css`.
 */

/** Whether a face of Inter has loaded in this page, once the loads under way are done. */
export function interLoaded(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    // Chromium reports the family as the stylesheet wrote it, quotes and all.
    return [...document.fonts].some(
      (face) => face.family.replace(/"/g, "") === "Inter" && face.status === "loaded",
    );
  });
}
