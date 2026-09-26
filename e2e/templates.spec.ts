import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, sceneElements } from "./board.ts";

const checkoutTemplate = fileURLToPath(
  new URL("../apps/web/src/lib/templates/checkout.osidraw.json", import.meta.url),
);

/**
 * The "Templates…" main-menu item: a host creates a fresh board and is taken to it, a
 * guest — refused by the gateway (`docker/gateway/Caddyfile` gives POST /v1/boards to the
 * host only) — gets the same template inserted into the board already open instead. Both
 * routes are registered *after* `openBoard`'s own catch-all, so they run first
 * (Playwright tries routes most-recently-registered first) and fall back to it for
 * anything they do not care about — the autosave PATCH this board's own page still sends.
 */

test("a host picks a template and is taken to the new board it creates", async ({ page }) => {
  await openBoard(page, "e2e");
  let createdWithTitle: string | null = null;

  await page.route("**/v1/boards", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createdWithTitle = (route.request().postDataJSON() as { title: string }).title;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { etag: '"0"' },
      body: JSON.stringify({ slug: "new-board", title: createdWithTitle, rev: 0 }),
    });
  });
  await page.route("**/v1/boards/new-board", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as { elements: unknown[] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { etag: '"1"' },
      body: JSON.stringify({
        slug: "new-board",
        title: createdWithTitle,
        rev: 1,
        scene: { type: "osidraw", version: 1, elements: body.elements },
      }),
    });
  });

  await page.getByRole("button", { name: "Open main menu" }).click();
  await page.getByRole("menuitem", { name: "Templates…" }).click();
  await page.getByRole("button", { name: /Checkout flow/ }).click();

  await expect(page).toHaveURL(/\/boards\/new-board(?:$|[?#])/);
  expect(createdWithTitle).toBe("Checkout flow");
});

test("a guest refused a new board gets the template inserted into this one", async ({ page }) => {
  const board = await openBoard(page, "e2e");

  await page.route("**/v1/boards", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "host_only", message: "guests cannot create boards" },
      }),
    });
  });

  const before = await sceneElements(page);
  expect(before).toEqual([]);

  await page.getByRole("button", { name: "Open main menu" }).click();
  await page.getByRole("menuitem", { name: "Templates…" }).click();
  await page.getByRole("button", { name: /Checkout flow/ }).click();

  // Inserted through `engine.pasteJson`, one undo step, the whole template.
  const { elements } = JSON.parse(await readFile(checkoutTemplate, "utf8")) as {
    elements: unknown[];
  };
  await expect.poll(async () => (await sceneElements(page)).length).toBe(elements.length);
  await expect(page).toHaveURL(/\/boards\/e2e(?:$|[?#])/);

  await focusBoard(board);
  await board.page.keyboard.press("Control+z");
  await expect.poll(async () => (await sceneElements(page)).length).toBe(0);
});
