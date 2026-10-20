import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createTouchController, type TouchHooks } from "./touchGesture.ts";

/**
 * Two fingers on the canvas.
 *
 * The oracle's gesture state machine (`App.tsx@1118751f:9100-9212`): pointers in a map,
 * the second down captures the centre, the starting scale and the starting distance;
 * every later move re-centres and re-pan with the centre's travel, re-zooms with the
 * distance ratio (`:9160-9212`), and a second finger's arrival throws away whatever
 * shape the first was drawing (`:8618-8630`s rule, narrowed here — see the module's
 * note). A loitering single finger opens the context menu
 * (`maybeOpenContextMenuAfterPointerDownOnTouchDevices`, `:9093-9110`).
 *
 * The front end computes nothing else: it owns the geometry, and the engine owns the
 * camera — zoom through `zoomAt`, pan through `panBy`.
 */

function makeHooks(): TouchHooks & {
  zoomAt: ReturnType<typeof vi.fn>;
  panBy: ReturnType<typeof vi.fn>;
  cancelGesture: ReturnType<typeof vi.fn>;
  openContextMenu: ReturnType<typeof vi.fn>;
} {
  return {
    zoomAt: vi.fn(),
    panBy: vi.fn(),
    cancelGesture: vi.fn(),
    openContextMenu: vi.fn(),
  };
}

/** One synthetic pointer, addressed by id as the browser would. */
const down = (c: ReturnType<typeof createTouchController>, id: number, x: number, y: number) =>
  c.down({ pointerId: id, x, y, pointerType: "touch" } as never);
const move = (c: ReturnType<typeof createTouchController>, id: number, x: number, y: number) =>
  c.move({ pointerId: id, x, y, pointerType: "touch", buttons: 1 } as never);
