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
