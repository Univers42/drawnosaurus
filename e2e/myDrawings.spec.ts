import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  OPEN_CANVAS,
  pickTool,
  sceneElements,
  stubRealtimeHandshake,
  type SceneElement,
} from "./board.ts";

/**
 * Getting out of a board and back to the gallery without losing the last stroke.
 *
 * The stub serves one board, "mine1", in the gallery list and by slug, and records every
 * PATCH. It starts the run at `/` and clicks the card, rather than going to the board
 * with `openBoard`, because the bug is about *in-app* navigation: the board page is torn
 * down by the router, not by the browser leaving.
 */

const SLUG = "mine1";
/** The board adds a `#room=…` fragment to its own address when it opens. */
const BOARD_URL = new RegExp(`/boards/${SLUG}(#.*)?$`);

interface Stub {
  /** Every element the page PATCHed, flattened across requests. */
  patched: SceneElement[];
}

async function stubApi(page: Page): Promise<Stub> {
  const stub: Stub = { patched: [] };
  await page.routeWebSocket(/\/(live|ws)$/, stubRealtimeHandshake);
  await page.route("**/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (pathname.endsWith("/thumbnail")) {
      await route.fulfill({ status: route.request().method() === "PUT" ? 204 : 404 });
    } else if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { elements?: SceneElement[] } | null;
      stub.patched.push(...(body?.elements ?? []));
      await json({});
    } else if (pathname === `/v1/boards/${SLUG}`) {
      await json({
        slug: SLUG,
        title: "Mine",
        scene: { type: "osidraw", version: 1, source: "e2e", elements: [] },
      });
    } else if (pathname === "/v1/boards") {
      await json({
        boards: [
          {
            slug: SLUG,
            title: "Mine",
            elementCount: 0,
            bounds: null,
            rev: 1,
            createdAt: "2026-10-17T10:00:00.000Z",
            updatedAt: "2026-10-17T10:00:00.000Z",
          },
        ],
        nextCursor: null,
      });
    } else {
      await json({});
    }
  });
  return stub;
}

/** From the gallery into the board by its card, then waits for the engine as `openBoard` does. */
async function enterBoard(page: Page): Promise<{ x: number; y: number }> {
  await page.goto("/");
  await page.getByRole("link", { name: /Mine/ }).click();
  await expect(page).toHaveURL(BOARD_URL);
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForFunction(() => window.__drawEngine !== undefined);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the canvas has no box to aim at");
  return box;
}

async function drawRectangle(page: Page, box: { x: number; y: number }): Promise<void> {
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + OPEN_CANVAS.left + 60, box.y + OPEN_CANVAS.top + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + OPEN_CANVAS.left + 300, box.y + OPEN_CANVAS.top + 220, {
    steps: 8,
  });
  await page.mouse.up();
}

const sentRectangle = (stub: Stub) => stub.patched.some((element) => element.type === "rectangle");

test("leaving a board by Back sends the stroke still inside the debounce", async ({ page }) => {
  const stub = await stubApi(page);
  const box = await enterBoard(page);

  await drawRectangle(page, box);
  // Drawn, so a missing PATCH below is the save and not the gesture.
  expect(await sceneElements(page)).toHaveLength(1);
  // No wait for the 800 ms debounce: the point is what is pending when the router leaves.
  await page.goBack();

  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => sentRectangle(stub), { timeout: 5_000 }).toBe(true);
});

test("My drawings goes to the gallery and the card comes back to the board", async ({ page }) => {
  await stubApi(page);
  await enterBoard(page);

  await page.getByRole("button", { name: "Open main menu" }).click();
  const item = page.getByRole("menuitem", { name: "My drawings" });
  await expect(item).toBeVisible();
  await item.click();

  await expect(page).toHaveURL(/\/gallery$/);
  const card = page.getByRole("link", { name: /Mine/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(BOARD_URL);
});

test("My drawings sends the stroke still inside the debounce", async ({ page }) => {
  const stub = await stubApi(page);
  const box = await enterBoard(page);

  await drawRectangle(page, box);
  await page.getByRole("button", { name: "Open main menu" }).click();
  await page.getByRole("menuitem", { name: "My drawings" }).click();

  await expect(page).toHaveURL(/\/gallery$/);
  await expect.poll(() => sentRectangle(stub), { timeout: 5_000 }).toBe(true);
});
