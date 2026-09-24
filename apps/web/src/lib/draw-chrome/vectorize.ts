/**
 * The Vectorize dialog's arithmetic: presets, what its sliders mean, and what can be
 * inserted. Everything here is plain data so it is tested without a browser; the tracing
 * is `TraceWorker` (`@osionos/draw-engine/vectorize`), the insert `engine.vectorizeImage`.
 * See `docs/reference/vectorize.md`.
 */
import {
  MAX_ELEMENTS_PER_BOARD,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_POINTS_PER_ELEMENT,
} from "@drawnosaurus/contract";
import type {
  TraceConfig,
  TracePreset,
  TraceProgress,
  TraceStats,
  VectorizeLimits,
  VectorizeRefusal,
} from "@osionos/draw-engine/vectorize";

/**
 * The longest side a picture is traced at, in pixels.
 *
 * Tracing time grows at least as fast as the pixel count. Measured in a Chromium worker
 * on a photo (`docs/reference/vectorize.md`): the Photo preset takes 2.6 s at 1440 × 960,
 * the largest a board keeps a picture, and 1.1 s at 1024 × 683. The result is vectors
 * either way, so what is lost is detail finer than a thousandth of the picture.
 */
export const TRACE_MAX_SIDE = 1024;

/**
 * The most elements one editable insert may add.
 *
 * Measured with the engine (`docs/reference/vectorize.md`): 4,530 shapes cost a 79 ms
 * frame when they first appear and 8.5 ms a frame redrawn at 4× zoom; 6,983 cost 129 ms
 * and 11.9 ms, and 9,724 cost 182 ms and 17 ms — past a frame's budget. Five thousand
 * keeps a redraw under 10 ms.
 */
export const MAX_TRACE_SHAPES = 5_000;

/**
 * How deeply groups may nest — the contract's `MAX_GROUP_DEPTH`, which it does not export.
 * `vectorize.test.ts` pins the two together through the element schema.
 */
export const MAX_GROUP_DEPTH = 32;

export const VECTORIZE_LIMITS: VectorizeLimits = {
  maxElements: MAX_ELEMENTS_PER_BOARD,
  maxPointsPerElement: MAX_POINTS_PER_ELEMENT,
  maxTraceShapes: MAX_TRACE_SHAPES,
  maxDataUrlLength: MAX_IMAGE_DATA_URL_LENGTH,
  maxGroupDepth: MAX_GROUP_DEPTH,
};

/** The three sliders, each a whole-number position. */
export interface Dials {
  /** 1–16: more is more colour layers. */
  colours: number;
  /** 1–16: more keeps smaller patches. */
  detail: number;
  /** 0–12: more rounds off more corners. */
  smoothness: number;
}

export const DIAL_RANGE: Record<keyof Dials, { min: number; max: number }> = {
  colours: { min: 1, max: 16 },
  detail: { min: 1, max: 16 },
  smoothness: { min: 0, max: 12 },
};

export interface PresetChoice {
  preset: TracePreset;
  label: string;
  /** Where the sliders start. */
  dials: Dials;
  /**
   * Significant bits per colour channel. Six rather than the tracer's eight for both
   * colour presets: measured three times faster on a photo for 1–4% more shapes.
   */
  colorPrecision?: number;
}

/**
 * The dialog's presets, tuned from the tracer's own (`crates/draw-trace`). Measured at
 * 1024 px on a photo: Poster 4,530 shapes, Photo 735, Line art 297.
 */
export const PRESETS: readonly PresetChoice[] = [
  // vtracer's Poster is 16 apart and 8 bits; 32 apart halves the shapes on a photo.
  {
    preset: "poster",
    label: "Poster",
    dials: { colours: 13, detail: 13, smoothness: 4 },
    colorPrecision: 6,
  },
  {
    preset: "photo",
    label: "Photo",
    dials: { colours: 11, detail: 7, smoothness: 12 },
    colorPrecision: 6,
  },
  { preset: "bw", label: "Line art", dials: { colours: 13, detail: 13, smoothness: 4 } },
];

export function presetChoice(preset: TracePreset): PresetChoice {
  return PRESETS.find((choice) => choice.preset === preset) ?? PRESETS[0]!;
}

/** Colour distance between stacked layers: 8 at the most colours, 128 at the fewest. */
export function layerDifference(colours: number): number {
  return 8 * (17 - clampDial("colours", colours));
}

/** Patches smaller than this many pixels square are dropped. */
export function filterSpeckle(detail: number): number {
  return 17 - clampDial("detail", detail);
}

