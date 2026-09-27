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
import { SceneDiffTracker, type ScenePatch, type StampedElement } from "./sceneDiff.ts";

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

/**
 * One save: the patch that would go out, and its acknowledgement — the production path,
 * where the patch carries whatever `diff` decided to put in it.
 */
const saved = (
  tracker: SceneDiffTracker<StampedElement>,
  current: readonly StampedElement[],
  now: number,
  lookup?: (id: string) => StampedElement | undefined,
): ScenePatch<StampedElement> => {
  // A null patch would already have failed the caller's assertion, so acknowledging an
  // empty one costs nothing and keeps this free of a non-null assertion — the line after
  // it is the one that reports the damage.
  const patch: ScenePatch<StampedElement> = tracker.diff(current, now, nonce, lookup) ?? {
    elements: [],
  };
  tracker.acknowledge(patch);
  return patch;
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

  // A KNOWN FAILURE, and the only one in the repo. `it.fails` rather than skipped, so it
  // cannot be deleted later as obsolete: it is green only for as long as the divergence
  // is there.
  //
  // What it does NOT tell you is how the divergence gets fixed, and the obvious answer is
  // wrong. MEASURED, with and without the design's guard
  // (`resurrected ? null : predictOrder(...)` in `diffAll`): this test stays red either
  // way, because it drives `acknowledge` on a patch that carries no `order`, and
  // `acknowledge` runs `predictOrder` whenever `patch.order` is absent. The guard
  // deliberately leaves that line alone — on the production path the patch arrives WITH
  // an order, which is the case below. So a fix has to stop an orderless patch being
  // predicted for; changing what `diffAll` predicts will not turn this green, and
  // whoever lands it should not delete this on the strength of having done so.
  //
  // It carries ONE assertion, so a red here can only be the resurrection.
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
    // Nothing is corrupted by this, and the reason is the case below, not this one. Do
    // not make this test pass by moving `reconcileElements` — the in-place tombstone is
    // load-bearing, and compacting it would silently restack every existing board on its
    // next write.
    const back = el("b", 5);
    tracker.acknowledge({ elements: [back] });

    expect(tracker.serverOrder).toEqual(serverOrder(afterDelete, [back]));
  });

  it("keeps the server's order when the patch goes out through diff", () => {
    // The production path, and the reason the case above is not corrupting anything: the
    // patch a save actually sends is built by `diff`, and `diffAll` compares the
    // prediction against the live scene it was handed, sees them disagree, and puts the
    // correction on the wire as an explicit `order` — so `acknowledge` runs THAT and the
    // model the client keeps is the server's. The cost of the wrong prediction is a
    // full-order PATCH on every undo of a delete, not a restacked board.
    //
    // A characterisation, not a ratchet: green today, and green with the design's guard
    // as well, which only changes how `diffAll` gets to the explicit-order path. It is
    // here so the honest reason a wrong primitive is survivable stays pinned — a change
    // that made `diffAll` stop sending the order on a mismatch would leave the next
    // reader wrong about why nothing has been lost yet.
    const board = [el("a"), el("b"), el("c")];
    const tracker = loaded(board);

    // Delete b the way a save does: note it, diff, acknowledge. The engine's export
    // drops tombstones, so the lookup hands back the deleted shape and the tracker
    // synthesises the tombstone the server's merge needs.
    const tombstone = el("b", 2, { isDeleted: true });
    tracker.noteChanged(["b"]);
    const deleting = saved(tracker, [el("a"), tombstone, el("c")], 100, (id) =>
      id === "b" ? tombstone : el(id),
    );
    expect(deleting.elements.map((element) => element.id)).toEqual(["b"]);
    const afterDelete = [el("a"), tombstone, el("c")];

    // Undo: the engine sends a whole scene, so the comparison is against everything.
    const back = el("b", 5);
    tracker.noteEverything();
    const undo = saved(tracker, [el("a"), back, el("c")], 200);
    expect(undo.order).toEqual(["a", "b", "c"]);
    expect(tracker.serverOrder).toEqual(serverOrder(afterDelete, [back]));
  });
});
