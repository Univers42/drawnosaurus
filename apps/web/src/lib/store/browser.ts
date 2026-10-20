import {
  DEFAULT_PAGE_SIZE,
  SUPPORTED_OSIDRAW_VERSION,
  applyOrder,
  liveElements,
  reconcileElements,
  sceneBounds,
  type Board,
  type BoardSummary,
  type DrawElementDto,
  type WorldBounds,
} from "@drawnosaurus/contract";
import { ApiClientError, type PatchAck } from "../api/client.ts";
import { BOARDS, DRAWINGS, ELEMENTS, openDraftDb } from "../autosave/draftDb.ts";
import { fillPictures } from "../autosave/pictures.ts";
import type { BoardStore } from "./types.ts";

/**
 * The public build's store: drawings kept in this browser's IndexedDB, with no server.
 *
 * Every operation means what the API's does (`apps/api/src/boards`), down to the status it
 * fails with, so the pages that call it cannot tell which store they were built with. The
 * scene is the drafts' own — the `elements` and `boards` stores `draftStore.ts` writes — and
 * the gallery's row for it is in `drawings`, beside them (`draftDb.ts`).
 */

/** A drawing's gallery row. */
interface DrawingRow {
  slug: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  rev: number;
  /** Live elements. Zero keeps a drawing out of the gallery: opened, never drawn on. */
  elementCount: number;
  bounds: WorldBounds | null;
  thumbnail?: Blob;
  thumbnailAt?: string;
}

/** The drafts' rows, as `indexedDbBackend` writes them. */
interface ElementRow {
  slug: string;
  id: string;
  element: DrawElementDto;
}
interface OrderRow {
  slug: string;
  order: string[];
}

export interface BrowserStoreOptions {
  idb: IDBFactory;
  /** When a save, a creation or a picture happens. */
  now?: () => Date;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * 26 base32 characters, 130 random bits. A drawing's slug is also its relay topic and its
 * key in the online store once it is shared, so it must not be guessable. Thirty-two
 * letters divide 256, so a byte's low five bits pick one without bias.
 */
function mintSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  return Array.from(bytes, (byte) => BASE32.charAt(byte & 31)).join("");
}

// Spelled out: `toLocaleDateString`'s short months differ between browsers ("Sep", "Sept").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * There is no rename, so a drawing saved before anyone named it is titled by its day. Also
 * the title a board page shows for a drawing not saved yet (`boards/openBoard.ts`).
 */
export const untitled = (at: Date): string => `Drawing — ${at.getDate()} ${MONTHS[at.getMonth()]}`;

const newRow = (slug: string, title: string, at: Date): DrawingRow => ({
  slug,
  title,
  createdAt: at.toISOString(),
  updatedAt: at.toISOString(),
  rev: 1,
  elementCount: 0,
  bounds: null,
});

/** The row once `elements` are saved: counted and framed from what is live, as the API's. */
function savedRow(row: DrawingRow, elements: readonly DrawElementDto[], at: Date): DrawingRow {
  const live = liveElements(elements);
  return {
    ...row,
    updatedAt: at.toISOString(),
    rev: row.rev + 1,
    elementCount: live.length,
    bounds: sceneBounds(live),
  };
}

const summary = (row: DrawingRow): BoardSummary => ({
  slug: row.slug,
  title: row.title,
  elementCount: row.elementCount,
  bounds: row.bounds,
  rev: row.rev,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  thumbnailAt: row.thumbnailAt ?? null,
});

const board = (row: DrawingRow, elements: readonly DrawElementDto[]): Board => ({
  ...summary(row),
  scene: { type: "osidraw", version: SUPPORTED_OSIDRAW_VERSION, elements: [...elements] },
});

/**
 * Where a row stands in the gallery, as one string that sorts like the API's
 * `(updatedAt, _id)`: an ISO time is always 24 characters, so the slug breaks a tie. It is
 * also the cursor, read as "the rows after this one".
 */
const position = (row: DrawingRow): string => `${row.updatedAt}|${row.slug}`;

const notFound = (): ApiClientError => new ApiClientError(404, "not_found", "board not found");

/**
 * What a failure is reported as. The page's `classify` goes by the status: a full quota is
 * the API's 413, a board too large, which the same patch would only meet again. Anything
 * else is a 5xx, retried and shown. Nothing is swallowed: a drawing lost without the person
 * being told is the one thing this store must never do.
 */
