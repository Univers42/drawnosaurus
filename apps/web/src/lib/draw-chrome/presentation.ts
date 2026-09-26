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
  /** A frame's name; absent or blank reads as "Frame", as the engine paints it. */
  name?: string | null;
  /** A frame's place on the presentation path (`engine.setPresentationPath`). */
  pathStep?: number;
}

export interface Slide {
  /** The frame's id, or `null` for the whole-board slide of a frame-less scene. */
  frameId: string | null;
  /** What the path editor calls it: the frame's name, or "Frame". */
  name: string;
  /** What the camera fits to — `null` only when there is nothing on the board to fit. */
  bounds: WorldBounds | null;
}

/**
 * The board's slides: its frames, in path order — by the step the path editor gave each
 * (`pathStep`), then, for frames it never placed, in the order they were made. Z-order is
 * array position (see `CLAUDE.md` › Server), which is also creation order, and the sort is
 * stable, so a board nobody ordered presents as it always did. A board with no frames is
 * one slide, fit to everything on it.
 */
export function slidesFromScene(elements: readonly SlideElement[]): Slide[] {
  const frames = elements
    .filter((el) => el.type === "frame" && !el.isDeleted)
    .sort((a, b) => (a.pathStep ?? Infinity) - (b.pathStep ?? Infinity));
  if (frames.length > 0) {
    return frames.map((frame) => ({
      frameId: frame.id,
      name: frame.name?.trim() || "Frame",
      bounds: elementBounds(frame),
    }));
  }
  return [{ frameId: null, name: "Board", bounds: sceneBounds(elements) }];
}

/** `ids` with the one at `from` moved to `to`, both clamped — the path editor's reorder. */
export function moveStop(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from < 0 || from >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(Math.min(Math.max(to, 0), next.length), 0, moved!);
  return next;
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

/** A blanked screen, as a presentation clicker's blank key and PowerPoint's B / W give. */
export type Blank = "black" | "white";

export type PresentAction = SlideStep | "exit" | Blank | { goto: number };

/**
 * What a keydown does while presenting: a slide step, leaving Present, blanking the
 * screen, or `null` for a key presenting has no use for. Every key that is not `Tab` is
 * blocked from reaching the engine while presenting (see `DrawSurface.svelte`), so `Tab`
 * is the one `null` that still has to do something: keep the presenter bar's own
 * controls reachable.
 *
 * `B` and `.` blank the screen black and `W` and `,` white, PowerPoint's keys — and what a
 * clicker's blank button sends, beside Page Up / Page Down.
 */
export function presentKeyAction(key: string): SlideStep | "exit" | Blank | null {
  if (key === "Escape") return "exit";
  if (key === "Home") return "home";
  if (key === "End") return "end";
  if (key === "b" || key === "B" || key === ".") return "black";
  if (key === "w" || key === "W" || key === ",") return "white";
  if (NEXT_KEYS.has(key)) return "next";
  if (PREV_KEYS.has(key)) return "prev";
  return null;
}

/**
 * A keydown while presenting, with the digits typed before it: what it does, and the
 * digits after it. A number then Enter goes to that slide, as in PowerPoint; Enter alone
 * is Next, and any other key forgets the digits.
 */
export function presentKey(
  key: string,
  typed: string,
): { action: PresentAction | null; typed: string } {
  if (/^[0-9]$/.test(key)) return { action: null, typed: (typed + key).slice(-4) };
  if (key === "Enter" && typed !== "") return { action: { goto: Number(typed) - 1 }, typed: "" };
  return { action: presentKeyAction(key), typed: "" };
}

/** "3 / 7" — `index` is 0-based, the text is 1-based. */
export function slideCounterText(index: number, count: number): string {
  return `${index + 1} / ${count}`;
}

/** What the Follow notice says — the same shape as `notices.ts`'s `heldNotice`. */
export function presentingNotice(name: string | undefined): string {
  return `${name?.trim() || "Someone"} is presenting — Follow`;
}
