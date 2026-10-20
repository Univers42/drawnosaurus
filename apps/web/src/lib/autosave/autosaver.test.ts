import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneAutosaver, type AutosaveStatus } from "./autosaver.ts";
import type { StampedElement } from "./sceneDiff.ts";

const el = (id: string, version = 1): StampedElement => ({
  id,
  version,
  versionNonce: version * 10,
  updated: version,
  isDeleted: false,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SceneAutosaver", () => {
  it("coalesces a burst of changes into one request", async () => {
    let scene = [el("a")];
    const send = vi.fn().mockResolvedValue(undefined);
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      now: () => 0,
      nonce: () => 1,
    });

    // A stroke fires a scene-change per pointer move; one request should come out.
    saver.notify();
    scene = [el("a", 2)];
    saver.notify();
    scene = [el("a", 3)];
    saver.notify();

    await vi.advanceTimersByTimeAsync(800);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].elements[0]).toMatchObject({ id: "a", version: 3 });
  });

  it("sends nothing when the scene did not actually change", async () => {
    const scene = [el("a")];
    const send = vi.fn().mockResolvedValue(undefined);
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      now: () => 0,
      nonce: () => 1,
    });

    saver.tracker.reset(scene);
    saver.notify();
    await vi.advanceTimersByTimeAsync(800);

    expect(send).not.toHaveBeenCalled();
  });

  it("keeps one request in flight and follows up with what arrived meanwhile", async () => {
    let scene = [el("a")];
    let release: (() => void) | undefined;
    const send = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      now: () => 0,
      nonce: () => 1,
    });

    saver.notify();
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(1);

    // Drawing continues while the first request is still open.
    scene = [el("a", 2), el("b")];
    saver.notify();
    expect(send).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(800);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].elements.map((e: StampedElement) => e.id)).toEqual(["a", "b"]);
  });

  it("retries with backoff and stays dirty until the server accepts", async () => {
    const scene = [el("a")];
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);

    const statuses: AutosaveStatus[] = [];
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      onStatus: (status) => statuses.push(status),
      now: () => 0,
      nonce: () => 1,
    });

    saver.notify();
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000); // first retry
    expect(send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000); // doubled
    expect(send).toHaveBeenCalledTimes(3);

    expect(statuses).toContain("error");
    expect(statuses.at(-1)).toBe("idle");
  });

  it("does not retry a final refusal, and tries again with the next change", async () => {
    let scene = [el("a")];
    const send = vi.fn().mockRejectedValue(new Error("413"));
    const statuses: AutosaveStatus[] = [];
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      onStatus: (status) => statuses.push(status),
      classify: () => "too-large",
      now: () => 0,
      nonce: () => 1,
    });

    saver.notify();
    await vi.advanceTimersByTimeAsync(800);
    // A retry loop would have sent it several more times by now.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("too-large");

    scene = [el("a"), el("b")];
    saver.notify();
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(2);
    // Still unacknowledged: the refused element goes out again with the new one.
    expect(send.mock.lastCall?.[0].elements.map((e: StampedElement) => e.id)).toEqual(["a", "b"]);
  });

  it("does not acknowledge a failed patch, so the element is resent", async () => {
    const scene = [el("a")];
    const send = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      now: () => 0,
      nonce: () => 1,
    });

    saver.notify();
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].elements.map((e: StampedElement) => e.id)).toEqual(["a"]);
  });

  it("flush sends without waiting for the debounce", async () => {
    const scene = [el("a")];
    const send = vi.fn().mockResolvedValue(undefined);
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      now: () => 0,
      nonce: () => 1,
    });

    saver.notify();
    await saver.flush();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("goes quiet after dispose", async () => {
    const scene = [el("a")];
    const send = vi.fn().mockResolvedValue(undefined);
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      now: () => 0,
      nonce: () => 1,
    });

    saver.notify();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(send).not.toHaveBeenCalled();
  });

  /** A saver whose sends stay open until the test lets them land, one at a time. */
  function holdingSaver(readScene: () => readonly StampedElement[]) {
    const landings: Array<() => void> = [];
    const send = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          landings.push(resolve);
        }),
    );
    const saver = new SceneAutosaver({ readScene, send, now: () => 0, nonce: () => 1 });
    return { saver, send, land: () => landings.shift()?.() };
  }

  it("flush() during a request in flight sends what was noted before it, once that lands", async () => {
    let scene = [el("a")];
    const { saver, send, land } = holdingSaver(() => scene);

    saver.notify();
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(1);

    scene = [el("a", 2)];
    saver.notify();
    const flushed = saver.flush();
    // One request in flight at a time: the second waits for the first.
    expect(send).toHaveBeenCalledTimes(1);

    land();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].elements[0]).toMatchObject({ id: "a", version: 2 });

    land();
    await flushed;
  });

  it("flush() then dispose() right after still sends what was noted before the flush", async () => {
    let scene = [el("a")];
    const { saver, send, land } = holdingSaver(() => scene);

    saver.notify();
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(1);

    scene = [el("a", 2)];
    saver.notify();
    const flushed = saver.flush();
    // The page is leaving: the board component disposes straight after flushing.
    saver.dispose();

    land();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].elements[0]).toMatchObject({ id: "a", version: 2 });

    land();
    await flushed;
  });

  it("sends nothing noted after dispose()", async () => {
    let scene = [el("a")];
    const send = vi.fn().mockResolvedValue(undefined);
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      now: () => 0,
      nonce: () => 1,
    });

    saver.dispose();
    scene = [el("a", 2)];
    saver.notify();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(send).not.toHaveBeenCalled();
  });
});

describe("SceneAutosaver with a throttle", () => {
  // The online copy's saver (`sharing/storedCopy.ts`): someone who draws without a pause
  // must still be saved, so new edits do not push the save back as a debounce's do.
  function drawing(options: { throttleMs?: number; debounceMs?: number }) {
    let version = 1;
    let scene = [el("a")];
    const send = vi.fn().mockResolvedValue(undefined);
    const saver = new SceneAutosaver({
      readScene: () => scene,
      send,
      now: () => 0,
      nonce: () => 1,
      ...options,
    });
    saver.tracker.reset(scene);
    const edit = () => {
      version += 1;
      scene = [el("a", version)];
      saver.notify();
    };
    return { saver, send, edit };
  }

  it("saves every 20 s while edits keep coming: one a second for a minute is 3 saves", async () => {
    const { send, edit } = drawing({ throttleMs: 20_000 });

    for (let second = 0; second < 60; second += 1) {
      edit();
      await vi.advanceTimersByTimeAsync(1000);
    }
    await vi.advanceTimersByTimeAsync(60_000);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.at(-1)?.[0].elements[0]).toMatchObject({ version: 61 });
  });

  it("where a debounce of the same length saves nothing until the edits stop", async () => {
    const { send, edit } = drawing({ debounceMs: 20_000 });

    for (let second = 0; second < 60; second += 1) {
      edit();
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(send).not.toHaveBeenCalled();
  });

  it("waits the throttle for one edit alone, and a flush does not wait at all", async () => {
    const { saver, send, edit } = drawing({ throttleMs: 20_000 });

    edit();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);

    edit();
    await saver.flush();
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send, "the flush took the throttled save's place").toHaveBeenCalledTimes(2);
  });
});
