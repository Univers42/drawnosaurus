/**
 * The Vectorize dialog's path, timed: the picture brought down to the size it is traced
 * at, traced in the real worker with each preset as the dialog sends it, then inserted
 * both ways into an engine and painted. `run.mjs` serves this page and prints the result.
 *
 * Frame times are the engine's own (`paintStats`: building and painting the scene), not
 * the rAF interval, which is the display's cadence plus everything else on the page.
 */
import initEngine, { DrawEngine } from "../../engine/pkg/draw_engine.js";
import { TraceWorker, svgDataUrl } from "../../engine/src/vectorize.ts";
import { scaledToFit } from "../../apps/web/src/lib/draw-chrome/imageFile.ts";
import {
  PRESETS,
  TRACE_MAX_SIDE,
  VECTORIZE_LIMITS,
  traceConfig,
} from "../../apps/web/src/lib/draw-chrome/vectorize.ts";

const VIEW = { width: 1280, height: 800 };
// Past the dialog's shape cap on purpose: what a trace over it would cost is what the cap
// is chosen from.
const options = JSON.stringify({
  keepOriginal: false,
  limits: { ...VECTORIZE_LIMITS, maxTraceShapes: 1_000_000 },
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The engine's time for the frame after the next one, in ms. */
async function frameMs(engine) {
  await frame();
  await frame();
  const stats = JSON.parse(engine.paintStats());
  return stats.buildMs + stats.paintMs;
}

/** An engine showing one image, 1200 wide, as `vectorizeImage` finds it on a board. */
async function boardWith(src, bitmap) {
  const engine = new DrawEngine(document.getElementById("board"));
  engine.setViewport(VIEW.width, VIEW.height, 1);
  const image = {
    id: "img",
    type: "image",
    x: 40,
    y: 40,
    width: 1200,
    height: (1200 * bitmap.height) / bitmap.width,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
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
    groupIds: [],
    dataUrl: src,
  };
  engine.setSceneJson(JSON.stringify({ type: "osidraw", version: 1, elements: [image] }));
  await frameMs(engine);
  return engine;
}

/** Inserts `trace` one way, then times a frame as inserted and one zoomed in 4×. */
async function insert(src, bitmap, trace, as) {
  const engine = await boardWith(src, bitmap);
  const dataUrl = as === "picture" ? svgDataUrl(trace.svg) : null;
  const started = performance.now();
  const outcome = dataUrl
    ? engine.vectorizeToPicture("img", dataUrl, options)
    : engine.vectorizeToShapes(
        "img",
        trace.rings.colours,
        trace.rings.lengths,
        trace.rings.coords,
        options,
      );
  const insertMs = performance.now() - started;
  engine.clearSelection();
  // A picture's first frame may paint before its SVG has decoded, so only a shape
  // insert's is reported; the zoomed frame is taken once the picture has had time.
  const firstFrameMs = await frameMs(engine);
  await pause(500);
  engine.zoomAt(VIEW.width / 2, VIEW.height / 2, 4);
  const zoomedFrameMs = await frameMs(engine);
  engine.destroy();
  const refused = JSON.parse(outcome).refused;
  return { insertMs, ...(dataUrl ? {} : { firstFrameMs }), zoomedFrameMs, refused };
}

window.bench = async (src, side = TRACE_MAX_SIDE) => {
  await initEngine();
  const image = new Image();
  image.src = src;
  await image.decode();
  const size = scaledToFit(image.naturalWidth, image.naturalHeight, side);
  const bitmap = await createImageBitmap(image, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: "high",
  });
  let phases = {};
  let phase = null;
  let since = 0;
  const tracer = await TraceWorker.open(bitmap, (progress) => {
    if (progress.phase === phase) return;
    const now = performance.now();
    if (phase) phases[phase] = now - since;
    phase = progress.phase;
    since = now;
  });
  const runs = [];
  for (const choice of PRESETS) {
    phases = {};
    phase = null;
    const config = traceConfig(choice.preset, choice.dials);
    const started = performance.now();
    const result = await tracer.render(config);
    const traceMs = performance.now() - started;
    if (phase) phases[phase] = performance.now() - since;
    const trace = { svg: result.svg, rings: await tracer.rings() };
    runs.push({
      preset: choice.label,
      config,
      traceMs,
      phases,
      stats: result.stats,
      shapes: await insert(src, bitmap, trace, "shapes"),
      picture: await insert(src, bitmap, trace, "picture"),
    });
  }
  tracer.terminate();
  return { src, width: bitmap.width, height: bitmap.height, runs };
};
window.ready = true;
