import type { Board } from "@drawnosaurus/contract";
import { elementsFromJson } from "@osionos/draw-engine/json";
import type { DrawElement } from "@osionos/draw-engine/types";
import { ApiClientError } from "../api/client.ts";
import type { DraftStore } from "../autosave/draftStore.ts";
import { recoverStripped } from "../autosave/recover.ts";
import { migrateLegacyStickyGroups } from "../notes/stickyNotes.ts";
import { untitled } from "../store/browser.ts";
import type { BoardStore } from "../store/types.ts";

/**
 * Opening a board: what the page seeds its scene, its saver and its title from.
 *
 * Two paths, by build. The Docker build's board is the server's, repaired from this
 * browser's draft and, when the server cannot be reached, replaced by it. The public
 * build's board is this browser's own store, which is the local copy: there is no draft
 * beside it (`DraftStore` swallows its errors and can drop a tombstone).
 */

export interface OpenBoardOptions {
  slug: string;
  /** The public build. Passed in: only the routes read `BROWSER_MODE`. */
  browser: boolean;
  store: Pick<BoardStore, "get">;
  /** The local draft. The server path's only: the browser path never touches it. */
  drafts: Pick<DraftStore, "load" | "record"> | null;
  /** Where an older version of the page kept its draft. The server path's only. */
  storage: Storage | undefined;
  /**
   * The public build's: the online copy, read when this browser has no copy of its own —
   * what someone opening a share link finds. Null when the drawing was never shared.
   */
  stored?: StoredCopyReader | null;
  now: () => number;
  nonce: () => number;
}

/** What the online copy holds, read back: the drawing, as it was stored. */
export interface StoredCopyReader {
  read(): Promise<{ rev: number; elements: DrawElement[] } | null>;
}

export interface OpenedBoard {
  title: string;
  /** The board as the store has it — or, offline, as the draft does. */
  loaded: DrawElement[];
  /** `loaded`, with what was repaired or migrated on the way in. */
  elements: DrawElement[];
  /** The ids of what was repaired or migrated, each re-stamped or deleted, to save again. */
  resave: string[];
  /** What the migration dropped, as tombstones, to ride on the page's `scene`. */
  tombstones: DrawElement[];
  /** Opened with something on it and no stored picture. */
  needsThumbnailBackfill: boolean;
  /**
   * The browser path's: why the stored drawing could not be read. Null when it was read,
   * or when there was none to read.
   */
  failure: Error | null;
  /**
   * The browser path's: what the online copy held, when it was read — this browser had no
   * copy of its own. The drawing is shown from it, and the saver writes it here, so the
   * next visit finds the whole drawing and not only what this browser changed since.
   */
  copied: DrawElement[] | null;
}

/**
 * How long the server path waits for the draft once the server has answered.
 *
 * There the draft is only a repair source, and its read can wait indefinitely: a tab
 * still running the code from before the database's version 2 holds version 1 open, and
 * the upgrade waits for it to close (`draftDb.ts`). Without a bound, a board the server had
 * answered for never opened. A second is far longer than a read takes when nothing holds
 * the database; past it the board opens as the server sent it, unrepaired this time.
 */
export const DRAFT_REPAIR_WAIT_MS = 1000;

const LEGACY_DRAFT_PREFIX = "drawnosaurus:draft:";

/** `promise`, or `fallback` once `ms` have passed without it. */
function within<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** What a board the store answered with opens from, either path. */
function answered(board: Board) {
  const loaded = elementsFromJson(JSON.stringify(board.scene)) ?? [];
  return {
    title: board.title,
    loaded,
    // Something on it and no picture stored: the gallery's card would stay blank.
    needsThumbnailBackfill: loaded.some((element) => !element.isDeleted) && !board.thumbnailAt,
  };
}

export async function openBoard(options: OpenBoardOptions): Promise<OpenedBoard> {
  const { slug, now, nonce } = options;
  const read = options.browser ? await fromBrowser(options) : await fromServer(options);
  let { elements } = read;
  const resave = [...read.resave];

  // A sticky note saved while it was four shapes in a group — shadow, pad, date and
  // label — made the one element the engine draws. See `stickyNotes.ts`.
  const migrated = migrateLegacyStickyGroups(elements, now(), nonce);
  if (migrated.changed.length > 0) {
    elements = migrated.elements;
    const removed = migrated.removed.map((element) => element.id);
    resave.push(...migrated.changed.map((element) => element.id), ...removed);
    // And in the draft, or a board opened offline shows the dropped pieces again, beside
    // a note that is no longer in their group to take them back. The browser build has
    // no draft: the saver's resave writes the store, which is the local copy.
    if (!options.browser) {
      options.drafts?.record(slug, migrated.changed, removed, {
        order: elements.map((element) => element.id),
      });
    }
  }

  return { ...read, elements, resave, tombstones: migrated.removed };
}

