import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openDraftDb } from "./draftDb.ts";

/**
 * The database as every browser that ran this app before the public build has it: made by
 * `indexedDbBackend`'s version-1 upgrade, copied here verbatim so the test does not move
 * with the code it is checking.
 */
function openVersion1(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open("drawnosaurus-drafts", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const elements = database.createObjectStore("elements", { keyPath: ["slug", "id"] });
      elements.createIndex("slug", "slug");
      database.createObjectStore("boards", { keyPath: "slug" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const settled = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);

describe("openDraftDb", () => {
  it("creates the elements, boards and drawings stores on a fresh open", async () => {
    const database = await openDraftDb(new FakeIDBFactory());

    expect(database.name).toBe("drawnosaurus-drafts");
    expect(database.version).toBe(2);
    expect([...database.objectStoreNames].sort()).toEqual(["boards", "drawings", "elements"]);
    const tx = database.transaction(["elements", "boards", "drawings"], "readonly");
    expect(tx.objectStore("elements").keyPath).toEqual(["slug", "id"]);
    expect([...tx.objectStore("elements").indexNames]).toEqual(["slug"]);
    expect(tx.objectStore("boards").keyPath).toBe("slug");
    expect(tx.objectStore("drawings").keyPath).toBe("slug");
    expect([...tx.objectStore("drawings").indexNames]).toEqual(["updatedAt"]);
    database.close();
  });

  it("brings a version-1 database to version 2 with every element and order intact", async () => {
    const idb = new FakeIDBFactory();
    const old = await openVersion1(idb);
    const write = old.transaction(["elements", "boards"], "readwrite");
    const rows = [
      { slug: "b1", id: "a", element: { id: "a", type: "rectangle", version: 3 } },
      { slug: "b1", id: "b", element: { id: "b", type: "image", dataUrl: "data:image/png;x" } },
      { slug: "b2", id: "a", element: { id: "a", type: "ellipse", version: 1 } },
    ];
    for (const row of rows) write.objectStore("elements").put(row);
    write.objectStore("boards").put({ slug: "b1", order: ["b", "a"] });
    write.objectStore("boards").put({ slug: "b2", order: ["a"] });
    await done(write);
    old.close();

    const database = await openDraftDb(idb);

    expect(database.version).toBe(2);
    const read = database.transaction(["elements", "boards", "drawings"], "readonly");
    const elements = read.objectStore("elements").getAll();
    const b1 = read.objectStore("elements").index("slug").getAll("b1");
    const orders = read.objectStore("boards").getAll();
    const drawings = read.objectStore("drawings").count();
    await done(read);
    expect(elements.result).toEqual(rows);
    expect(b1.result).toEqual(rows.slice(0, 2));
    expect(orders.result).toEqual([
      { slug: "b1", order: ["b", "a"] },
      { slug: "b2", order: ["a"] },
    ]);
    expect(drawings.result).toBe(0);
    database.close();
  });

  it("closes when a newer version asks, so that tab is never blocked by this one", async () => {
    const idb = new FakeIDBFactory();
    await openDraftDb(idb);

    const newer = new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open("drawnosaurus-drafts", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    expect(await settled(newer)).toBe(true);
    expect((await newer).version).toBe(3);
  });

  it("waits for an older tab holding version 1 to let go, rather than failing", async () => {
    const idb = new FakeIDBFactory();
    // Today's code sets no `onversionchange`: the tab keeps its connection until it closes.
    const old = await openVersion1(idb);

    const upgrade = openDraftDb(idb);
    expect(await settled(upgrade)).toBe(false);

    old.close();
    expect((await upgrade).version).toBe(2);
  });
});
