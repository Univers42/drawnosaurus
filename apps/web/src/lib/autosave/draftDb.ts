/**
 * The browser's one database, opened the same way by both builds.
 *
 * Version 1 is the drafts (`draftStore.ts`): each element by `[slug, id]`, and each
 * board's order by slug. Version 2 adds the public build's gallery rows (`store/browser.ts`)
 * beside them, over the same elements and orders. The name stays `drawnosaurus-drafts`
 * through the rename to Hydrawn: a new name would be an empty database, and every draft
 * this browser holds would be gone.
 */

export const ELEMENTS = "elements";
export const BOARDS = "boards";
export const DRAWINGS = "drawings";

const NAME = "drawnosaurus-drafts";
const VERSION = 2;

export function openDraftDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // An older tab with version 1 open blocks the upgrade until it lets go. Not a failure:
    // the open completes then, and a tab running this code lets go at once (below). A tab
    // still running the code from before version 2 holds on until it is closed or reloaded.
    const request = idb.open(NAME, VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      // One step per version, so a database at any older version is brought up through
      // each in turn, and what it holds is kept.
      if (event.oldVersion < 1) {
        const elements = database.createObjectStore(ELEMENTS, { keyPath: ["slug", "id"] });
        elements.createIndex("slug", "slug");
        database.createObjectStore(BOARDS, { keyPath: "slug" });
      }
      if (event.oldVersion < 2) {
        const drawings = database.createObjectStore(DRAWINGS, { keyPath: "slug" });
        drawings.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      // A newer version in another tab: step aside so it is never blocked by this one.
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
  });
}
