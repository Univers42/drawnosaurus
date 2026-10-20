import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneAutosaver, type AutosaveStatus } from "../autosave/autosaver.ts";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";
import { holdForSave, type Departure } from "./holdForSave.ts";

const el = (id: string): StampedElement => ({
  id,
  version: 1,
  versionNonce: 10,
  updated: 1,
  isDeleted: false,
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A board's real saver, one change noted and not sent yet; the test answers its sends. */
function board(send: (patch: ScenePatch<StampedElement>) => Promise<void>) {
  let status: AutosaveStatus = "idle";
  const scene = [el("a")];
  const saver = new SceneAutosaver({
    readScene: () => scene,
    send,
    onStatus: (next) => {
      status = next;
    },
    now: () => 0,
    nonce: () => 1,
  });
  saver.notify();
  return { saver, scene, status: () => status };
}

const departure = (more: Partial<Departure> = {}): Departure => ({
  type: "link",
  willUnload: false,
  to: { url: new URL("http://localhost/gallery") },
  cancel: vi.fn(),
  ...more,
});

function leave(
  navigation: Departure,
  { saver, status }: ReturnType<typeof board>,
  { browser = true, flush = () => saver.flush() } = {},
) {
  const go = vi.fn();
  const goto = vi.fn(async () => undefined);
  const held = holdForSave(navigation, { browser, status, flush, go, goto });
  return { held, go, goto };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("holdForSave, in the browser build", () => {
  it("holds a navigation away from an unsent change until it is saved, then makes it", async () => {
    const sent = deferred();
    const send = vi.fn(() => sent.promise);
    const drawing = board(send);
    const navigation = departure();

    const { held, goto } = leave(navigation, drawing);

    expect(navigation.cancel).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(goto, "not before the save has landed").not.toHaveBeenCalled();

    sent.resolve();
    await held;

    expect(drawing.status()).toBe("idle");
    expect(goto).toHaveBeenCalledWith(navigation.to?.url);
    // Made again, it is not held a second time: nothing is waiting any more.
    const again = departure();
    expect(leave(again, drawing).held).toBeNull();
    expect(again.cancel).not.toHaveBeenCalled();
  });

  it("waits for a save already in flight, and for what was noted after it", async () => {
    const first = deferred();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const drawing = board(send);
    await vi.advanceTimersByTimeAsync(800);
    expect(drawing.status()).toBe("saving");
    drawing.scene.push(el("b"));
    drawing.saver.notify();

    const { held, goto } = leave(departure(), drawing);
    await vi.advanceTimersByTimeAsync(0);
    expect(goto).not.toHaveBeenCalled();

    first.resolve();
    await held;
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].elements.map(({ id }: StampedElement) => id)).toEqual(["b"]);
    expect(drawing.status()).toBe("idle");
    expect(goto).toHaveBeenCalledOnce();
  });

  it("stays on the drawing, its failure on the save line, when the save fails", async () => {
    const drawing = board(() => Promise.reject(new Error("QuotaExceededError")));
    const navigation = departure();

    const { held, go, goto } = leave(navigation, drawing);
    await held;

    expect(navigation.cancel).toHaveBeenCalledOnce();
    expect(drawing.status()).toBe("error");
    expect(goto).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it("stays on the drawing when the flush itself rejects", async () => {
    const drawing = board(async () => undefined);

    const { held, goto } = leave(departure(), drawing, {
      flush: () => Promise.reject(new Error("no")),
    });

    await expect(held).resolves.toBeUndefined();
    expect(goto).not.toHaveBeenCalled();
  });

  it("takes Back or Forward again by the same number of steps", async () => {
    const drawing = board(async () => undefined);

    const { held, go, goto } = leave(departure({ type: "popstate", delta: -2 }), drawing);
    await held;

    expect(go).toHaveBeenCalledWith(-2);
    expect(goto).not.toHaveBeenCalled();
  });
});

describe("holdForSave lets a navigation straight through", () => {
  it("when nothing is waiting to be saved", async () => {
    const drawing = board(async () => undefined);
    await vi.advanceTimersByTimeAsync(800);
    expect(drawing.status()).toBe("idle");
    const navigation = departure();

    expect(leave(navigation, drawing).held).toBeNull();
    expect(navigation.cancel).not.toHaveBeenCalled();
  });

  it("in the server build, whose draft keeps what the save has not sent", () => {
    const send = vi.fn(async () => undefined);
    const navigation = departure();

    expect(leave(navigation, board(send), { browser: false }).held).toBeNull();
    expect(navigation.cancel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("when the page is unloading: a closing tab cannot be held, and saves on hide", () => {
    const send = vi.fn(async () => undefined);
    const navigation = departure({ type: "leave", willUnload: true, to: null });

    expect(leave(navigation, board(send)).held).toBeNull();
    expect(navigation.cancel).not.toHaveBeenCalled();
  });
});
