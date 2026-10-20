/**
 * Two fingers on the canvas: pinch-zoom, two-finger pan, and the long-press menu.
 *
 * Port of the oracle's gesture state machine (`App.tsx@1118751f:9100-9212`): the
 * active touches live in a map; the second finger's arrival captures the centre and
 * the starting finger distance; every later move re-pan with the centre's travel —
 * times two, the oracle's two-thumb multiplier (`:9160-9212`) — and re-zoom with the
 * distance ratio. Both hooks only fire on a change: a pure pinch sends no pan, a pure
 * drag sends no zoom, and the two of them travel in one paired move.
 *
 * `zoomAt`'s factor multiplies the scale the engine holds *right now*
 * (`camera.ts@1118751f` — `target.scale / after.scale` at the WASM boundary), so the
 * ratio is measured against where the last paired move left the fingers, not the
 * gesture's start: each move is one engine-sized step.
 *
 * The oracle's second-finger rule throws away whatever the first finger was drawing
 * (freedraw discard, `App.tsx@1118751f:8618-8630`); the front end can't see strokes,
 * so it surrogate-reports the arrival through `cancelGesture` and the engine decides
 * what to discard — everything it was holding, where the oracle keeps ten-point
 * strokes. See the report's concerns for the narrowed semantics.
 *
 * A single finger that loiters past the long-press opens the context menu where it
 * rests (`maybeOpenContextMenuAfterPointerDownOnTouchDevices`, `:9093-9110`): a
 * synthetic menu event the board routes through its own menu path. Travel past a
 * finger's slop, a second finger, or a lift cancel the press.
 *
 * While the gesture lives — two fingers down, counting down fingers, or a fired menu
 * — every touch event is swallowed (`swallow === true`), so the board draws nothing
 * under the fingers; the caller drops them before the engine's own pointer handling
 * sees a thing. Mouse pointers are none of its business and pass untouched.
 */

export type TouchHooks = {
  /** Zoom the engine's camera: focal point in screen pixels, a multiplicative factor. */
  zoomAt: (screenX: number, screenY: number, factor: number) => void;
  /** Pan the engine's camera, in screen pixels. */
  panBy: (dx: number, dy: number) => void;
  /** The engine drops whatever it was holding from the swallowed first finger. */
  cancelGesture: () => void;
  /** Open the canvas menu at a screen position, in the board's own path. */
  openContextMenu: (screenX: number, screenY: number) => void;
};

/** A touch pointer, addressed as the events address them. */
type TouchPointerLike = {
  pointerId: number;
  x: number;
  y: number;
  pointerType: string;
};

const LONG_PRESS_MS = 500;
/** A loitering finger means a press; a moving one means a drawing stroke. */
const SLOP_PX = 10;
/** The oracle's multiplier on the centre's travel: two thumbs scroll half a screen. */
const PAN_GAIN = 2;

type TrackedPointer = {
  x: number;
  y: number;
  /** Reported since the last paired zoom/pan flush. */
  moved: boolean;
};

export function createTouchController(hooks: TouchHooks) {
  const pointers = new Map<number, TrackedPointer>();
  /** Two fingers down (counting down), or a long-press: everything touch is swallowed. */
  let engaged = false;
  /** The press fired and traded its pointer-up for the menu. */
  let menuFired = false;
  let lastDistance = 0;
  let lastCentre = { x: 0, y: 0 };
  let pressAnchor = { x: 0, y: 0 };
  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPressTimer(): void {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function resetGesture(): void {
    engaged = false;
    menuFired = false;
    lastDistance = 0;
    pressAnchor = { x: 0, y: 0 };
  }

  function flushPinch(): void {
    const [first, second] = [...pointers.values()].slice(0, 2);
    if (!first || !second || !(first.moved && second.moved)) return;
    first.moved = false;
    second.moved = false;

    const centre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const dx = (centre.x - lastCentre.x) * PAN_GAIN;
    const dy = (centre.y - lastCentre.y) * PAN_GAIN;
    if (dx !== 0 || dy !== 0) hooks.panBy(dx, dy);

    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const factor = lastDistance <= 0 ? 1 : distance / lastDistance;
    if (factor !== 1) hooks.zoomAt(centre.x, centre.y, factor);

    lastCentre = centre;
    lastDistance = distance;
  }

  function engageGesture(): void {
    const [first, second] = [...pointers.values()].slice(0, 2);
    if (first && second) {
      lastCentre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      lastDistance = Math.hypot(second.x - first.x, second.y - first.y);
      first.moved = false;
      second.moved = false;
    }
    engaged = true;
  }

  function isTouch(event: TouchPointerLike): boolean {
    return event.pointerType === "touch";
  }

  const swallow = (swallowed: boolean) => ({ swallow: swallowed });

  return {
    down(event: TouchPointerLike) {
      if (!isTouch(event)) return swallow(false);
      if (engaged) {
        pointers.set(event.pointerId, { x: event.x, y: event.y, moved: false });
        return swallow(true);
      }
      if (pointers.size === 0) {
        pointers.set(event.pointerId, { x: event.x, y: event.y, moved: false });
        pressAnchor = { x: event.x, y: event.y };
        pressTimer = setTimeout(() => {
          pressTimer = null;
          menuFired = true;
          engaged = true;
          hooks.openContextMenu(event.x, event.y);
        }, LONG_PRESS_MS);
        return swallow(false);
      }
      // A second finger instead of a menu: the first finger's stroke is no longer
      // wanted — the engine decides what its own pointer was holding.
      clearPressTimer();
      if (pointers.size === 1) hooks.cancelGesture();
      pointers.set(event.pointerId, { x: event.x, y: event.y, moved: false });
      engageGesture();
      return swallow(true);
    },

    move(event: TouchPointerLike) {
      if (!isTouch(event)) return swallow(false);
      if (engaged) {
        const tracked = pointers.get(event.pointerId);
        if (tracked && pointers.size >= 2) {
          tracked.x = event.x;
          tracked.y = event.y;
          tracked.moved = true;
          flushPinch();
        }
        return swallow(true);
      }
      // Not engaged: a single finger is the board's to handle. Only the loitering
      // press cares — travel past the slop means a moving finger, not a resting one.
      if (
        pressTimer !== null &&
        Math.hypot(event.x - pressAnchor.x, event.y - pressAnchor.y) > SLOP_PX
      ) {
        clearPressTimer();
      }
      return swallow(false);
    },

    up(event: TouchPointerLike) {
      if (!isTouch(event)) return swallow(false);
      if (!pointers.has(event.pointerId)) return swallow(false);
      clearPressTimer();
      pointers.delete(event.pointerId);
      // Every finger's lift is swallowed while the gesture lives, except the last
      // one: the board saw that first pointerdown, so it gets the matching pointerup
      // — inert because the engine's stroke was cancelled underneath it — and the
      // next plain touch is a plain touch again.
      const swallowed = pointers.size > 0 || menuFired;
      if (pointers.size === 0) resetGesture();
      return swallow(swallowed);
    },
  };
}

export type TouchController = ReturnType<typeof createTouchController>;