function reported(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  if ((error as { name?: unknown } | null)?.name === "QuotaExceededError") {
    return new ApiClientError(413, "board_too_large", "this browser has no room left for it");
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new ApiClientError(500, "storage_failed", `the browser could not store it: ${reason}`);
}

/** Runs code inside a transaction; see `transact`. */
type Step = (run: () => void) => () => void;

/**
 * Runs `body` in one transaction over the three stores, and settles when it does: with
 * what `body`'s reader returns once it has committed, or with why it did not.
 *
 * A failed request and a commit the quota refuses abort the transaction on their own. A
 * throw does not say why: from `body` it would leave the requests made before it to
 * commit, and from a request's callback it aborts with a bare `AbortError`. So code that
 * runs inside goes through `step`, which aborts on a throw and keeps what was thrown.
 * Either way nothing is half written, and the caller is told the reason.
 */
function transact<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction, step: Step) => () => T,
): Promise<T> {
  const tx = database.transaction([ELEMENTS, BOARDS, DRAWINGS], mode);
  let thrown: { error: unknown } | null = null;
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(thrown ? thrown.error : tx.error);
  });
  const step: Step = (run) => () => {
    try {
      run();
    } catch (error) {
      thrown = { error };
      tx.abort();
    }
  };
  // Set unless `body` threw — and then the transaction aborted, and nothing reads it.
  let reader!: () => T;
  step(() => {
    reader = body(tx, step);
  })();
  return committed.then(() => reader());
}

/**
 * Asks for everything stored for `slug`: its row, its elements, their order. `result` reads
 * the answer once `last` has succeeded — the requests of one transaction land in the order
 * they were made — so a read calls it after the commit and a write in `last.onsuccess`.
 */
function readDrawing(tx: IDBTransaction, slug: string) {
  const row = tx.objectStore(DRAWINGS).get(slug) as IDBRequest<DrawingRow | undefined>;
  const rows = tx.objectStore(ELEMENTS).index("slug").getAll(slug) as IDBRequest<ElementRow[]>;
  const order = tx.objectStore(BOARDS).get(slug) as IDBRequest<OrderRow | undefined>;
  return {
    last: order,
    result: () => ({
      row: row.result,
      // An element the order does not name — the drafts write elements and order apart —
      // goes on top, as the drafts load it.
      elements: applyOrder(
        rows.result.map((stored) => stored.element),
        order.result?.order ?? [],
      ),
    }),
  };
}

