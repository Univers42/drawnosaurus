import { elementBounds, sceneBounds, type WorldBounds } from "@drawnosaurus/contract";

/**
 * Presentation mode: the board's frames as slides, and the pure logic for stepping
 * between them, keyed by `prompt/shortkey.md`'s "Presentations" workflow (frames as
 * slides/sections, zoomed to, laser pointer while showing them). Everything here is
 * plain data in, plain data out — no engine, no DOM — so the sequencing is tested
 * without a browser. The camera math itself (`fitCamera`, the easing, the rAF driver)
 * lives in `camera.ts`, which this does not depend on.
 */

/** The margin `fitCamera` frames a slide with — small, unlike the 96px the engine's own
 *  whole-scene `fit`/`zoomToSelection` default to: a slide is meant to fill the screen. */
export const PRESENT_MARGIN = 24;

/** As much of an element as picking out slides needs. */
export interface SlideElement {
  id: string;
  type: string;
  isDeleted: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Slide {
  /** The frame's id, or `null` for the whole-board slide of a frame-less scene. */
  frameId: string | null;
  /** What the camera fits to — `null` only when there is nothing on the board to fit. */
  bounds: WorldBounds | null;
}

/**
 * The board's slides: its frames, in the order they were made — z-order is array
 * position (see `CLAUDE.md` › Server), which is also creation order, so this needs no
 * separate ordering rule. A board with no frames is one slide, fit to everything on it.
 */
export function slidesFromScene(elements: readonly SlideElement[]): Slide[] {
  const frames = elements.filter((el) => el.type === "frame" && !el.isDeleted);
  if (frames.length > 0) {
    return frames.map((frame) => ({ frameId: frame.id, bounds: elementBounds(frame) }));
  }
  return [{ frameId: null, bounds: sceneBounds(elements) }];
}

export type SlideStep = "next" | "prev" | "home" | "end";

/** The next slide index for `step`, clamped to `[0, count - 1]` — stepping past either
 *  end holds there rather than wrapping, so Next past the last slide is a no-op. */
export function stepSlideIndex(step: SlideStep, current: number, count: number): number {
  if (count <= 0) return 0;
  const at = Math.min(Math.max(current, 0), count - 1);
  switch (step) {
    case "next":
      return Math.min(at + 1, count - 1);
    case "prev":
      return Math.max(at - 1, 0);
    case "home":
      return 0;
    case "end":
      return count - 1;
  }
}

const NEXT_KEYS: ReadonlySet<string> = new Set([
  "ArrowRight",
  "ArrowDown",
  " ",
  "PageDown",
  "Enter",
]);
const PREV_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

/**
 * What a keydown does while presenting: a slide step, leaving Present, or `null` for a
 * key presenting has no use for. Every key that is not `Tab` is blocked from reaching
 * the engine while presenting (see `DrawSurface.svelte`), so `Tab` is the one `null` that
 * still has to do something: keep the presenter bar's own controls reachable.
 */
export function presentKeyAction(key: string): SlideStep | "exit" | null {
  if (key === "Escape") return "exit";
  if (key === "Home") return "home";
  if (key === "End") return "end";
  if (NEXT_KEYS.has(key)) return "next";
  if (PREV_KEYS.has(key)) return "prev";
  return null;
}

/** "3 / 7" — `index` is 0-based, the text is 1-based. */
export function slideCounterText(index: number, count: number): string {
  return `${index + 1} / ${count}`;
}

/** What the Follow notice says — the same shape as `notices.ts`'s `heldNotice`. */
export function presentingNotice(name: string | undefined): string {
  return `${name?.trim() || "Someone"} is presenting — Follow`;
}
