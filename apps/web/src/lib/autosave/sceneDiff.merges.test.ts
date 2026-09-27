/**
 * What the SERVER does with a patch, against what the client believes it did.
 *
 * `sceneDiff.test.ts` cannot see this class of bug and never could: `diff` and
 * `acknowledge` both go through the same `predictOrder` over the same `this.order`, so
 * a wrong prediction is wrong *identically* on both sides and every assertion there
 * passes anyway. What that file pins is `diffTouched ≡ diffAll` — a real property, and
 * not "what the server ended up with".
 *
 * So the reference here is external to the thing under test: `reconcileElements`, the
 * merge the API runs on the array it already holds (`apps/api/src/boards/repository.ts`),
 * in a different package, which the client never calls. A wrong prediction now has to
 * disagree with a module it never invoked.
 *
 * The reference is the CONTRACT's merge and not the oracle's, deliberately. Excalidraw
 * predicts nothing: every element carries a fractional index and a newcomer is minted
 * one *between* its neighbours (`packages/excalidraw/data/reconcile.ts@1118751f:110`,
 * `packages/element/src/fractionalIndex.ts@1118751f:430-459`), so the array is only a
 * cache. Our wire format carries an array position (BUNNY.md, `CLAUDE.md`), which is
 * why a client here has to predict at all. That difference is forced by the format, not
 * a defect to be ported away — see docs/reference/zorder.md.
 */
import { describe, expect, it } from "vitest";
import { liveElements, reconcileElements } from "@drawnosaurus/contract";
import { SceneDiffTracker, type StampedElement } from "./sceneDiff.ts";

const el = (id: string, version = 1, patch: Partial<StampedElement> = {}): StampedElement => ({
  id,
  version,
  versionNonce: version * 10,
  updated: version,
  isDeleted: false,
  ...patch,
});

/**
 * The live id order the API ends up holding. The truth the client is guessing at.
 *
 * `reconcileElements` is reached through the package root because the contract's
 * `exports` map admits nothing else — a deep `@drawnosaurus/contract/src/reconcile.ts`
 * does not resolve. No barrel shares code with the thing under test: this re-exports a
 * module `sceneDiff.ts` never imports.
 */
const serverOrder = (base: readonly StampedElement[], patch: readonly StampedElement[]): string[] =>
  liveElements(reconcileElements(base, patch).elements).map((element) => element.id);

/** A tracker that has been told the board, exactly as a page load does. */
const loaded = (elements: readonly StampedElement[]): SceneDiffTracker<StampedElement> => {
  const tracker = new SceneDiffTracker<StampedElement>();
  tracker.reset(elements);
  return tracker;
};

describe("the client's model of the server's z-order", () => {
  it("keeps the survivors where the server's merge keeps them", () => {
    // A delete tombstones in place — the server's array keeps the slot, and so does the
    // engine's (`Scene::put`) — so both sides agree that `b` is simply not drawn.
    // `predictOrder` reads a live-only order, so it drops `b` too: the two agree here.
    const board = [el("a"), el("b"), el("c")];
    const tracker = loaded(board);

    const tombstone = el("b", 2, { isDeleted: true });
    tracker.acknowledge({ elements: [tombstone] });

    expect(tracker.serverOrder).toEqual(serverOrder([el("a"), tombstone, el("c")], [tombstone]));
  });

  it("appends a new id where the server's merge appends it", () => {
    // The other half that is sound: an id the server has never seen is new to both
    // sides, so "not in my order" and "never seen by the server" are the same predicate
    // and the client is right to put it on top.
    const board = [el("a"), el("b"), el("c")];
    const tracker = loaded(board);

    const fresh = el("d");
    tracker.acknowledge({ elements: [fresh] });

    expect(tracker.serverOrder).toEqual(serverOrder(board, [fresh]));
  });

  // A KNOWN FAILURE, and the only one in the repo. It is `it.fails` rather than skipped
  // on purpose: it passes only while the divergence is still there, so the day
  // `predictOrder` stops guessing wrong the ratchet turns red and someone has to come
  // and read this. It carries ONE assertion — the survivor half is the test above, so a
  // red here can only be the resurrection.
  it.fails("puts a resurrected id back where the server's merge puts it", () => {
    const board = [el("a"), el("b"), el("c")];
    const tracker = loaded(board);

    // Delete b. The server tombstones it where it stood; the client's order drops it.
    const tombstone = el("b", 2, { isDeleted: true });
    tracker.acknowledge({ elements: [tombstone] });
    const afterDelete = [el("a"), tombstone, el("c")];

    // Undo: the engine re-stamps the element above its own tombstone, so the merge takes
    // it — and `Map.set` on a key that is already there keeps the ORIGINAL slot, so the
    // server puts `b` back between `a` and `c`. The client builds its `present` set from
    // `this.order`, which is live-only (a page load is a `getBoard` with no
    // `?include=tombstones`), so `b` is missing from it and cannot be told from a
    // newcomer: it appends, and predicts ["a", "c", "b"] where the server holds
    // ["a", "b", "c"].
    //
    // The observable cost today is a redundant full-order PATCH on every undo of a
    // delete, because `diffAll` sees the mismatch against the live scene and sends an
    // explicit `order` anyway. Fixing the prediction is a separate task, and it is the
    // conservative one: send an explicit order for any id the client holds as a
    // tombstone, rather than guess. Do not make this test pass by moving
    // `reconcileElements` — the in-place tombstone is load-bearing, and compacting it
    // would silently restack every existing board on its next write.
    const back = el("b", 5);
    tracker.acknowledge({ elements: [back] });

    expect(tracker.serverOrder).toEqual(serverOrder(afterDelete, [back]));
  });
});