const up = (c: ReturnType<typeof createTouchController>, id: number, x: number, y: number) =>
  c.up({ pointerId: id, x, y, pointerType: "touch" } as never);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTouchController", () => {
  it("pinches: the distance ratio zooms at the two fingers' centre", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    down(c, 1, 100, 200);
    down(c, 2, 200, 200);
    hooks.zoomAt.mockClear();
    hooks.panBy.mockClear();

    move(c, 1, 50, 200);
    move(c, 2, 250, 200);

    expect(hooks.zoomAt).toHaveBeenCalledWith(150, 200, 2);
    expect(hooks.panBy).not.toHaveBeenCalled();
  });

  it("drags two fingers: the centre's travel pans, twice over", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    down(c, 1, 100, 200);
    down(c, 2, 200, 200);
    hooks.zoomAt.mockClear();
    hooks.panBy.mockClear();

    move(c, 1, 130, 220);
    move(c, 2, 230, 220);

    expect(hooks.panBy).toHaveBeenCalledWith(60, 40);
    expect(hooks.zoomAt).not.toHaveBeenCalled();
  });

  it("does both in one move: a hand walking fingers apart drifts while it grows", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    down(c, 1, 100, 200);
    down(c, 2, 200, 200);
    hooks.zoomAt.mockClear();
    hooks.panBy.mockClear();

    // The pair flushes once both fingers have reported: the centre walked up ten
    // pixels (twice that on the board) while the spread grew to 1.5 — one move does
    // both, and neither hook is called with a no-op.
    move(c, 1, 75, 190);
    move(c, 2, 225, 190);

    expect(hooks.zoomAt).toHaveBeenCalledWith(150, 190, 1.5);
    expect(hooks.panBy).toHaveBeenCalledWith(0, -20);
  });

  it("a second finger cancels the shape the first was drawing", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    down(c, 1, 100, 200);
    expect(c.down({ pointerId: 2, x: 200, y: 200, pointerType: "touch" } as never).swallow).toBe(
      true,
    );
    expect(hooks.cancelGesture).toHaveBeenCalledOnce();
  });

  it("swallows the whole two-finger gesture: the board draws nothing under it", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    expect(down(c, 1, 100, 200).swallow).toBe(false);
    down(c, 2, 200, 200);
    expect(move(c, 1, 120, 210).swallow).toBe(true);
    expect(move(c, 2, 220, 190).swallow).toBe(true);
    // One finger lifting does not hand the board back to its drag: the survivor is
    // silent until it lifts too, as the oracle's gesture ends.
    expect(up(c, 2, 220, 190).swallow).toBe(true);
    expect(move(c, 1, 140, 220).swallow).toBe(true);
    // And once the last finger is up, a plain touch is a plain touch again.
    expect(up(c, 1, 140, 220).swallow).toBe(false);
    expect(down(c, 3, 300, 300).swallow).toBe(false);
  });

  it("zooms in steps, each measured from where the last move left the fingers", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    down(c, 1, 100, 200);
    down(c, 2, 200, 200);
    hooks.zoomAt.mockClear();

    move(c, 1, 50, 200);
    move(c, 2, 250, 200);
    expect(hooks.zoomAt).toHaveBeenLastCalledWith(150, 200, 2);

    // A further spread is a further ratio — 1.5 of the distance the first move left,
    // not 3 of the starting distance: the engine already holds the factor's result,
    // since `zoomAt`'s factor multiplies the scale it has now
    // (`camera.ts@1118751f` — `target.scale / after.scale` at the WASM boundary).
    move(c, 1, 0, 200);
    move(c, 2, 300, 200);
    expect(hooks.zoomAt).toHaveBeenLastCalledWith(150, 200, 1.5);
  });

  it("a long press opens the context menu where the finger rests", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    down(c, 1, 120, 340);
    vi.advanceTimersByTime(600);
    expect(hooks.openContextMenu).toHaveBeenCalledWith(120, 340);
    // And the tap that opened it trades its pointer-up for the menu: everything about
    // this gesture is swallowed so the lift does not also click the board.
    expect(up(c, 1, 120, 340).swallow).toBe(true);
  });

  it("a long press claims the click its lift produces", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    // Nothing has been pressed: there is no click to claim.
    expect(c.consumeClick()).toBe(false);

    down(c, 1, 120, 340);
    vi.advanceTimersByTime(600);
    up(c, 1, 120, 340);

    // The lift of a finger that opened a menu also produces a click, and the menu is
    // under the finger by then: the click belongs to the gesture that opened the menu,
    // not to whatever happens to be under the finger.
    expect(c.consumeClick()).toBe(true);
    // And only that one: the next click is the person's.
    expect(c.consumeClick()).toBe(false);
  });

  it("a plain tap claims no click", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    down(c, 1, 120, 340);
    up(c, 1, 120, 340);
    expect(c.consumeClick()).toBe(false);
  });

  it("a long press is cancelled by travel, a second finger, or a lift", () => {
    const hooks = makeHooks();
    let c = createTouchController(hooks);
    down(c, 1, 120, 340);
    move(c, 1, 150, 370);
    vi.advanceTimersByTime(600);
    expect(hooks.openContextMenu).not.toHaveBeenCalled();
    up(c, 1, 150, 370);

    hooks.cancelGesture.mockClear();
    c = createTouchController(hooks);
    down(c, 1, 120, 340);
    down(c, 2, 300, 300);
    vi.advanceTimersByTime(600);
    expect(hooks.openContextMenu).not.toHaveBeenCalled();
    up(c, 1, 130, 340);
    up(c, 2, 310, 300);

    c = createTouchController(hooks);
    down(c, 1, 120, 340);
    up(c, 1, 120, 340);
    vi.advanceTimersByTime(600);
    expect(hooks.openContextMenu).not.toHaveBeenCalled();
  });

  it("mouse pointers are none of its business", () => {
    const hooks = makeHooks();
    const c = createTouchController(hooks);
    down(c, 1, 100, 200);
    down(c, 2, 200, 200);
    hooks.cancelGesture.mockClear();
    expect(c.down({ pointerId: 3, x: 300, y: 300, pointerType: "mouse" } as never).swallow).toBe(
      false,
    );
    expect(hooks.cancelGesture).not.toHaveBeenCalled();
  });
});
