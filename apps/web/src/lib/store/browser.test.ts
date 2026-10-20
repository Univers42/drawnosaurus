import { resolveObjectURL } from "node:buffer";
import { IDBFactory as FakeIDBFactory, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { slugSchema, type OsidrawFile } from "@drawnosaurus/contract";
import type { StampedElement } from "../autosave/sceneDiff.ts";

// `api/client.ts` (for `ApiClientError`) reads the runtime config, which reads this
// SvelteKit virtual module; vitest has no resolver for it. See `config.test.ts`.
vi.mock("$env/dynamic/public", () => ({ env: {} }));

const { ApiClientError } = await import("../api/client.ts");
const { openDraftDb } = await import("../autosave/draftDb.ts");
const { browserStore } = await import("./browser.ts");

interface Shape extends StampedElement {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  dataUrl?: string;
}

const shape = (id: string, more: Partial<Shape> = {}): Shape => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version: 1,
  versionNonce: 1,
  updated: 0,
  isDeleted: false,
  ...more,
});

/** A whole scene, as a full replace takes it. */
const file = (elements: Shape[]): OsidrawFile => ({
  type: "osidraw",
  version: 1,
  elements: elements as unknown as OsidrawFile["elements"],
});

/** A store over a database of its own, on a clock the test moves. */
function fresh() {
  // Local time, so the default title's day and month do not depend on the time zone.
  let now = new Date(2026, 9, 20, 12, 0, 0).getTime();
  const idb = new FakeIDBFactory();
  const store = browserStore({ idb, now: () => new Date(now) });
  return {
    store,
    idb,
    tick: (ms = 1000) => {
      now += ms;
    },
  };
}

/** What a promise rejected with, for asserting on an `ApiClientError`'s status. */
async function failure(promise: Promise<unknown>): Promise<{ status?: number }> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError);
    return error as { status: number };
  }
  throw new Error("expected a rejection");
}

