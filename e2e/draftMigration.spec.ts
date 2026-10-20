import { expect, test } from "./fixtures.ts";
import { sceneElements, stubRealtimeHandshake } from "./board.ts";

/**
 * The browser's database, `drawnosaurus-drafts`, going from version 1 to version 2 under
 * a board whose draft is the only copy left.
 *
 * Every browser that ran this app before the public build has a version-1 database: two
 * stores, the elements and each board's order. Version 2 adds the public build's gallery
 * rows beside them. The upgrade runs the first time a page opens the database, so here the
 * page that opens it is a board the server cannot serve, which falls back to its draft —
 * if the upgrade lost anything, that is the board the person would get back empty.
 */

const SLUG = "drafted1";

const rectangle = (id: string, x: number) => ({
  id,
  type: "rectangle",
  x,
  y: 0,
  width: 120,
  height: 80,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "#a5d8ff",
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

test("a board drafted in a version-1 database opens whole after the upgrade", async ({ page }) => {
  await page.routeWebSocket(/\/(live|ws)$/, stubRealtimeHandshake);
  // Unreachable, so the board can only come from the draft.
  await page.route("**/v1/**", (route) => route.abort());

  // The database is per origin, so it is seeded from a page of the app's origin that does
  // not run the app: the favicon. The board page must be the first thing to open it.
  await page.goto("/favicon.svg");
  await page.evaluate(
    async ({ slug, elements, order }) => {
      // `indexedDbBackend`'s version-1 upgrade, as every older browser ran it.
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("drawnosaurus-drafts", 1);
        request.onupgradeneeded = () => {
          const created = request.result;
          created
            .createObjectStore("elements", { keyPath: ["slug", "id"] })
            .createIndex("slug", "slug");
          created.createObjectStore("boards", { keyPath: "slug" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["elements", "boards"], "readwrite");
        for (const element of elements) {
          tx.objectStore("elements").put({ slug, id: element.id, element });
        }
        tx.objectStore("boards").put({ slug, order });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    },
    // Stacked against the order the ids sort in, so a lost order shows.
    { slug: SLUG, elements: [rectangle("a", 0), rectangle("b", 200)], order: ["b", "a"] },
  );

  await page.goto(`/boards/${SLUG}`);
  await page.waitForFunction(() => window.__drawEngine !== undefined);

  await expect
    .poll(async () => (await sceneElements(page)).map(({ id, x }) => ({ id, x })))
    .toEqual([
      { id: "b", x: 200 },
      { id: "a", x: 0 },
    ]);
  const version = await page.evaluate(
    async () =>
      (await indexedDB.databases()).find((database) => database.name === "drawnosaurus-drafts")
        ?.version,
  );
  expect(version).toBe(2);
});
