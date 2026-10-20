import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, sceneElements, type SceneElement } from "./board.ts";

const checkoutTemplate = fileURLToPath(
  new URL("../apps/web/src/lib/templates/checkout.osidraw.json", import.meta.url),
);

/**
 * Going from one board to another without leaving the board route.
 *
 * Picking a template inside board A creates board B and goes to `/boards/B`. SvelteKit
 * keeps a page component when only its params change, so the page built for A — its scene,
 * its saver, its draft — would go on as the page for B. The stubs are `templates.spec.ts`'s:
 * the dialog creates B and fills it, and B is served back as it was filled. Both routes are
 * registered after `openBoard`'s catch-all, so they run first.
 */

const A = "boarda1";
const B = "boardb1";

const rectangle = (id: string): SceneElement & Record<string, unknown> => ({
  id,
  type: "rectangle",
  x: -400,
  y: -300,
  width: 120,
  height: 80,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  roundness: null,
  seed: 1,
  groupIds: [],
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
});

test("a template picked inside a board opens the new board, and A's edit is saved to A", async ({
  page,
}) => {
  /** Every PATCH the page sent: where to, and the ids it carried. */
  const sent: { path: string; ids: string[] }[] = [];
  page.on("request", (request) => {
    if (request.method() !== "PATCH") return;
    const body = request.postDataJSON() as { elements?: SceneElement[] } | null;
    sent.push({
      path: new URL(request.url()).pathname,
      ids: (body?.elements ?? []).map(({ id }) => id),
    });
  });

  const { box } = await openBoard(page, A, { scene: [rectangle("a1")] });

  let filled: unknown[] = [];
  await page.route("**/v1/boards", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { title } = route.request().postDataJSON() as { title: string };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { etag: '"1"' },
      body: JSON.stringify({ slug: B, title, rev: 1 }),
    });
  });
  await page.route(`**/v1/boards/${B}`, async (route) => {
    const method = route.request().method();
    if (method !== "PUT" && method !== "GET") return route.fallback();
    if (method === "PUT") {
      filled = (route.request().postDataJSON() as { elements: unknown[] }).elements;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { etag: '"2"' },
      body: JSON.stringify({
        slug: B,
        title: "Checkout flow",
        rev: 2,
        scene: { type: "osidraw", version: 1, elements: filled },
      }),
    });
  });

  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + OPEN_CANVAS.left + 60, box.y + OPEN_CANVAS.top + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + OPEN_CANVAS.left + 300, box.y + OPEN_CANVAS.top + 220, {
    steps: 8,
  });
  await page.mouse.up();
  const drawn = (await sceneElements(page)).find(({ id }) => id !== "a1");
  if (!drawn) throw new Error("the rectangle was not drawn");
  const carrying = () => sent.filter(({ ids }) => ids.includes(drawn.id));

  await page.getByRole("button", { name: "Open main menu" }).click();
  await page.getByRole("menuitem", { name: "Templates…" }).click();
  // Inside the 800 ms autosave debounce: A's edit is still waiting when the router moves.
  expect(carrying(), "A's save has not been sent yet").toEqual([]);
  await page.getByRole("button", { name: /Checkout flow/ }).click();

  await expect(page).toHaveURL(new RegExp(`/boards/${B}(?:$|[?#])`));
  const { elements } = JSON.parse(await readFile(checkoutTemplate, "utf8")) as {
    elements: { id: string }[];
  };
  const shown = () =>
    page.evaluate(() => {
      const engine = window.__drawEngine;
      if (!engine) return null;
      const scene = JSON.parse(engine.exportJson()) as {
        elements: { id: string; isDeleted?: boolean }[];
      };
      return scene.elements.filter((element) => !element.isDeleted).map(({ id }) => id);
    });
  await expect
    .poll(async () => (await shown())?.sort() ?? null, { message: "the canvas shows B" })
    .toEqual(elements.map(({ id }) => id).sort());

  // A's edit went out as the router left A — to A.
  await expect.poll(() => carrying().length, { message: "A's edit was saved" }).toBeGreaterThan(0);
  // One autosave debounce (800 ms) more, so a save the switch armed has had time to go.
  await page.waitForTimeout(1_000);
  expect(carrying().map(({ path }) => path)).toEqual(
    carrying().map(() => `/v1/boards/${A}/elements`),
  );
  const toB = sent.filter(({ path }) => path.startsWith(`/v1/boards/${B}/`));
  expect(
    toB.flatMap(({ ids }) => ids).filter((id) => id === "a1" || id === drawn.id),
    "nothing of A's was saved to B",
  ).toEqual([]);
});
