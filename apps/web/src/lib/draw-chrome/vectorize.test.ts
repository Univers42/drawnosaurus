import { describe, expect, it } from "vitest";
import {
  MAX_ELEMENTS_PER_BOARD,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_POINTS_PER_ELEMENT,
  drawElementSchema,
} from "@drawnosaurus/contract";
import type { TraceStats, VectorizeRefusal } from "@osionos/draw-engine/vectorize";
import {
  DIAL_RANGE,
  MAX_GROUP_DEPTH,
  MAX_TRACE_SHAPES,
  PRESETS,
  VECTORIZE_LIMITS,
  cornerThreshold,
  dialApplies,
  filterSpeckle,
  insertBlocker,
  layerDifference,
  overallProgress,
  pictureUrlLength,
  presetChoice,
  refusalMessage,
  statsLine,
  traceConfig,
} from "./vectorize.ts";

const stats = (over: Partial<TraceStats> = {}): TraceStats => ({
  shapes: 120,
  regions: 100,
  points: 4_000,
  svgBytes: 50_000,
  width: 800,
  height: 600,
  ...over,
});

describe("presets", () => {
  it("start the sliders where they reproduce the tuned configuration", () => {
    // What was measured (docs/reference/vectorize.md) is what the dialog asks for.
    expect(traceConfig("poster", presetChoice("poster").dials)).toEqual({
      preset: "poster",
      colorPrecision: 6,
      layerDifference: 32,
      filterSpeckle: 4,
      cornerThreshold: 60,
    });
    expect(traceConfig("photo", presetChoice("photo").dials)).toEqual({
      preset: "photo",
      colorPrecision: 6,
      layerDifference: 48,
      filterSpeckle: 10,
      cornerThreshold: 180,
    });
    // Line art is two colours, so it has no layers to tell apart.
    expect(traceConfig("bw", presetChoice("bw").dials)).toEqual({
      preset: "bw",
      filterSpeckle: 4,
      cornerThreshold: 60,
    });
  });

  it("keep every dial inside its slider", () => {
    for (const choice of PRESETS) {
      for (const [dial, value] of Object.entries(choice.dials)) {
        const range = DIAL_RANGE[dial as keyof typeof DIAL_RANGE];
        expect(value).toBeGreaterThanOrEqual(range.min);
        expect(value).toBeLessThanOrEqual(range.max);
      }
    }
  });

  it("only offer the colours slider where there are colours", () => {
    expect(dialApplies("bw", "colours")).toBe(false);
    expect(dialApplies("bw", "detail")).toBe(true);
    expect(dialApplies("photo", "colours")).toBe(true);
  });
});

describe("slider mappings", () => {
  it("more colours means layers closer together", () => {
    expect(layerDifference(16)).toBe(8);
    expect(layerDifference(1)).toBe(128);
    expect(layerDifference(12)).toBeLessThan(layerDifference(11));
  });

  it("more detail keeps smaller specks", () => {
    expect(filterSpeckle(16)).toBe(1);
    expect(filterSpeckle(1)).toBe(16);
  });

  it("more smoothness rounds off more corners, up to all of them", () => {
    expect(cornerThreshold(0)).toBe(0);
    expect(cornerThreshold(12)).toBe(180);
  });

  it("clamp and round what a slider could not have produced", () => {
    expect(layerDifference(99)).toBe(8);
    expect(filterSpeckle(-4)).toBe(16);
    expect(cornerThreshold(3.6)).toBe(60);
    // Every value stays inside what the tracer accepts (`config.rs`).
    for (let v = -5; v <= 20; v += 1) {
      expect(layerDifference(v)).toBeGreaterThanOrEqual(0);
      expect(layerDifference(v)).toBeLessThanOrEqual(255);
      expect(filterSpeckle(v)).toBeLessThanOrEqual(128);
      expect(cornerThreshold(v)).toBeLessThanOrEqual(180);
    }
  });
});