type Read = Omit<OpenedBoard, "tombstones">;

async function fromServer({
  slug,
  store,
  drafts,
  storage,
  now,
  nonce,
}: OpenBoardOptions): Promise<Read> {
  // Read beside the board rather than after it, so it costs the page no time.
  const draft = (drafts?.load(slug) ?? Promise.resolve(null)) as Promise<DrawElement[] | null>;
  try {
    const { title, loaded, needsThumbnailBackfill } = answered(await store.get(slug));
    // The draft this page used to keep in localStorage: the server has the board, and the
    // string only took up the quota.
    storage?.removeItem(`${LEGACY_DRAFT_PREFIX}${slug}`);
    // What the server stripped from boards saved before its schema had the fields —
    // every video an empty box — this browser may still have in its draft.
    const repairFrom = await within(draft, DRAFT_REPAIR_WAIT_MS, null);
    const recovered = recoverStripped(loaded, repairFrom, now(), nonce);
    return {
      title,
      loaded,
      elements: recovered.elements,
      resave: recovered.repaired.map((element) => element.id),
      needsThumbnailBackfill,
      failure: null,
      copied: null,
    };
  } catch {
    // The server is unreachable: the local draft, or the one an older version of this
    // page kept in localStorage. The only copy there is, so it is waited for, however long.
    const drafted = await draft;
    const legacy = storage?.getItem(`${LEGACY_DRAFT_PREFIX}${slug}`);
    const loaded = drafted ?? (legacy ? (elementsFromJson(legacy) ?? []) : []);
    return {
      title: slug ? `Board ${slug}` : "Untitled",
      loaded,
      elements: loaded,
      resave: [],
      needsThumbnailBackfill: false,
      failure: null,
      copied: null,
    };
  }
}

/** Nothing of the drawing: a new one, or one this browser could not read. */
const empty = { loaded: [], elements: [], resave: [], needsThumbnailBackfill: false, copied: null };

async function fromBrowser({ slug, store, now, stored }: OpenBoardOptions): Promise<Read> {
  // A link to a shared drawing is opened here, ahead of this browser's own copy: its
  // secret, and the online copy when this browser has none (the spec's _The secret_ and
  // _The stored copy_).
  let opened: ReturnType<typeof answered> | null = null;
  try {
    opened = answered(await store.get(slug));
  } catch (error) {
    // Not held here: a new drawing, whose row its first save creates (`browser.ts`).
    if (error instanceof ApiClientError && error.status === 404) {
      opened = null;
    } else {
      // Held, and unreadable. Opened empty, and reported, rather than passed off as a new
      // drawing. Saving still cannot destroy what is stored: a save is a merge, the newer
      // stamp per element winning (`reconcileElements`), so this page can only add to the
      // drawing; it cannot delete what it never read.
      return {
        ...empty,
        title: "Untitled",
        failure: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  // This browser's own copy wins: it is the one it edits, and the one the gallery lists.
  if (opened && opened.loaded.length > 0) {
    return { ...opened, elements: opened.loaded, resave: [], failure: null, copied: null };
  }

  // Nothing of it here: the online copy, if the drawing was shared. It is shown at once,
  // without waiting for the relay to wake.
  if (stored) {
    try {
      const copy = await stored.read();
      if (copy) {
        return {
          title: opened?.title ?? untitled(new Date(now())),
          // This browser holds nothing of it yet: the saver writes the copy here, so the
          // next visit finds the whole drawing and not only what changed since.
          loaded: [],
          elements: copy.elements,
          resave: [],
          needsThumbnailBackfill: copy.elements.some((element) => !element.isDeleted),
          failure: null,
          copied: copy.elements,
        };
      }
    } catch (error) {
      // The copy could not be read: opened empty, and reported, as a drawing this browser
      // holds and cannot read is.
      return {
        ...empty,
        title: opened?.title ?? "Untitled",
        failure: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  return {
    ...empty,
    title: opened?.title ?? untitled(new Date(now())),
    needsThumbnailBackfill: false,
    failure: null,
  };
}
