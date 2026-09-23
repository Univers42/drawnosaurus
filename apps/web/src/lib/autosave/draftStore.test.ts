import { describe, expect, it } from "vitest";
import {
  DraftStore,
  applyStack,
  type DraftBackend,
  type DraftElement,
  type StackChange,
} from "./draftStore.ts";

/** A backend in memory, recording each write it was given. */
function memory() {
  const boards = new Map<string, { elements: Map<string, DraftElement>; order: string[] }>();
  const writes: { puts: number; deletes: number; stack: "order" | "appended" | null }[] = [];
  const backend: DraftBackend = {
    async write(slug, puts, deletes, stack: StackChange | null) {
      writes.push({
        puts: puts.length,
        deletes: deletes.length,
        stack: stack === null ? null : "order" in stack ? "order" : "appended",
      });
      const board = boards.get(slug) ?? { elements: new Map(), order: [] };
      for (const element of puts) board.elements.set(element.id, element);
      for (const id of deletes) board.elements.delete(id);
      if (stack) board.order = applyStack(board.order, stack);
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
const ids = (elements: DraftElement[]) => elements.map((element) => element.id);

describe("DraftStore", () => {
  it("writes only what changed, not the board", async () => {
    // The point of it: the whole-board string took 160ms per stroke on a big board.
    const { backend, writes } = memory();
    const store = new DraftStore(backend, (run) => run());
    const board = Array.from({ length: 500 }, (_, i) => el(`e${i}`));
    store.record("s", board, [], { order: ids(board) });
    await store.flush();

    store.record("s", [el("new")], [], { appended: ["new"] });
    await store.flush();

    // The element, and the id added on top — not the board's order again.
    expect(writes.at(-1)).toEqual({ puts: 1, deletes: 0, stack: "appended" });
  });

  it("does not touch the order when an edit leaves the stack alone", async () => {
    const { backend, writes } = memory();
    const store = new DraftStore(backend, (run) => run());
    store.record("s", [el("a"), el("b")], [], { order: ["a", "b"] });
    await store.flush();

    store.record("s", [el("a", 2)], [], { appended: [] });
    await store.flush();

    expect(writes.at(-1)).toEqual({ puts: 1, deletes: 0, stack: null });
  });

  it("batches a burst of changes into one write", async () => {
    const { backend, writes } = memory();
    const later = manual();
    const store = new DraftStore(backend, later.schedule);
    store.record("s", [el("a")], [], { order: ["a"] });
    store.record("s", [el("a", 2)], [], { appended: [] });
    store.record("s", [el("b")], [], { appended: ["b"] });

    later.run();
    await store.flush();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ puts: 2, deletes: 0, stack: "order" });
    expect((await store.load("s"))?.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("loads the board back in z-order, deletions applied", async () => {
    const { backend } = memory();
    const store = new DraftStore(backend, (run) => run());
    store.record("s", [el("a"), el("b"), el("c")], [], { order: ["c", "a", "b"] });
    await store.flush();
    store.record("s", [], ["a"], { order: ["c", "b"] });
    await store.flush();

    const loaded = await store.load("s");

    expect(loaded?.map((e) => e.id)).toEqual(["c", "b"]);
  });

  it("keeps what went on top in the order it went, whatever is edited after", async () => {
    // An element added on top and edited later must stay where it went, under anything
    // added after it — a re-stamp is not a move.
    const { backend } = memory();
    const store = new DraftStore(backend, (run) => run());
    store.record("s", [el("a"), el("b")], [], { order: ["a", "b"] });
    await store.flush();
    store.record("s", [el("c")], [], { appended: ["c"] });
    store.record("s", [el("d")], [], { appended: ["d"] });
    await store.flush();
    store.record("s", [el("c", 2)], [], { appended: [] });
    await store.flush();

    expect((await store.load("s"))?.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);

    // And in the next session, above everything from this one.
    const next = new DraftStore(backend, (run) => run());
    next.record("s", [el("e")], [], { appended: ["e"] });
    await next.flush();
    expect((await next.load("s"))?.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps boards apart", async () => {
    const { backend } = memory();
    const store = new DraftStore(backend, (run) => run());
    store.record("one", [el("a")], [], { order: ["a"] });
    await store.flush();
    store.record("two", [el("b")], [], { order: ["b"] });
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
    store.record("s", [el("a")], [], { order: ["a"] });
    await expect(store.flush()).resolves.toBeUndefined();
    await expect(store.load("s")).resolves.toBeNull();
  });
});