describe("limits", () => {
  it("are the contract's", () => {
    expect(VECTORIZE_LIMITS).toEqual({
      maxElements: MAX_ELEMENTS_PER_BOARD,
      maxPointsPerElement: MAX_POINTS_PER_ELEMENT,
      maxTraceShapes: MAX_TRACE_SHAPES,
      maxDataUrlLength: MAX_IMAGE_DATA_URL_LENGTH,
      maxGroupDepth: MAX_GROUP_DEPTH,
    });
  });

  it("nest groups exactly as deep as the contract lets an element be saved", () => {
    const element = (depth: number) => ({
      id: "a",
      type: "line",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "#c83c3c",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      updated: 0,
      isDeleted: false,
      groupIds: Array.from({ length: depth }, (_, i) => `g${i}`),
    });
    expect(drawElementSchema.safeParse(element(MAX_GROUP_DEPTH)).success).toBe(true);
    expect(drawElementSchema.safeParse(element(MAX_GROUP_DEPTH + 1)).success).toBe(false);
  });

  it("measure a picture's URL as base64 makes it", () => {
    expect(pictureUrlLength(3)).toBe("data:image/svg+xml;base64,".length + 4);
    expect(pictureUrlLength(4)).toBe("data:image/svg+xml;base64,".length + 8);
    const svg = "<svg>é</svg>";
    const bytes = new TextEncoder().encode(svg);
    const url = `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
    expect(pictureUrlLength(bytes.length)).toBe(url.length);
  });
});

describe("insertBlocker", () => {
  it("lets a trace within the caps through", () => {
    expect(insertBlocker(stats(), "shapes", "photo")).toBeNull();
    expect(insertBlocker(stats(), "picture", "photo")).toBeNull();
    expect(insertBlocker(stats({ shapes: MAX_TRACE_SHAPES }), "shapes", "poster")).toBeNull();
  });

  it("names the count and a coarser way when there are too many shapes to edit", () => {
    const message = insertBlocker(stats({ shapes: 6_538 }), "shapes", "poster");
    expect(message).toContain("6,538 shapes");
    expect(message).toContain("5,000");
    expect(message).toContain("Photo preset");
    expect(insertBlocker(stats({ shapes: 6_538 }), "shapes", "photo")).toContain("fewer colours");
    // The same trace is fine as one picture.
    expect(insertBlocker(stats({ shapes: 6_538 }), "picture", "poster")).toBeNull();
  });

  it("refuses a picture over the size a picture may be", () => {
    // Three bytes become four: 4.6 MB of SVG is just over the 6 MB a picture may be.
    const justOver = Math.ceil(((MAX_IMAGE_DATA_URL_LENGTH - 26) * 3) / 4) + 1;
    expect(insertBlocker(stats({ svgBytes: justOver - 3 }), "picture", "photo")).toBeNull();
    expect(insertBlocker(stats({ svgBytes: justOver }), "picture", "photo")).not.toBeNull();
    const tooBig = stats({ svgBytes: 5_000_000 });
    expect(insertBlocker(tooBig, "picture", "photo")).toMatch(/would be 6\.4 MB — at most 6\.0 MB/);
    expect(insertBlocker(tooBig, "shapes", "photo")).toBeNull();
  });

  it("refuses an empty trace either way", () => {
    expect(insertBlocker(stats({ shapes: 0 }), "shapes", "bw")).toMatch(/Nothing was traced/);
    expect(insertBlocker(stats({ shapes: 0 }), "picture", "bw")).toMatch(/Nothing was traced/);
  });
});

describe("messages", () => {
  it("say something for every refusal the engine can make", () => {
    const refusals: VectorizeRefusal[] = [
      "not-an-image",
      "locked",
      "held",
      "empty",
      "malformed",
      "too-many-shapes",
      "board-full",
      "not-a-picture",
      "too-large",
    ];
    const messages = refusals.map(refusalMessage);
    expect(new Set(messages).size).toBe(refusals.length);
    expect(refusalMessage("board-full")).toContain("20,000");
  });

  it("count what each way of inserting costs", () => {
    expect(statsLine(stats({ shapes: 3_145, points: 86_173 }), "shapes")).toBe(
      "3,145 shapes · 86,173 points",
    );
    expect(statsLine(stats({ svgBytes: 1_192_688, regions: 3_123 }), "picture")).toBe(
      "One picture · 1.5 MB · 3,123 regions",
    );
  });

  it("report progress across the whole trace, in order", () => {
    expect(overallProgress({ phase: "segment", fraction: 0 })).toEqual({
      label: "Finding colours",
      value: 0,
    });
    expect(overallProgress({ phase: "segment", fraction: 1 }).value).toBeCloseTo(0.8);
    expect(overallProgress({ phase: "compose", fraction: 0.5 }).value).toBeCloseTo(0.85);
    expect(overallProgress({ phase: "optimize", fraction: 2 }).value).toBe(1);
  });
});
