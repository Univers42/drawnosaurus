import { describe, expect, it } from "vitest";
import { DraftStore, type DraftBackend, type DraftElement } from "./draftStore.ts";

/** A backend in memory, recording each write it was given. */
function memory() {
  const boards = new Map<string, { elements: Map<string, DraftElement>; order: string[] }>();
  const writes: { puts: number; deletes: number; order: boolean }[] = [];
  const backend: DraftBackend = {
    async write(slug, puts, deletes, order) {
      writes.push({ puts: puts.length, deletes: deletes.length, order: order !== null });
      const board = boards.get(slug) ?? { elements: new Map(), order: [] };
      for (const element of puts) board.elements.set(element.id, element);
      for (const id of deletes) board.elements.delete(id);
      if (order) board.order = [...order];
      boards.set(slug, board);
    },
    async read(slug) {
      const board = boards.get(slug);
      if (!board || board.elements.size === 0) return null;
      return { elements: [...board.elements.values()], order: board.order };
    },
  };
  return { backend, writes };
}

/** Runs scheduled work only when told to. */
function manual() {
  const queue: (() => void)[] = [];
  return {
    schedule: (run: () => void) => void queue.push(run),
    run: () => queue.splice(0).forEach((job) => job()),
  };
}

const el = (id: string, v = 1) => ({ id, v }) as DraftElement;

describe("DraftStore", () => {
  it("writes only what changed, not the board", async () => {
    // The point of it: the whole-board string took 160ms per stroke on a big board.
    const { backend, writes } = memory();
    const store = new DraftStore(backend, (run) => run());
    const board = Array.from({ length: 500 }, (_, i) => el(`e${i}`));
    store.record("s", board, [], board);
    await store.flush();

    const next = [...board, el("new")];
    store.record("s", [el("new")], [], next);
    await store.flush();

    expect(writes.at(-1)).toEqual({ puts: 1, deletes: 0, order: true });
  });

  it("does not rewrite the order when an edit leaves it alone", async () => {
    const { backend, writes } = memory();
    const store = new DraftStore(backend, (run) => run());
    const board = [el("a"), el("b")];
    store.record("s", board, [], board);
    await store.flush();

    store.record("s", [el("a", 2)], [], [el("a", 2), el("b")]);
    await store.flush();

    expect(writes.at(-1)).toEqual({ puts: 1, deletes: 0, order: false });
  });

  it("batches a burst of changes into one write", async () => {
    const { backend, writes } = memory();
    const later = manual();
    const store = new DraftStore(backend, later.schedule);
    store.record("s", [el("a")], [], [el("a")]);
    store.record("s", [el("a", 2)], [], [el("a", 2)]);
    store.record("s", [el("b")], [], [el("a", 2), el("b")]);

    later.run();
    await store.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ puts: 2, deletes: 0, order: true });
  });

  it("loads the board back in z-order, deletions applied", async () => {
    const { backend } = memory();
    const store = new DraftStore(backend, (run) => run());
    store.record("s", [el("a"), el("b"), el("c")], [], [el("c"), el("a"), el("b")]);
    await store.flush();
    store.record("s", [], ["a"], [el("c"), el("b")]);
    await store.flush();

    const loaded = await store.load("s");

    expect(loaded?.map((e) => e.id)).toEqual(["c", "b"]);
  });

  it("keeps boards apart", async () => {
    const { backend } = memory();
    const store = new DraftStore(backend, (run) => run());
    store.record("one", [el("a")], [], [el("a")]);
    await store.flush();
    store.record("two", [el("b")], [], [el("b")]);
    await store.flush();

    expect((await store.load("one"))?.map((e) => e.id)).toEqual(["a"]);
    expect((await store.load("two"))?.map((e) => e.id)).toEqual(["b"]);
    expect(await store.load("three")).toBeNull();
  });

  it("never throws, whatever the backend does", async () => {
    const broken: DraftBackend = {
      write: () => Promise.reject(new Error("quota")),
      read: () => Promise.reject(new Error("blocked")),
    };
    const store = new DraftStore(broken, (run) => run());
    store.record("s", [el("a")], [], [el("a")]);
    await expect(store.flush()).resolves.toBeUndefined();
    await expect(store.load("s")).resolves.toBeNull();
  });
});
