import { describe, expect, it } from "vitest";
import { SceneDiffTracker, type StampedElement } from "./sceneDiff.ts";

const el = (id: string, version = 1, patch: Partial<StampedElement> = {}): StampedElement => ({
  id,
  version,
  versionNonce: version * 10,
  updated: version,
  isDeleted: false,
  ...patch,
});

/** Deterministic nonce so a synthesised stamp is assertable. */
const nonce = () => 777;

describe("SceneDiffTracker", () => {
  it("sends everything when the server knows nothing", () => {
    const tracker = new SceneDiffTracker();
    const patch = tracker.diff([el("a"), el("b")], 100, nonce);

    expect(patch?.elements.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("sends nothing when in sync", () => {
    const tracker = new SceneDiffTracker();
    const scene = [el("a"), el("b")];
    tracker.reset(scene);

    expect(tracker.diff(scene, 100, nonce)).toBeNull();
  });

  it("sends only the element whose stamp moved", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a"), el("b")]);

    const patch = tracker.diff([el("a"), el("b", 2)], 100, nonce);

    expect(patch?.elements.map((e) => e.id)).toEqual(["b"]);
    expect(patch?.order).toBeUndefined();
  });

  it("does not resend after the patch is acknowledged", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a")]);
    const scene = [el("a"), el("b")];

    const first = tracker.diff(scene, 100, nonce);
    expect(first).not.toBeNull();
    if (first !== null) tracker.acknowledge(first);

    expect(tracker.diff(scene, 200, nonce)).toBeNull();
  });

  it("synthesises a tombstone for an element the engine stopped exporting", () => {
    // The engine drops deleted elements from its JSON, so a vanished id IS a delete.
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a", 3), el("b")]);

    const patch = tracker.diff([el("b")], 500, nonce);
    const tombstone = patch?.elements.find((e) => e.id === "a");

    expect(tombstone).toMatchObject({
      isDeleted: true,
      version: 4,
      versionNonce: 777,
      updated: 500,
    });
  });

  it("does not keep re-sending a tombstone once acknowledged", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a"), el("b")]);

    const first = tracker.diff([el("b")], 500, nonce);
    if (first !== null) tracker.acknowledge(first);

    expect(tracker.diff([el("b")], 600, nonce)).toBeNull();
  });

  it("re-stamps a resurrected element so it outranks its own tombstone", () => {
    // Undo restores the element with its ORIGINAL version, which would lose the
    // merge against the tombstone we already sent and stay deleted server-side.
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a", 3)]);

    const deletion = tracker.diff([], 500, nonce);
    expect(deletion?.elements[0]).toMatchObject({ isDeleted: true, version: 4 });
    if (deletion !== null) tracker.acknowledge(deletion);

    const undo = tracker.diff([el("a", 3)], 600, nonce);

    expect(undo?.elements[0]).toMatchObject({ id: "a", isDeleted: false, version: 5 });
  });

  it("re-stamps a resurrection that only ties with its tombstone", () => {
    // A tie is decided by the nonce, and the element could stay deleted server-side.
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a", 3)]);
    const deletion = tracker.diff([], 500, nonce);
    if (deletion !== null) tracker.acknowledge(deletion);

    const undo = tracker.diff([el("a", 4)], 600, nonce);

    expect(undo?.elements[0]).toMatchObject({ id: "a", version: 5, versionNonce: 777 });
  });

  it("drops the picture from a tombstone", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("photo", 1, { dataUrl: "data:image/png;base64,AAAA" } as never)]);

    const deletion = tracker.diff([], 500, nonce);

    expect(deletion?.elements[0]).toMatchObject({ id: "photo", isDeleted: true });
    expect(deletion?.elements[0]).not.toHaveProperty("dataUrl");
  });

  it("sends a resurrection the engine already stamped above the tombstone as it is", () => {
    // The engine re-stamps an undo. Minting a second stamp on top would leave the host
    // and the engine disagreeing, and the engine's next edit would then be refused.
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a", 3)]);
    const deletion = tracker.diff([], 500, nonce);
    if (deletion !== null) tracker.acknowledge(deletion);

    const restored = { ...el("a", 5), versionNonce: 4242 };
    const undo = tracker.diff([restored], 600, nonce);

    expect(undo?.elements[0]).toEqual(restored);
  });

  it("sends an explicit order when the stack is rearranged", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a"), el("b"), el("c")]);

    // A reorder touches no stamp, so without this the server would never learn.
    const patch = tracker.diff([el("c"), el("a"), el("b")], 100, nonce);

    expect(patch?.elements).toEqual([]);
    expect(patch?.order).toEqual(["c", "a", "b"]);
  });

  it("stays quiet about order when a new element merely appends", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a"), el("b")]);

    const patch = tracker.diff([el("a"), el("b"), el("c")], 100, nonce);

    expect(patch?.elements.map((e) => e.id)).toEqual(["c"]);
    expect(patch?.order).toBeUndefined();
  });

  it("sends an order when a new element lands mid-stack", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a"), el("b")]);

    const patch = tracker.diff([el("a"), el("new"), el("b")], 100, nonce);

    expect(patch?.order).toEqual(["a", "new", "b"]);
  });

  it("keeps order consistent across a delete so the next diff is quiet", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a"), el("b"), el("c")]);

    const patch = tracker.diff([el("a"), el("c")], 100, nonce);
    expect(patch?.order).toBeUndefined();
    if (patch !== null) tracker.acknowledge(patch);

    expect(tracker.diff([el("a"), el("c")], 200, nonce)).toBeNull();
  });

  it("treats a locally tombstoned element as absent rather than sending it twice", () => {
    const tracker = new SceneDiffTracker();
    tracker.reset([el("a")]);

    const patch = tracker.diff([el("a", 2, { isDeleted: true })], 100, nonce);

    expect(patch?.elements.map((e) => e.id)).toEqual(["a"]);
    expect(patch?.elements[0]?.isDeleted).toBe(true);
  });
});

