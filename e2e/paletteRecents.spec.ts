import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, sceneElements } from "./board.ts";

/**
 * The palette remembers the one command you last ran and offers it again on the next open
 * (`docs/reference/palette.md` › What it remembers, from
 * `CommandPalette.tsx@1118751f:85,844-857,915-938`).
 *
 * `commandPalette.test.ts` pins the ranking as a pure function, and it cannot reach any of
 * this: the memory has to outlive the dialog, which unmounts on close, so the part worth
 * proving in a browser is the round trip — that a run survives closing the palette, that the
 * row comes back *alone*, out of the category it was declared in, and that a fresh open with
 * an empty query has it selected so Enter re-runs it. An N-row list would pass every unit
 * test here and fail this one.
 */

const input = (page: Page) => page.getByRole("combobox", { name: "Command palette" });
const group = (page: Page, label: string) =>
  page
    .locator(".palette-group")
    .filter({ has: page.locator(".palette-group-label", { hasText: new RegExp(`^${label}$`) }) });

/** Run one command by typing its name: open, type, Enter. */
async function run(page: Page, query: string): Promise<void> {
  await page.keyboard.press("Control+/");
  await expect(input(page)).toBeFocused();
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
  await expect(input(page), "the palette closed on running a command").toHaveCount(0);
}

test("the palette offers the one command you last ran, above the categories, and preselects it", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);

  // Two runs, so "one remembered command" is a claim about a history and not about a
  // single run. Both have a visible consequence, so a run cannot pass by only closing.
  await run(page, "add rectangle");
  expect(await sceneElements(page), "the first command really ran").toHaveLength(1);

  await run(page, "add ellipse");
  expect(await sceneElements(page)).toHaveLength(2);

  // Reopened with an empty query — the browsing case, where the oracle shows the recents
  // row at all (`:844-845` hides it the moment a query is typed).
  await page.keyboard.press("Control+/");
  await expect(input(page)).toBeFocused();

  const recents: Locator = group(page, "Recents");
  await expect(recents, "the run command is offered in a group of its own").toHaveCount(1);
  await expect(recents.getByRole("option"), "and it holds exactly one row").toHaveCount(1);
  await expect(recents.getByRole("option")).toHaveText(/Add ellipse/);

  // Above the categories, not inside one of them.
  await expect(
    page.locator(".palette-group").first(),
    "Recents is the first group, so it is the row Enter would take",
  ).toHaveClass(/palette-group/);
  await expect(page.locator(".palette-group").first().locator(".palette-group-label")).toHaveText(
    "Recents",
  );

  // The oracle takes the row *out* of the category it was declared in (`:844-857`), so it
  // appears exactly once in the whole list, not twice.
  const labels = page.locator(".palette-item__label");
  await expect(labels.filter({ hasText: /^Add ellipse$/ }), "offered once, in Recents").toHaveCount(
    1,
  );
  await expect(
    labels.filter({ hasText: /^Add rectangle$/ }),
    "the earlier run is back in Insert, not still remembered",
  ).toHaveCount(1);
  await expect(
    group(page, "Insert")
      .getByRole("option")
      .filter({ hasText: /^Add ellipse$/ }),
    "and Add ellipse is no longer in its own category",
  ).toHaveCount(0);

  // A fresh open has the remembered row selected, so Enter re-runs it (`:857`).
  await expect(recents.getByRole("option")).toHaveAttribute("aria-selected", "true");

  // Escape closes without running anything, and the memory is untouched by that.
  await page.keyboard.press("Escape");
  await expect(input(page)).toHaveCount(0);
  await expect(
    await sceneElements(page),
    "Escape ran nothing — still the two shapes the two commands inserted",
  ).toHaveLength(2);

  await page.keyboard.press("Control+/");
  await expect(group(page, "Recents").getByRole("option")).toHaveText(/Add ellipse/);
  await page.keyboard.press("Escape");
});

test("a query hides the recents group, and the palette starts empty of one", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);

  // Nothing run yet: no recents group, so a first open is not led by a stale row.
  await page.keyboard.press("Control+/");
  await expect(input(page)).toBeFocused();
  await expect(group(page, "Recents")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await run(page, "add rectangle");

  await page.keyboard.press("Control+/");
  await expect(input(page)).toBeFocused();
  await expect(group(page, "Recents")).toHaveCount(1);

  // `showLastUsed` needs an empty search (`:844-845`): the ranked results are the answer.
  await page.keyboard.type("add");
  await expect(group(page, "Recents"), "a query outranks the memory entirely").toHaveCount(0);
  await expect(page.locator(".palette-group")).toHaveCount(1);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
});
