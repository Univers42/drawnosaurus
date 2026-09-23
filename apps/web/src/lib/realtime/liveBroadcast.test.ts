import { describe, expect, it } from "vitest";
import { LiveSceneBroadcaster, remotePatchToSceneEvent } from "./liveBroadcast.ts";
import type { StampedElement } from "../autosave/sceneDiff.ts";

const el = (id: string, version = 1, patch: Partial<StampedElement> = {}): StampedElement => ({
  id,
  version,
  versionNonce: version * 10,
  updated: version,
  isDeleted: false,
  ...patch,
});

describe("LiveSceneBroadcaster", () => {
  it("broadcasts creates from a delta", () => {
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([]);
    const patch = broadcaster.ingest(
      JSON.stringify({ type: "osidraw-delta", updated: [el("a")], removed: [] }),
      100,
      () => 1,
    );
    expect(patch?.elements.map((e) => e.id)).toEqual(["a"]);
  });

  it("synthesises a tombstone when the engine reports a soft-delete id", () => {
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([el("a", 3), el("b")]);
    const patch = broadcaster.ingest(
      JSON.stringify({ type: "osidraw-delta", updated: [], removed: ["a"] }),
      500,
      () => 777,
    );
    expect(patch?.elements).toEqual([
      expect.objectContaining({
        id: "a",
        isDeleted: true,
        version: 4,
        versionNonce: 777,
        updated: 500,
      }),
    ]);
  });

  it("does not re-broadcast a patch after adoptRemote", () => {
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([el("a")]);
    broadcaster.adoptRemote({
      elements: [{ ...el("a", 2), x: 10 } as StampedElement],
    });
    expect(
      broadcaster.ingest(
        JSON.stringify({
          type: "osidraw",
          version: 1,
          elements: [{ ...el("a", 2), x: 10 }],
        }),
        200,
        () => 1,
      ),
    ).toBeNull();
  });

  it("sends an explicit order when z-order changes without stamp moves", () => {
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([el("a"), el("b")]);
    const patch = broadcaster.ingest(
      JSON.stringify({ type: "osidraw", version: 1, elements: [el("b"), el("a")] }),
      100,
      () => 1,
    );
    expect(patch?.order).toEqual(["b", "a"]);
  });
});

describe("changes made while the socket is down", () => {
  it("are kept, and go out together once they can", () => {
    // Observed but not taken, as the page does while disconnected. They used to be
    // marked as sent the moment they were diffed, and the send was dropped.
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([el("a")]);
    broadcaster.observe(
      JSON.stringify({ type: "osidraw-delta", updated: [el("a", 2)], removed: [] }),
    );
    broadcaster.observe(JSON.stringify({ type: "osidraw-delta", updated: [el("b")], removed: [] }));
    broadcaster.observe(JSON.stringify({ type: "osidraw-delta", updated: [], removed: ["a"] }));

    const patch = broadcaster.takePatch(900, () => 5);

    expect(patch?.elements.map((e) => [e.id, e.isDeleted])).toEqual([
      ["b", false],
      ["a", true],
    ]);
    expect(
      broadcaster.takePatch(901, () => 6),
      "and only once",
    ).toBeNull();
  });
});

describe("remotePatchToSceneEvent", () => {
  it("turns tombstones into a host delta the page applyDelta understands", () => {
    const event = JSON.parse(
      remotePatchToSceneEvent({
        elements: [el("keep", 2), { ...el("gone", 3), isDeleted: true }],
      }),
    );
    expect(event).toEqual({
      type: "osidraw-delta",
      updated: [el("keep", 2)],
      removed: ["gone"],
    });
  });
});