/** A board as the host mirrors it: in stacking order, with a lookup by id. */
function mirror(elements: StampedElement[]) {
  let live = [...elements];
  return {
    get live() {
      return live;
    },
    lookup: (id: string) => live.find((element) => element.id === id),
    /** In place, or on top when new: what a delta from the engine can do. */
    put(element: StampedElement) {
      const at = live.findIndex((e) => e.id === element.id);
      if (at >= 0) live[at] = element;
      else live.push(element);
    },
    drop(id: string) {
      live = live.filter((element) => element.id !== id);
    },
  };
}

describe("SceneDiffTracker told what changed", () => {
  it("looks at what it was told changed, and at nothing else", () => {
    // The point: on 9,000 shapes, comparing all of them was a millisecond and a half
    // per Ctrl+D. Told the ids, it reads those.
    const board = mirror([el("a"), el("b"), el("c")]);
    const tracker = new SceneDiffTracker();
    tracker.reset(board.live);
    const read: string[] = [];
    const lookup = (id: string) => (read.push(id), board.lookup(id));

    board.put(el("d"));
    tracker.noteChanged(["d"]);
    const patch = tracker.diff(board.live, 100, nonce, lookup);

    expect(patch?.elements.map((e) => e.id)).toEqual(["d"]);
    expect(read).toEqual(["d"]);
  });

  it("sends a deletion it was told of as a tombstone", () => {
    const board = mirror([el("a"), el("b")]);
    const tracker = new SceneDiffTracker();
    tracker.reset(board.live);

    board.drop("b");
    tracker.noteChanged(["b"]);
    const patch = tracker.diff(board.live, 100, nonce, board.lookup);

    expect(patch?.elements).toEqual([
      { ...el("b"), isDeleted: true, version: 2, versionNonce: 777, updated: 100 },
    ]);
  });

  it("keeps what it was told until the server has it", () => {
    const board = mirror([el("a")]);
    const tracker = new SceneDiffTracker();
    tracker.reset(board.live);
    board.put(el("a", 2));
    tracker.noteChanged(["a"]);

    // Built, but the send failed: not acknowledged, so it goes out again.
    expect(tracker.diff(board.live, 100, nonce, board.lookup)?.elements).toHaveLength(1);
    const again = tracker.diff(board.live, 100, nonce, board.lookup);
    expect(again?.elements).toHaveLength(1);

    tracker.acknowledge(again!);
    expect(tracker.diff(board.live, 100, nonce, board.lookup)).toBeNull();
  });

  it("keeps a change told while the last one was on its way", () => {
    const board = mirror([el("a"), el("b")]);
    const tracker = new SceneDiffTracker();
    tracker.reset(board.live);
    board.put(el("a", 2));
    tracker.noteChanged(["a"]);
    const sending = tracker.diff(board.live, 100, nonce, board.lookup)!;

    board.put(el("b", 2));
    tracker.noteChanged(["b"]);
    tracker.acknowledge(sending);

    expect(tracker.diff(board.live, 200, nonce, board.lookup)?.elements.map((e) => e.id)).toEqual([
      "b",
    ]);
  });

  it("goes back to comparing everything when a whole scene arrives", () => {
    // An undo or a reorder arrives as the whole scene, and can have changed anything.
    const board = mirror([el("a"), el("b"), el("c")]);
    const tracker = new SceneDiffTracker();
    tracker.reset(board.live);

    board.put(el("b", 2));
    tracker.noteEverything();
    const patch = tracker.diff(board.live, 100, nonce, board.lookup);
    expect(patch?.elements.map((e) => e.id)).toEqual(["b"]);
    tracker.acknowledge(patch!);

    // And back to reading only what it is told, once that is settled.
    const read: string[] = [];
    board.put(el("c", 2));
    tracker.noteChanged(["c"]);
    tracker.diff(board.live, 200, nonce, (id) => (read.push(id), board.lookup(id)));
    expect(read).toEqual(["c"]);
  });

  it("agrees with comparing everything, whatever the edits", () => {
    // The whole contract: told the ids, it must build the same patches the full
    // comparison builds. Random adds, edits, deletes and resurrections, diffed at random
    // points, on two trackers side by side.
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 30; run += 1) {
      const start = Array.from({ length: 12 }, (_, i) => el(`e${i}`));
      const board = mirror(start);
      const told = new SceneDiffTracker();
      const full = new SceneDiffTracker();
      told.reset(board.live);
      full.reset(board.live);
      const deleted = new Map<string, StampedElement>();
      let next = 12;

      for (let step = 0; step < 60; step += 1) {
        const roll = random();
        const live = board.live;
        if (roll < 0.25) {
          const element = el(`e${next++}`);
          board.put(element);
          told.noteChanged([element.id]);
        } else if (roll < 0.55 && live.length > 0) {
          const pick = live[Math.floor(random() * live.length)]!;
          board.put({ ...pick, version: pick.version + 1, versionNonce: pick.versionNonce + 1 });
          told.noteChanged([pick.id]);
        } else if (roll < 0.7 && live.length > 0) {
          const pick = live[Math.floor(random() * live.length)]!;
          board.drop(pick.id);
          deleted.set(pick.id, pick);
          told.noteChanged([pick.id]);
        } else if (roll < 0.8 && deleted.size > 0) {
          // An undo of a delete. It reaches the host as the whole scene, never as a delta,
          // and the engine stamps it above the tombstone it restores over. (A resurrection
          // that does not outrank it is re-stamped by the host; the tests above cover it.)
          const [id, element] = [...deleted][Math.floor(random() * deleted.size)]!;
          deleted.delete(id);
          board.put({
            ...element,
            version: element.version + 2,
            versionNonce: element.versionNonce + 2,
          });
          told.noteEverything();
        } else {
          const a = told.diff(board.live, step, nonce, board.lookup);
          const b = full.diff(board.live, step, nonce);
          // The same elements, stamped the same. Their order inside a patch means
          // nothing — where new ones land is checked below, through the server's order.
          const byId = (patch: typeof a) =>
            patch && {
              ...patch,
              elements: [...patch.elements].sort((x, y) => (x.id < y.id ? -1 : 1)),
            };
          expect(byId(a), `run ${run} step ${step}`).toEqual(byId(b));
          // Sometimes the send fails and nothing is acknowledged.
          if (a && b && random() < 0.8) {
            told.acknowledge(a);
            full.acknowledge(b);
            expect(told.serverOrder, `run ${run} step ${step}`).toEqual(full.serverOrder);
          }
        }
      }
    }
  });
});
