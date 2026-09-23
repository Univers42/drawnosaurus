/**
 * The local copy of a board, kept in case the server cannot be reached — written a
 * change at a time.
 *
 * It used to be one `localStorage` string: the whole board, serialised on every change.
 * On a board of 2,000 freehand strokes that was 160ms of `JSON.stringify` after every
 * stroke, plus the collector cleaning up after it — the hitch at the end of every
 * gesture — and a board of a few photos did not fit in the quota at all. Here each
 * change writes only the elements it touched, to IndexedDB, batched and off the frame
 * that made it.
 */

/** Anything with an id: the store does not look inside elements. */
export interface DraftElement {
  id: string;
}

/** How a change moved the stack: a whole new order, or ids put on top of it. */
export type StackChange = { order: readonly string[] } | { appended: readonly string[] };

/** Where drafts live. IndexedDB in the browser; a map in tests. */
export interface DraftBackend {
  /**
   * Applies one batch: elements to put, ids to delete, and how the stack moved — a new
   * order, ids to add on top of the stored one, or nothing.
   */
  write(
    slug: string,
    puts: readonly DraftElement[],
    deletes: readonly string[],
    stack: StackChange | null,
  ): Promise<void>;
  /** Everything stored for a board, or null when there is nothing. */
  read(slug: string): Promise<{ elements: DraftElement[]; order: string[] } | null>;
}

type Schedule = (run: () => void) => void;

const defaultSchedule: Schedule = (run) => {
  const idle = (globalThis as { requestIdleCallback?: (fn: () => void, o: object) => number })
    .requestIdleCallback;
  if (idle) idle(run, { timeout: 1000 });
  else setTimeout(run, 200);
};

/** Batches changes and writes them to a backend, per board. */
export class DraftStore {
  private readonly puts = new Map<string, DraftElement>();
  private readonly deletes = new Set<string>();
  /** A new order for the whole stack, pending. */
  private order: readonly string[] | null = null;
  /** Ids put on top since the order last written, pending, in the order they went. */
  private appended: string[] = [];
  private slug = "";
  private scheduled = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: DraftBackend,
    private readonly schedule: Schedule = defaultSchedule,
  ) {}

  /**
   * Notes what one scene change did, and how it moved the stack: `{ order }` for a
   * change that rearranged it — an undo, a reorder — and `{ appended }` for everything
   * else, where the only movement is new elements going on top.
   *
   * The whole order used to come with every change, and comparing it with the last one
   * stored was a pass over the board per keystroke.
   */
  record(
    slug: string,
    updated: readonly DraftElement[],
    removed: readonly string[],
    stack: StackChange,
  ): void {
    if (!slug) return;
    if (slug !== this.slug) {
      this.puts.clear();
      this.deletes.clear();
      this.order = null;
      this.appended = [];
      this.slug = slug;
    }
    for (const element of updated) {
      this.puts.set(element.id, element);
      this.deletes.delete(element.id);
    }
    for (const id of removed) {
      this.puts.delete(id);
      this.deletes.add(id);
    }
    if ("order" in stack) {
      // A whole order includes whatever was appended before it.
      this.order = stack.order;
      this.appended = [];
    } else if (stack.appended.length > 0) {
      if (this.order) this.order = [...this.order, ...stack.appended];
      else this.appended.push(...stack.appended);
    }
    this.arm();
  }

  /** Writes whatever is pending now — for page hide. */
  async flush(): Promise<void> {
    const nothing =
      this.puts.size === 0 && this.deletes.size === 0 && !this.order && this.appended.length === 0;
    if (!this.slug || nothing) {
      await this.writing;
      return;
    }
    const slug = this.slug;
    const puts = [...this.puts.values()];
    const deletes = [...this.deletes];
    const stack: StackChange | null = this.order
      ? { order: this.order }
      : this.appended.length > 0
        ? { appended: this.appended }
        : null;
    this.puts.clear();
    this.deletes.clear();
    this.order = null;
    this.appended = [];
    // One write at a time, in order: a later batch must not land before an earlier one.
    this.writing = this.writing
      .then(() => this.backend.write(slug, puts, deletes, stack))
      .catch(() => {
        // Best effort. The server is the record; a draft that failed to write is a
        // fallback lost, not work lost.
      });
    await this.writing;
  }

  /** The stored board in z-order, or null when there is none. */
  async load(slug: string): Promise<DraftElement[] | null> {
    try {
      const stored = await this.backend.read(slug);
      if (!stored) return null;
      const byId = new Map(stored.elements.map((element) => [element.id, element]));
      const ordered: DraftElement[] = [];
      for (const id of stored.order) {
        const element = byId.get(id);
        if (element) {
          ordered.push(element);
          byId.delete(id);
        }
      }
      // Anything the order does not name — a write that failed half way. Kept, on top.
      ordered.push(...byId.values());
      return ordered.length > 0 ? ordered : null;
    } catch {
      return null;
    }
  }

  private arm(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      void this.flush();
    });
  }
}

/** The stored order with `stack` applied. */
export function applyStack(stored: readonly string[], stack: StackChange): string[] {
  if ("order" in stack) return [...stack.order];
  const present = new Set(stored);
  return [...stored, ...stack.appended.filter((id) => !present.has(id))];
}

const DB_NAME = "drawnosaurus-drafts";
const ELEMENTS = "elements";
const BOARDS = "boards";

/** The browser's backend: two IndexedDB stores, elements by `[slug, id]` and orders by slug. */
export function indexedDbBackend(): DraftBackend {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) {
    return { write: async () => undefined, read: async () => null };
  }
  let opened: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        const elements = database.createObjectStore(ELEMENTS, { keyPath: ["slug", "id"] });
        elements.createIndex("slug", "slug");
        database.createObjectStore(BOARDS, { keyPath: "slug" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return opened;
  };
  const done = (tx: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

  return {
    async write(slug, puts, deletes, stack) {
      const database = await db();
      const tx = database.transaction([ELEMENTS, BOARDS], "readwrite");
      const elements = tx.objectStore(ELEMENTS);
      for (const element of puts) elements.put({ slug, id: element.id, element });
      for (const id of deletes) elements.delete([slug, id]);
      if (stack) {
        // Read and written in the same transaction, so two batches cannot interleave.
        const boards = tx.objectStore(BOARDS);
        const current = boards.get(slug);
        current.onsuccess = () => {
          const stored = (current.result as { order?: string[] } | undefined)?.order ?? [];
          boards.put({ slug, order: applyStack(stored, stack) });
        };
      }
      await done(tx);
    },
    async read(slug) {
      const database = await db();
      const tx = database.transaction([ELEMENTS, BOARDS], "readonly");
      const orderRequest = tx.objectStore(BOARDS).get(slug);
      const elementsRequest = tx.objectStore(ELEMENTS).index("slug").getAll(slug);
      await done(tx);
      const rows = (elementsRequest.result ?? []) as { element: DraftElement }[];
      if (rows.length === 0) return null;
      const board = orderRequest.result as { order?: string[] } | undefined;
      return { elements: rows.map((row) => row.element), order: board?.order ?? [] };
    },
  };
}
