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

  it("sends the order a delta carries when the stack moved", () => {
    // A shape drawn into a frame goes directly below it, and the engine's delta says so.
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([el("c1"), el("f"), el("x")]);
    const patch = broadcaster.ingest(
      JSON.stringify({
        type: "osidraw-delta",
        updated: [el("n")],
        removed: [],
        order: ["c1", "n", "f", "x"],
      }),
      100,
      () => 1,
    );
    expect(patch?.elements.map((e) => e.id)).toEqual(["n"]);
    expect(patch?.order).toEqual(["c1", "n", "f", "x"]);
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

    // In any order: where a new element lands is decided by the order the server keeps,
    // not by its place in the patch.
    expect(patch?.elements.map((e) => [e.id, e.isDeleted]).sort()).toEqual([
      ["a", true],
      ["b", false],
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

describe("LiveSceneBroadcaster and pictures", () => {
  const PNG = "data:image/png;base64,AAAA";
  const photo = (version: number, patch: Record<string, unknown> = {}) =>
    ({ ...el("photo", version), type: "image", dataUrl: PNG, ...patch }) as StampedElement;
  const delta = (updated: StampedElement[], removed: string[] = []) =>
    JSON.stringify({ type: "osidraw-delta", updated, removed });

  it("sends the room a picture once, and every later edit of the image without it", () => {
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([]);
    const first = broadcaster.ingest(delta([photo(1)]), 1, () => 1);
    expect((first?.elements[0] as { dataUrl?: string }).dataUrl).toBe(PNG);

    const moved = broadcaster.ingest(delta([photo(2, { x: 40 })]), 2, () => 1);
    expect(moved?.elements[0]).not.toHaveProperty("dataUrl");
    expect(moved?.elements[0]).toMatchObject({ id: "photo", version: 2, x: 40 });
  });

  it("gives a peer's image that came without its picture the one here", () => {
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([photo(1)]);
    const theirs = { ...el("photo", 2), type: "image" } as StampedElement;
    expect(broadcaster.withPictures([theirs])).toEqual([{ ...theirs, dataUrl: PNG }]);
  });
});

describe("LiveSceneBroadcaster bringing a newcomer up to date", () => {
  it("lists what it has, with whether each image has its picture", () => {
    const broadcaster = new LiveSceneBroadcaster();
    const bare = { ...el("bare", 2), type: "image" } as StampedElement;
    const pictured = { ...el("pic", 3), type: "image", dataUrl: "data:x" } as StampedElement;
    broadcaster.reset([el("a", 4), bare, pictured]);
    expect(broadcaster.inventory()).toEqual({
      a: [4, 40],
      bare: [2, 20, 0],
      pic: [3, 30, 1],
    });
  });

  it("sends what they have not got, or have older, or have without its picture", () => {
    const broadcaster = new LiveSceneBroadcaster();
    const pictured = { ...el("pic", 3), type: "image", dataUrl: "data:x" } as StampedElement;
    broadcaster.reset([el("new"), el("newer", 5), el("same", 2), el("theirs", 1), pictured]);
    const missing = broadcaster.missing({
      newer: [4, 99],
      same: [2, 20],
      theirs: [7, 70],
      pic: [3, 30, 0],
    });
    expect(missing.map((element) => element.id).sort()).toEqual(["new", "newer", "pic"]);
  });

  it("tells them of a deletion only when they have the element", () => {
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([el("gone"), el("never")]);
    broadcaster.ingest(
      JSON.stringify({ type: "osidraw-delta", updated: [], removed: ["gone", "never"] }),
      9,
      () => 3,
    );
    const missing = broadcaster.missing({ gone: [1, 10] });
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ id: "gone", isDeleted: true, version: 2 });
  });

  it("counts what was edited here as known once it is sent", () => {
    const broadcaster = new LiveSceneBroadcaster();
    broadcaster.reset([el("a")]);
    broadcaster.observe(
      JSON.stringify({ type: "osidraw-delta", updated: [el("a", 2)], removed: [] }),
    );
    broadcaster.takePatch(1, () => 1);
    expect(broadcaster.inventory()).toEqual({ a: [2, 20] });
  });
});
