import { expect, test } from "./fixtures.ts";
import { openBoard } from "./board.ts";

/**
 * The product's name, as a person reads it: the header of the gallery and the title of a
 * board's tab. Storage keys and headers keep the old name on purpose (they are
 * identifiers, and renaming one orphans what people already saved), so this asserts on
 * the visible text only.
 */

test("the gallery header names the product Hydrawn", async ({ page }) => {
  await page.route("**/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ boards: [], nextCursor: null }),
    }),
  );
  await page.goto("/");

  const brand = page.locator("a.brand");
  await expect(brand).toHaveText("Hydrawn");
  await expect(brand).not.toContainText(/drawnosaurus/i);
});

test("a board's tab title ends with the product name", async ({ page }) => {
  await openBoard(page, "brand1");
  await expect.poll(() => page.title()).toMatch(/ · Hydrawn$/);
});
