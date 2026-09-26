/**
 * How far the chrome floating over the canvas reaches in from each side — Excalidraw's
 * `getOffsets` measurement (`packages/excalidraw/components/App.viewport.ts@1118751f:502-560`),
 * without its 24px padding, which the engine adds. A flowchart reveal brings what it shows
 * into the room left over, so a new node never counts as "on screen" under the toolbar.
 *
 * A surface opts in with `data-viewport-ui`, as the oracle's do: `top` covers down to its
 * bottom edge, `bottom` up to its top edge, and `side` in from whichever side its centre
 * is nearer.
 */

export interface ViewportOffsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
}

export interface ViewportSurface {
  dock: string | undefined;
  rect: Rect;
}

/** The offsets `surfaces` leave on `canvas`, all in client coordinates. */
export function viewportOffsets(
  canvas: Rect & { height: number },
  surfaces: Iterable<ViewportSurface>,
): ViewportOffsets {
  const offsets = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const { dock, rect } of surfaces) {
    const top = rect.top - canvas.top;
    const right = rect.right - canvas.left;
    const bottom = rect.bottom - canvas.top;
    const left = rect.left - canvas.left;
    if (dock === "top") {
      offsets.top = Math.max(offsets.top, bottom);
    } else if (dock === "bottom") {
      offsets.bottom = Math.max(offsets.bottom, canvas.height - top);
    } else if (dock === "side") {
      if (left + rect.width / 2 < canvas.width / 2) offsets.left = Math.max(offsets.left, right);
      else offsets.right = Math.max(offsets.right, canvas.width - left);
    }
  }
  return offsets;
}

/** Measures every `[data-viewport-ui]` surface under `root` against `canvas`'s box. */
export function measureViewportOffsets(root: ParentNode, canvas: Element): ViewportOffsets {
  const surfaces = Array.from(root.querySelectorAll<HTMLElement>("[data-viewport-ui]"), (node) => ({
    dock: node.dataset.viewportUi,
    rect: node.getBoundingClientRect(),
  }));
  return viewportOffsets(canvas.getBoundingClientRect(), surfaces);
}