const ids = (elements: readonly { id: string }[]) => elements.map((element) => element.id);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browserStore", () => {
  it("mints a slug of 26 base32 characters that the contract accepts", async () => {
    const { store } = fresh();

    const created = await store.create("Mine");

    expect(created.slug).toMatch(/^[a-z2-7]{26}$/);
    expect(slugSchema.safeParse(created.slug).success).toBe(true);
    expect(created).toMatchObject({ title: "Mine", elementCount: 0, rev: 1, bounds: null });
    expect((await store.create("Mine")).slug).not.toBe(created.slug);
  });

  it("is a 404 for a slug it does not hold", async () => {
    const { store } = fresh();

    expect((await failure(store.get("nosuchboard"))).status).toBe(404);
    expect((await failure(store.remove("nosuchboard"))).status).toBe(404);
    expect((await failure(store.putThumbnail("nosuchboard", new Blob(["png"])))).status).toBe(404);
  });

  it("lists one opened at its address once saved, and one created with a name at once", async () => {
    const { store, tick } = fresh();
    const created = await store.create("Nothing drawn");
    tick();

    const ack = await store.patchElements("firstsave1", {
      elements: [shape("a", { x: 5, y: 5, width: 20, height: -10 })],
    });

    expect(ack).toMatchObject({
      slug: "firstsave1",
      title: "Drawing — 20 Oct",
      elementCount: 1,
      bounds: { minX: 5, minY: -5, maxX: 25, maxY: 5 },
      applied: 1,
      rejected: 0,
    });
    const listed = await store.list();
    expect(listed.boards.map((board) => board.slug)).toEqual(["firstsave1", created.slug]);
    expect(listed.boards[0]).toMatchObject({ elementCount: 1, rev: ack.rev });
    expect(listed.nextCursor).toBeNull();
    // The created one keeps its title once something is on it.
    await store.patchElements(created.slug, { elements: [shape("b")] });
    expect((await store.get(created.slug)).title).toBe("Nothing drawn");
    expect((await store.list()).boards).toHaveLength(2);
  });

  it("lists a drawing created with a name before anything is drawn on it, reopened too", async () => {
    // Someone named it, so it is theirs to find. Only a drawing never named and never drawn
    // on stays out, and that one has no row: `/` opens it without writing one.
    const { store, idb } = fresh();
    const created = await store.create("Named, nothing drawn");

    const reopened = browserStore({ idb });

    const [listed] = (await reopened.list()).boards;
    expect(listed).toMatchObject({
      slug: created.slug,
      title: "Named, nothing drawn",
      elementCount: 0,
    });
  });

  it("moves its rev as the API does: 1 when made, 2 after the first save, 1 more per write", async () => {
    // `apps/api/src/boards/repository.ts`: `BoardRepository.create` writes `rev: 1`, and
    // `BoardRepository.commit` — the one write path, under `patchElements` and `replace` —
    // `$inc`s it by one on every write, whether the merge kept anything or not. A slug
    // first saved here, never created, starts where a created one does.
    const { store } = fresh();
    const created = await store.create("Made");
    expect(created.rev).toBe(1);
    expect((await store.patchElements(created.slug, { elements: [shape("a")] })).rev).toBe(2);

    expect((await store.patchElements("savedfirst1", { elements: [shape("a")] })).rev).toBe(2);
    const newer = await store.patchElements("savedfirst1", {
      elements: [shape("a", { version: 2 })],
    });
    expect(newer.rev).toBe(3);
    // Refused by the merge, and a write all the same.
    const older = await store.patchElements("savedfirst1", { elements: [shape("a")] });
    expect(older).toMatchObject({ applied: 0, rejected: 1, rev: 4 });
    expect((await store.get("savedfirst1")).rev).toBe(4);
    expect((await store.replace("savedfirst1", file([shape("b")]), 4)).rev).toBe(5);
  });

  it("keeps the newer of two copies of an element, whichever arrives last", async () => {
    const { store } = fresh();
    await store.patchElements("newer1", {
      elements: [shape("a", { version: 2, strokeColor: "#e03131" })],
    });

    const ack = await store.patchElements("newer1", {
      elements: [shape("a", { version: 1, strokeColor: "#1971c2" })],
    });

    expect(ack).toMatchObject({ applied: 0, rejected: 1 });
    const [stored] = (await store.get("newer1")).scene.elements;
    expect(stored).toMatchObject({ version: 2, strokeColor: "#e03131" });
  });

  it("keeps an image's stored picture when an edit arrives without it", async () => {
    const { store } = fresh();
    const picture = "data:image/png;base64,iVBORw0KGgo=";
    await store.patchElements("picture1", {
      elements: [shape("img", { type: "image", dataUrl: picture })],
    });

    // A move: the page left the picture off, as `PictureLedger.strip` does.
    await store.patchElements("picture1", {
      elements: [shape("img", { type: "image", version: 2, x: 40 })],
    });

    const [stored] = (await store.get("picture1")).scene.elements;
    expect(stored).toMatchObject({ version: 2, x: 40, dataUrl: picture });
  });

  it("stores tombstones, and returns them only when asked", async () => {
    const { store } = fresh();
    await store.patchElements("tomb1", { elements: [shape("a"), shape("b")] });

    const ack = await store.patchElements("tomb1", {
      elements: [shape("a", { version: 2, isDeleted: true })],
    });

    expect(ack.elementCount).toBe(1);
    expect(ids((await store.get("tomb1")).scene.elements)).toEqual(["b"]);
    const withTombstones = (await store.get("tomb1", { tombstones: true })).scene.elements;
    expect(withTombstones.map(({ id, isDeleted }) => ({ id, isDeleted }))).toEqual([
      { id: "a", isDeleted: true },
      { id: "b", isDeleted: false },
    ]);
  });

  it("puts new elements on top, and follows the order a patch sends", async () => {
    const { store } = fresh();
    await store.patchElements("order1", { elements: [shape("c"), shape("a"), shape("b")] });
    expect(ids((await store.get("order1")).scene.elements)).toEqual(["c", "a", "b"]);

    await store.patchElements("order1", { elements: [], order: ["b", "c", "a"] });
    expect(ids((await store.get("order1")).scene.elements)).toEqual(["b", "c", "a"]);

    await store.patchElements("order1", { elements: [shape("d")] });
    expect(ids((await store.get("order1")).scene.elements)).toEqual(["b", "c", "a", "d"]);
  });

  it("lists newest first, a page at a time, with nothing repeated or skipped", async () => {
    const { store, tick } = fresh();
    await store.patchElements("oldest1", { elements: [shape("a")] });
    tick();
    // Two in the same millisecond: the cursor has to split them exactly.
    await store.patchElements("tiea1", { elements: [shape("a")] });
    await store.patchElements("tieb1", { elements: [shape("a")] });
    tick();
    await store.patchElements("newest1", { elements: [shape("a")] });

    const first = await store.list(3);
    expect(first.boards.map((board) => board.slug)).toEqual(["newest1", "tieb1", "tiea1"]);
    expect(first.nextCursor).not.toBeNull();

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.list(1, cursor);
      seen.push(...page.boards.map((board) => board.slug));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toEqual(["newest1", "tieb1", "tiea1", "oldest1"]);
  });

  it("refuses a replace from a stale rev with a 409, and replaces the scene otherwise", async () => {
    const { store } = fresh();
    const created = await store.create("Template");
    await store.patchElements(created.slug, { elements: [shape("old")] });
    const current = await store.get(created.slug);

    const replaced = await store.replace(
      created.slug,
      file([shape("new", { width: 30 })]),
      current.rev,
    );

    expect(replaced.rev).toBe(current.rev + 1);
    expect(ids(replaced.scene.elements)).toEqual(["new"]);
    expect(replaced).toMatchObject({
      elementCount: 1,
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
    });
    expect(ids((await store.get(created.slug, { tombstones: true })).scene.elements)).toEqual([
      "new",
    ]);
    const stale = store.replace(created.slug, file([]), current.rev);
    expect((await failure(stale)).status).toBe(409);
  });

  it("removes the row, the elements, the order and the picture", async () => {
    const { store, idb } = fresh();
    await store.patchElements("gone1", { elements: [shape("a"), shape("b")], order: ["b", "a"] });
    await store.putThumbnail("gone1", new Blob(["png"]));
    await store.patchElements("kept1", { elements: [shape("a")] });

    await store.remove("gone1");

    expect((await failure(store.get("gone1"))).status).toBe(404);
    expect((await store.list()).boards.map((board) => board.slug)).toEqual(["kept1"]);
    const database = await openDraftDb(idb);
    const tx = database.transaction(["elements", "boards", "drawings"], "readonly");
    const elements = tx.objectStore("elements").index("slug").count("gone1");
    const order = tx.objectStore("boards").get("gone1");
    const row = tx.objectStore("drawings").get("gone1");
    const kept = tx.objectStore("elements").index("slug").count("kept1");
    await new Promise((resolve) => (tx.oncomplete = resolve));
    expect([elements.result, order.result, row.result, kept.result]).toEqual([
      0,
      undefined,
      undefined,
      1,
    ]);
    database.close();
  });

  it("stores a picture without touching the rev or the order of the gallery", async () => {
    const { store, tick } = fresh();
    const saved = await store.patchElements("thumb1", { elements: [shape("a")] });
    expect(await store.thumbnail("thumb1", "none")).toBeNull();
    tick();

    await store.putThumbnail("thumb1", new Blob(["the png"], { type: "image/png" }));

    const [row] = (await store.list()).boards;
    expect(row).toMatchObject({ rev: saved.rev, updatedAt: saved.updatedAt });
    expect(row?.thumbnailAt).toBe(new Date(2026, 9, 20, 12, 0, 1).toISOString());
    const url = await store.thumbnail("thumb1", row?.thumbnailAt ?? "");
    expect(url).toMatch(/^blob:/);
    expect(await resolveObjectURL(url ?? "")?.text()).toBe("the png");
    URL.revokeObjectURL(url ?? "");
  });

  it("turns a full quota into a 413, and leaves what was stored as it was", async () => {
    const { store } = fresh();
    await store.patchElements("full1", { elements: [shape("a")] });
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("the quota is used up", "QuotaExceededError");
    });

    const refused = store.patchElements("full1", { elements: [shape("b")] });

    expect((await failure(refused)).status).toBe(413);
    vi.restoreAllMocks();
    const board = await store.get("full1");
    expect(ids(board.scene.elements)).toEqual(["a"]);
    expect(board.elementCount).toBe(1);
  });

  it("reports any other storage failure as a 5xx, never as a save", async () => {
    const { store } = fresh();
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("cannot be cloned", "DataCloneError");
    });

    const status = (await failure(store.patchElements("broken1", { elements: [shape("a")] })))
      .status;

    expect(status).toBeGreaterThanOrEqual(500);
    expect(status).toBeLessThan(600);
  });
});
