/**
 * One scene, shaped so both editors accept it unchanged.
 *
 * A comparison is only worth the numbers it produces if both sides are drawing the same
 * picture, so the elements are generated once here and injected into each app by its own
 * route — Excalidraw through `localStorage`, drawnosaurus through its board API. Anything
 * generated twice drifts, and a drift in the input is indistinguishable in the output
 * from a difference in the code.
 */

/** As much of an Excalidraw element as both editors read. */
export interface PerfElement {
  id: string;
  type: "rectangle" | "ellipse" | "diamond";
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  groupIds: string[];
  frameId: null;
  boundElements: null;
  updated: number;
  link: null;
  locked: boolean;
  /**
   * Null on purpose, in both editors.
   *
   * Excalidraw carries an object here (`{ type: 3 }`); drawnosaurus carries a number.
   * Rather than translate between the two — and quietly compare a rounded rectangle
   * against a sharp one — both get no roundness at all, which both understand.
   */
  roundness: null;
}

export type Shape = "small" | "big";

/**
 * `count` shapes, deterministic.
 *
 * `big` is the case that prompted this: screen-sized copies of one shape, offset like a
 * run of Ctrl+D, so every one of them covers the viewport and culling can do nothing.
 * `small` is a grid of ordinary shapes spread wider than any viewport, which is the case
 * culling exists for. They stress opposite things and a single number for "performance"
 * that did not distinguish them would be worthless.
 */
export function buildScene(count: number, shape: Shape): PerfElement[] {
  const elements: PerfElement[] = [];
  for (let i = 0; i < count; i += 1) {
    const big = shape === "big";
    elements.push({
      id: `perf-${i}`,
      type: (["rectangle", "ellipse", "diamond"] as const)[i % 3]!,
      x: big ? i * 12 : (i % 40) * 160,
      y: big ? i * 12 : Math.floor(i / 40) * 140,
      width: big ? 1100 : 120,
      height: big ? 640 : 90,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: i % 2 === 0 ? "#ffec99" : "transparent",
      fillStyle: "hachure",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      // Fixed per index rather than random: a benchmark whose input varies run to run
      // measures noise, and rough's output depends on this.
      seed: 1_000_003 + i * 7919,
      version: 1,
      versionNonce: 2_000_003 + i * 6791,
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      roundness: null,
    });
  }
  return elements;
}

/** The app state Excalidraw is given, so both editors start at the same camera. */
export const EXCALIDRAW_APP_STATE = {
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 },
  viewBackgroundColor: "#ffffff",
  gridModeEnabled: false,
  objectsSnapModeEnabled: false,
  // Otherwise the welcome screen and the help hints render over the canvas on first load.
  isLoading: false,
};
