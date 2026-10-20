import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board } from "@drawnosaurus/contract";
import type { DrawElement } from "@osionos/draw-engine/types";
import legacyBoard from "../notes/fixtures/legacy-sticky-zxkqwodsxu.json";

// `api/client.ts` (for `ApiClientError`) reads the runtime config, which reads this
// SvelteKit virtual module; vitest has no resolver for it. See `config.test.ts`.
vi.mock("$env/dynamic/public", () => ({ env: {} }));

const { ApiClientError } = await import("../api/client.ts");
const { DRAFT_REPAIR_WAIT_MS, openBoard } = await import("./openBoard.ts");

const SLUG = "board1";
const LEGACY_KEY = `drawnosaurus:draft:${SLUG}`;
/** Local time, so the default title's day and month do not depend on the time zone. */
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();
const nonce = () => 7;

const el = (id: string, more: Record<string, unknown> = {}): DrawElement =>
  ({
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 3,
    versionNonce: 30,
    updated: 1,
    isDeleted: false,
    ...more,
  }) as unknown as DrawElement;

const ids = (elements: readonly { id: string }[]) => elements.map((element) => element.id);

const board = (elements: readonly DrawElement[], more: Partial<Board> = {}): Board => ({
  slug: SLUG,
  title: "Mine",
  elementCount: elements.length,
  bounds: null,
  rev: 2,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  thumbnailAt: null,
  scene: { type: "osidraw", version: 1, elements: [...elements] as Board["scene"]["elements"] },
  ...more,
});

/** A `Storage` over a map, every method a spy, so a test can say nothing touched it. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: vi.fn(() => map.clear()),
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    key: vi.fn((index: number) => [...map.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
  } satisfies Storage;
}

function setup({
  browser = false,
  get,
  draft = Promise.resolve(null),
  legacy,
  stored,
}: {
  browser?: boolean;
  get: () => Promise<Board>;
  draft?: Promise<DrawElement[] | null>;
  legacy?: readonly DrawElement[];
  /** The public build's: the online copy, read when this browser holds none of it. */
  stored?: { read: () => Promise<{ rev: number; elements: DrawElement[] } | null> };
}) {
  const storage = memoryStorage(
    legacy === undefined
      ? {}
      : { [LEGACY_KEY]: JSON.stringify({ type: "osidraw", version: 1, elements: legacy }) },
  );
  const drafts = { load: vi.fn(() => draft), record: vi.fn() };
  const store = { get: vi.fn(get) };
  const open = () =>
    openBoard({ slug: SLUG, browser, store, drafts, storage, stored, now: () => NOW, nonce });
  return { open, storage, drafts, store };
}