/** Degrees past which a turn stays a corner: 0 keeps every one, 180 rounds them all. */
export function cornerThreshold(smoothness: number): number {
  return 15 * clampDial("smoothness", smoothness);
}

function clampDial(dial: keyof Dials, value: number): number {
  const { min, max } = DIAL_RANGE[dial];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Whether a dial means anything for a preset: line art has two colours, not layers. */
export function dialApplies(preset: TracePreset, dial: keyof Dials): boolean {
  return !(preset === "bw" && dial === "colours");
}

/** What the worker is asked to trace. */
export function traceConfig(preset: TracePreset, dials: Dials): TraceConfig {
  const choice = presetChoice(preset);
  return {
    preset,
    ...(choice.colorPrecision === undefined ? {} : { colorPrecision: choice.colorPrecision }),
    ...(dialApplies(preset, "colours") ? { layerDifference: layerDifference(dials.colours) } : {}),
    filterSpeckle: filterSpeckle(dials.detail),
    cornerThreshold: cornerThreshold(dials.smoothness),
  };
}

/** How long the picture's `data:` URL is for an SVG of `svgBytes` bytes. */
export function pictureUrlLength(svgBytes: number): number {
  return "data:image/svg+xml;base64,".length + 4 * Math.ceil(svgBytes / 3);
}

export type InsertAs = "shapes" | "picture";

/** What would bring a trace under the caps, from where the dialog is now. */
function advice(preset: TracePreset): string {
  if (preset === "poster") return "Try the Photo preset, or fewer colours.";
  if (preset === "photo") return "Try fewer colours or less detail.";
  return "Try less detail.";
}

/**
 * Why this trace cannot be inserted this way, or `null` if it can — known from the stats
 * alone, before the engine is asked. The engine checks again, and has the last word on
 * what only it knows (how full the board is).
 */
export function insertBlocker(stats: TraceStats, as: InsertAs, preset: TracePreset): string | null {
  if (stats.shapes === 0) return "Nothing was traced. Try more detail.";
  if (as === "shapes" && stats.shapes > MAX_TRACE_SHAPES) {
    return `${count(stats.shapes)} shapes is too many to edit — at most ${count(MAX_TRACE_SHAPES)} at once. ${advice(preset)}`;
  }
  if (as === "picture" && pictureUrlLength(stats.svgBytes) > MAX_IMAGE_DATA_URL_LENGTH) {
    return `The picture would be ${megabytes(pictureUrlLength(stats.svgBytes))} — at most ${megabytes(MAX_IMAGE_DATA_URL_LENGTH)}. ${advice(preset)}`;
  }
  return null;
}

/** The engine's refusal, said to the person who asked. */
export function refusalMessage(refusal: VectorizeRefusal): string {
  switch (refusal) {
    case "not-an-image":
      return "The image is no longer on the board.";
    case "locked":
      return "The image is locked. Unlock it to vectorize it.";
    case "held":
      return "Someone else has the image selected.";
    case "empty":
      return "Nothing was traced. Try more detail.";
    case "malformed":
      return "The trace could not be read. Try again.";
    case "too-many-shapes":
      return `Too many shapes to edit — at most ${count(MAX_TRACE_SHAPES)} at once.`;
    case "board-full":
      return `The board would hold more than ${count(MAX_ELEMENTS_PER_BOARD)} elements. Insert it as one picture instead.`;
    case "not-a-picture":
      return "The picture could not be made. Try again.";
    case "too-large":
      return `The picture is over ${megabytes(MAX_IMAGE_DATA_URL_LENGTH)}. Try fewer colours.`;
  }
}

/** The stats line under the preview, for the way it would be inserted. */
export function statsLine(stats: TraceStats, as: InsertAs): string {
  if (as === "picture") {
    return `One picture · ${megabytes(pictureUrlLength(stats.svgBytes))} · ${count(stats.regions)} regions`;
  }
  return `${count(stats.shapes)} shapes · ${count(stats.points)} points`;
}

const PHASES: Record<TraceProgress["phase"], { label: string; from: number; to: number }> = {
  // Measured: finding the colours is 80–95% of a trace; see `TRACE_MAX_SIDE`.
  segment: { label: "Finding colours", from: 0, to: 0.8 },
  compose: { label: "Tracing outlines", from: 0.8, to: 0.9 },
  optimize: { label: "Smoothing curves", from: 0.9, to: 1 },
};

/** The whole trace's progress, 0–1, and what it is doing. */
export function overallProgress(progress: TraceProgress): { label: string; value: number } {
  const phase = PHASES[progress.phase];
  const fraction = Math.min(1, Math.max(0, progress.fraction));
  return { label: phase.label, value: phase.from + (phase.to - phase.from) * fraction };
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