export function browserStore({ idb, now = () => new Date() }: BrowserStoreOptions): BoardStore {
  let opened: Promise<IDBDatabase> | null = null;

  async function run<T>(
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction, step: Step) => () => T,
  ): Promise<T> {
    try {
      return await transact(await (opened ??= openDraftDb(idb)), mode, body);
    } catch (error) {
      throw reported(error);
    }
  }

  return {
    // ponytail: reads every row for each page; a browser holds tens of drawings, not
    // thousands. Upgrade path: an `updatedAt` index cursor opened at the position.
    list: (limit = DEFAULT_PAGE_SIZE, cursor) =>
      run("readonly", (tx) => {
        const rows = tx.objectStore(DRAWINGS).index("updatedAt").getAll() as IDBRequest<
          DrawingRow[]
        >;
        return () => {
          // The index holds them oldest first, a tie by slug: newest first is the reverse.
          const listed = rows.result
            .reverse()
            .filter(
              (row) => row.elementCount > 0 && (cursor === undefined || position(row) < cursor),
            );
          const page = listed.slice(0, limit);
          const last = page.at(-1);
          return {
            boards: page.map(summary),
            nextCursor: listed.length > limit && last ? position(last) : null,
          };
        };
      }),

    create: (title) =>
      run("readwrite", (tx) => {
        const row = newRow(mintSlug(), title, now());
        // `add`, not `put`: a slug already taken is refused rather than written over.
        tx.objectStore(DRAWINGS).add(row);
        return () => summary(row);
      }),

    get: (slug, { tombstones = false } = {}) =>
      run("readonly", (tx) => {
        const stored = readDrawing(tx, slug);
        return () => {
          const { row, elements } = stored.result();
          if (!row) throw notFound();
          // Tombstones exist so a delete wins a merge; a load leaves them out, as the API's.
          return board(row, tombstones ? elements : liveElements(elements));
        };
      }),

    patchElements: (slug, patch) =>
      run("readwrite", (tx, step) => {
        // Typed as the contract's: the API validates them on the way in, and here they
        // come from this page's own engine.
        const incoming = patch.elements as unknown as DrawElementDto[];
        const stored = readDrawing(tx, slug);
        let ack: PatchAck;
        stored.last.onsuccess = step(() => {
          const { row, elements } = stored.result();
          const before = new Map(elements.map((element) => [element.id, element]));
          // The newer stamp wins per element; a tombstone is an edit like any other, kept
          // so the delete goes on winning.
          const merged = reconcileElements(elements, incoming);
          // An image edited after its picture was saved arrives without it
          // (`PictureLedger.strip`), and keeps the one stored.
          const kept = fillPictures(merged.elements, (id) => before.get(id));
          const next = patch.order === undefined ? kept : applyOrder(kept, patch.order);
          for (const element of next) {
            if (before.get(element.id) === element) continue;
            tx.objectStore(ELEMENTS).put({ slug, id: element.id, element } satisfies ElementRow);
          }
          tx.objectStore(BOARDS).put({ slug, order: next.map(({ id }) => id) } satisfies OrderRow);
          // A slug never passed to `create` — a drawing opened at its address — gets its
          // row with its first save.
          const at = now();
          const saved = savedRow(row ?? newRow(slug, untitled(at), at), next, at);
          tx.objectStore(DRAWINGS).put(saved);
          ack = { ...summary(saved), applied: merged.applied, rejected: merged.rejected };
        });
        return () => ack;
      }),

    replace: (slug, scene, rev) =>
      run("readwrite", (tx, step) => {
        const stored = readDrawing(tx, slug);
        let replaced: Board;
        stored.last.onsuccess = step(() => {
          const { row, elements } = stored.result();
          if (!row) throw notFound();
          if (row.rev !== rev) {
            throw new ApiClientError(
              409,
              "conflict",
              `board has moved on (rev ${row.rev}, you sent ${rev})`,
            );
          }
          for (const { id } of elements) tx.objectStore(ELEMENTS).delete([slug, id]);
          for (const element of scene.elements) {
            tx.objectStore(ELEMENTS).put({ slug, id: element.id, element } satisfies ElementRow);
          }
          const order = scene.elements.map(({ id }) => id);
          tx.objectStore(BOARDS).put({ slug, order } satisfies OrderRow);
          const saved = savedRow(row, scene.elements, now());
          tx.objectStore(DRAWINGS).put(saved);
          replaced = board(saved, liveElements(scene.elements));
        });
        return () => replaced;
      }),

    remove: (slug) =>
      run("readwrite", (tx, step) => {
        const stored = readDrawing(tx, slug);
        stored.last.onsuccess = step(() => {
          const { row, elements } = stored.result();
          if (!row) throw notFound();
          for (const { id } of elements) tx.objectStore(ELEMENTS).delete([slug, id]);
          tx.objectStore(BOARDS).delete(slug);
          // The picture is on the row, and goes with it.
          tx.objectStore(DRAWINGS).delete(slug);
        });
        return () => undefined;
      }),

    putThumbnail: (slug, blob) =>
      run("readwrite", (tx, step) => {
        const stored = tx.objectStore(DRAWINGS).get(slug) as IDBRequest<DrawingRow | undefined>;
        stored.onsuccess = step(() => {
          if (!stored.result) throw notFound();
          // Neither `rev` nor `updatedAt`, as on the API: a picture of the drawing is not an
          // edit, nor a reason to reorder the gallery.
          const row: DrawingRow = {
            ...stored.result,
            thumbnail: blob,
            thumbnailAt: now().toISOString(),
          };
          tx.objectStore(DRAWINGS).put(row);
        });
        return () => undefined;
      }),

    thumbnail: (slug) =>
      run("readonly", (tx) => {
        const stored = tx.objectStore(DRAWINGS).get(slug) as IDBRequest<DrawingRow | undefined>;
        return () => {
          const picture = stored.result?.thumbnail;
          // Kept alive until revoked: the gallery releases it (`gallery/cardPicture.ts`).
          return picture ? URL.createObjectURL(picture) : null;
        };
      }),
  };
}
