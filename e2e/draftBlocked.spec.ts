import { expect, test } from "./fixtures.ts";
import { openBoard, sceneElements, type SceneElement } from "./board.ts";

/**
 * A board opened while another tab still runs the code from before the drafts database
 * went to version 2.
 *
 * That tab holds `drawnosaurus-drafts` open at version 1 and has no `onversionchange`
 * handler, so it never lets go: the version-2 open waits for it (`draftDb.ts`), and so does
 * every read of the draft. The board page reads the draft only to repair what the server
 * stripped, so the server's answer must not wait on it for long.
 */

const SLUG = "blocked1";

const rectangle = (id: string, x: number): SceneElement & Record<string, unknown> => ({
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

test("a board opens while an older tab holds the version-1 database", async ({ context, page }) => {
  // The older tab: a page of the app's origin that does not run the app, holding the
  // database exactly as the version-1 code did.
  const older = await context.newPage();
  await older.goto("/favicon.svg");
  await older.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("drawnosaurus-drafts", 1);
        request.onupgradeneeded = () => {
          const created = request.result;
          created
            .createObjectStore("elements", { keyPath: ["slug", "id"] })
            .createIndex("slug", "slug");
          created.createObjectStore("boards", { keyPath: "slug" });
        };
        // Kept open, with no `onversionchange`: what a tab on the old code does.
        request.onsuccess = () => {
          (window as { held?: IDBDatabase }).held = request.result;
          resolve();
        };
        request.onerror = () => reject(request.error);
      }),
  );

  await openBoard(page, SLUG, { scene: [rectangle("a", 0), rectangle("b", 200)] });

  await expect
    .poll(async () => (await sceneElements(page)).map(({ id }) => id))
    .toEqual(["a", "b"]);
  // Still held: the board opened despite it, not because it went away.
  expect(await older.evaluate(() => (window as { held?: IDBDatabase }).held?.version)).toBe(1);
});
