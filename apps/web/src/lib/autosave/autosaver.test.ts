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
});