const unreachable = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openBoard on the server path", () => {
  it("opens the server's copy, repaired from the draft where the server stripped it", async () => {
    const URL_ = "https://www.youtube.com/embed/abc";
    const { open, store, drafts } = setup({
      get: async () => board([el("video", { type: "embed" }), el("box")]),
      // The same edit of the video with its page, and a shape the server never had.
      draft: Promise.resolve([el("video", { type: "embed", embedUrl: URL_ }), el("ghost")]),
    });

    const opened = await open();

    expect(store.get).toHaveBeenCalledWith(SLUG);
    expect(drafts.load).toHaveBeenCalledWith(SLUG);
    expect(opened.title).toBe("Mine");
    // The tracker starts from what the server has, so the repair outranks it.
    expect(ids(opened.loaded)).toEqual(["video", "box"]);
    expect(opened.loaded[0]).not.toHaveProperty("embedUrl");
    // The server's copy decides what is on the board: the draft only gives back fields.
    expect(ids(opened.elements)).toEqual(["video", "box"]);
    expect(opened.elements[0]).toMatchObject({
      embedUrl: URL_,
      version: 4,
      versionNonce: 7,
      updated: NOW,
    });
    expect(opened.resave).toEqual(["video"]);
    expect(opened.tombstones).toEqual([]);
    expect(opened.needsThumbnailBackfill).toBe(true);
    expect(opened.failure).toBeNull();
  });

  it("waits for the draft no longer than the bound, then opens the server's copy unrepaired", async () => {
    // A tab still on the version-1 database holds the upgrade, and the draft's read with it.
    const { open } = setup({
      get: async () => board([el("video", { type: "embed" })]),
      draft: new Promise(() => undefined),
    });

    const opening = open();
    let settled = false;
    void opening.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(DRAFT_REPAIR_WAIT_MS - 1);
    expect(settled, "still inside the bound").toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const opened = await opening;

    expect(DRAFT_REPAIR_WAIT_MS).toBe(1000);
    expect(ids(opened.elements)).toEqual(["video"]);
    expect(opened.elements[0]).not.toHaveProperty("embedUrl");
    expect(opened.resave).toEqual([]);
  });

  it("opens the draft when the server cannot be reached, however long it takes", async () => {
    // Offline the draft is the only copy, so there is no bound on waiting for it.
    const draft = new Promise<DrawElement[]>((resolve) => {
      setTimeout(() => resolve([el("b"), el("a")]), DRAFT_REPAIR_WAIT_MS * 10);
    });
    const { open } = setup({ get: unreachable, draft, legacy: [el("old")] });

    const opening = open();
    let settled = false;
    void opening.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(DRAFT_REPAIR_WAIT_MS * 10 - 1);
    expect(settled, "still waiting for the draft").toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const opened = await opening;

    expect(ids(opened.elements)).toEqual(["b", "a"]);
    expect(ids(opened.loaded)).toEqual(["b", "a"]);
    expect(opened.title).toBe(`Board ${SLUG}`);
    expect(opened.failure).toBeNull();
  });

  it("opens the copy an older page kept in localStorage when there is neither server nor draft", async () => {
    const { open, storage } = setup({ get: unreachable, legacy: [el("old")] });

    const opened = await open();

    expect(ids(opened.elements)).toEqual(["old"]);
    expect(ids(opened.loaded)).toEqual(["old"]);
    expect(opened.title).toBe(`Board ${SLUG}`);
    // Kept: it is the only copy there is.
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("removes the localStorage copy once the server has answered", async () => {
    const { open, storage } = setup({ get: async () => board([el("a")]), legacy: [el("old")] });

    const opened = await open();

    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_KEY);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
    expect(ids(opened.elements)).toEqual(["a"]);
  });

  it("asks for no picture when the board already has one, or has nothing on it", async () => {
    const pictured = setup({
      get: async () => board([el("a")], { thumbnailAt: "2026-10-20T10:00:00.000Z" }),
    });
    const empty = setup({ get: async () => board([el("gone", { isDeleted: true })]) });

    expect((await pictured.open()).needsThumbnailBackfill).toBe(false);
    expect((await empty.open()).needsThumbnailBackfill).toBe(false);
  });
});

describe("openBoard on the browser path", () => {
  it("opens a stored drawing with its title, its elements and their order", async () => {
    const { open, store } = setup({
      browser: true,
      get: async () => board([el("b"), el("a")], { title: "Drawing — 19 Oct" }),
    });

    const opened = await open();

    expect(store.get).toHaveBeenCalledWith(SLUG);
    expect(opened.title).toBe("Drawing — 19 Oct");
    expect(ids(opened.elements)).toEqual(["b", "a"]);
    expect(ids(opened.loaded)).toEqual(["b", "a"]);
    expect(opened.resave).toEqual([]);
    expect(opened.needsThumbnailBackfill).toBe(true);
    expect(opened.failure).toBeNull();
  });

  it("opens a drawing it does not hold as a new one, empty, with the store's default title", async () => {
    const { open } = setup({
      browser: true,
      get: () => Promise.reject(new ApiClientError(404, "not_found", "board not found")),
    });

    const opened = await open();

    expect(opened.title).toBe("Drawing — 20 Oct");
    expect(opened.elements).toEqual([]);
    expect(opened.loaded).toEqual([]);
    expect(opened.needsThumbnailBackfill).toBe(false);
    expect(opened.failure).toBeNull();
  });

  it("reports a drawing it could not read, rather than opening it as a new one", async () => {
    const refused = new ApiClientError(500, "storage_failed", "the browser could not read it");
    const { open } = setup({ browser: true, get: () => Promise.reject(refused) });

    const opened = await open();

    expect(opened.failure).toBe(refused);
    expect(opened.title).not.toBe("Drawing — 20 Oct");
    expect(opened.elements).toEqual([]);
    expect(opened.loaded).toEqual([]);
  });

  it("reads no draft and no localStorage copy, whatever the store answers", async () => {
    for (const get of [
      async () => board([el("a")]),
      () => Promise.reject(new ApiClientError(404, "not_found", "board not found")),
      () => Promise.reject(new ApiClientError(500, "storage_failed", "no")),
    ]) {
      const { open, drafts, storage } = setup({
        browser: true,
        get,
        draft: Promise.resolve([el("a", { embedUrl: "https://example.com" })]),
        legacy: [el("old")],
      });

      const opened = await open();

      expect(drafts.load).not.toHaveBeenCalled();
      expect(drafts.record).not.toHaveBeenCalled();
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(opened.resave).toEqual([]);
    }
  });

  it("opens the online copy when this browser holds none of the drawing", async () => {
    // Someone opening a share link: this browser has never seen the drawing, and the
    // copy is what there is of it.
    const { open } = setup({
      browser: true,
      get: async () => board([]),
      stored: { read: async () => ({ rev: 3, elements: [el("a"), el("b")] }) },
    });

    const opened = await open();

    expect(ids(opened.elements)).toEqual(["a", "b"]);
    // This browser holds none of it yet: the saver writes the copy here, so the next
    // visit finds the whole drawing and not only what changed since.
    expect(opened.loaded).toEqual([]);
    expect(ids(opened.copied ?? [])).toEqual(["a", "b"]);
    expect(opened.failure).toBeNull();
  });

  it("keeps this browser's own copy, and does not read the online one", async () => {
    const read = vi.fn(async () => ({ rev: 3, elements: [el("elsewhere")] }));
    const { open } = setup({
      browser: true,
      get: async () => board([el("mine")]),
      stored: { read },
    });

    const opened = await open();

    expect(read).not.toHaveBeenCalled();
    expect(ids(opened.elements)).toEqual(["mine"]);
    expect(opened.copied).toBeNull();
  });

  it("reports an online copy it could not read, rather than opening the drawing empty", async () => {
    const refused = new ApiClientError(500, "storage_failed", "the copy could not be read");
    const { open } = setup({
      browser: true,
      get: async () => board([]),
      stored: { read: () => Promise.reject(refused) },
    });

    const opened = await open();

    expect(opened.failure).toBe(refused);
    expect(opened.elements).toEqual([]);
  });
});

describe("openBoard on either path", () => {
  const NOTE = "el-1744582970-916586019";
  const DROPPED = ["el-182453653-1037543462", "el-735064406-2073341333", "el-455390627-177421627"];
  const legacy = legacyBoard.elements as unknown as DrawElement[];

  it.each([
    ["server", false],
    ["browser", true],
  ])("on the %s path, migrates a legacy sticky note and resaves it", async (_, browser) => {
    const { open, drafts } = setup({ browser, get: async () => board(legacy) });

    const opened = await open();

    expect(opened.elements.find((element) => element.id === NOTE)?.type).toBe("stickynote");
    for (const id of DROPPED) expect(ids(opened.elements)).not.toContain(id);
    expect(opened.resave).toEqual([NOTE, ...DROPPED]);
    // Ride on the scene as deleted elements, so the engine and the live link refuse them.
    expect(ids(opened.tombstones)).toEqual(DROPPED);
    expect(opened.tombstones.every((element) => element.isDeleted)).toBe(true);
    // The tracker starts from what is stored, so the migration goes out as edits.
    expect(ids(opened.loaded)).toEqual(ids(legacy));

    if (browser) {
      // Resaved through the saver alone: there is no draft in the browser build.
      expect(drafts.record).not.toHaveBeenCalled();
    } else {
      // And in the draft, or the board opened offline shows the dropped pieces again.
      expect(drafts.record).toHaveBeenCalledWith(
        SLUG,
        [expect.objectContaining({ id: NOTE, type: "stickynote" })],
        DROPPED,
        { order: ids(opened.elements) },
      );
    }
  });
});
