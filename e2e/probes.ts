import type { Page } from "@playwright/test";

/**
 * Pixel measurements of a live canvas.
 *
 * Shared by the browser suite and by `tools/editor-inspector`, so there is exactly one
 * definition of "is there ink here". Two copies of a measurement is two thresholds that
 * drift, and then a spec and the tool you are debugging it with disagree about what they
 * are looking at.
 *
 * Pure: every function takes a `Page` and reads pixels. No assertions, no test-runner
 * context, so a standalone tool can import them.
 */

export function canvasInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const background = [data[0]!, data[1]!, data[2]!];
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i]! - background[0]!) > 12 ||
        Math.abs(data[i + 1]! - background[1]!) > 12 ||
        Math.abs(data[i + 2]! - background[2]!) > 12
      ) {
        ink += 1;
      }
    }
    return ink / (width * height);
  });
}

/**
 * How much ink is inside one region, as a fraction of that region's pixels.
 *
 * `canvasInk` answers the same question about the whole canvas, which is too blunt for
 * chrome: a selection frame is a one-pixel outline around a shape that is itself already
 * drawn, so it moves the whole-canvas number by a fraction of a percent and any threshold
 * that could see it would also see antialiasing move. Pointed at a patch that should be
 * *empty* unless the chrome is there, the same measurement becomes decisive.
 *
 * Canvas-relative CSS pixels, converted to the backing store here, so a caller can name
 * the box it is asking about without knowing the device pixel ratio.
 */
export function regionInk(
  page: Page,
  region: { left: number; top: number; right: number; bottom: number },
): Promise<number> {
  return page.evaluate((area) => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const box = canvas.getBoundingClientRect();
    const scaleX = canvas.width / box.width;
    const scaleY = canvas.height / box.height;
    const x0 = Math.round(area.left * scaleX);
    const y0 = Math.round(area.top * scaleY);
    const w = Math.round((area.right - area.left) * scaleX);
    const h = Math.round((area.bottom - area.top) * scaleY);
    if (w <= 0 || h <= 0) throw new Error("empty region");

    // The same background reference the other two use: the canvas corner, which is off
    // the drawing, so it holds in either theme.
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    const { data } = ctx.getImageData(x0, y0, w, h);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i]! - corner[0]!) > 12 ||
        Math.abs(data[i + 1]! - corner[1]!) > 12 ||
        Math.abs(data[i + 2]! - corner[2]!) > 12
      ) {
        ink += 1;
      }
    }
    return ink / (w * h);
  }, region);
}

/**
 * Where the ink inside a region sits horizontally, as a fraction across it.
 *
 * `canvasInk` answers "is anything there", which alignment cannot use: moving text from
 * one side of a shape to the other changes no pixel *count* at all. This answers "where",
 * as a centre of mass — 0 is hard against the left edge of the region, 1 the right.
 *
 * The region is canvas-relative CSS pixels and is converted to the backing store here, so
 * a caller can name the box it drew without knowing the device pixel ratio. Returns `NaN`
 * when the region holds no ink, which is a louder failure than a plausible 0.5.
 */
export function inkCentroidX(
  page: Page,
  region: { left: number; top: number; right: number; bottom: number },
): Promise<number> {
  return page.evaluate((area) => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const box = canvas.getBoundingClientRect();
    const scaleX = canvas.width / box.width;
    const scaleY = canvas.height / box.height;
    const x0 = Math.round(area.left * scaleX);
    const y0 = Math.round(area.top * scaleY);
    const w = Math.round((area.right - area.left) * scaleX);
    const h = Math.round((area.bottom - area.top) * scaleY);

    // The same background reference `canvasInk` uses: the top-left of the whole canvas,
    // which is off the drawing, so it holds in either theme.
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    const { data } = ctx.getImageData(x0, y0, w, h);
    let weighted = 0;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i]! - corner[0]!) > 12 ||
        Math.abs(data[i + 1]! - corner[1]!) > 12 ||
        Math.abs(data[i + 2]! - corner[2]!) > 12
      ) {
        weighted += (i / 4) % w;
        ink += 1;
      }
    }
    return ink === 0 ? Number.NaN : weighted / ink / w;
  }, region);
}

/**
 * How much *coloured* ink is inside a region, as a fraction of its pixels.
 *
 * `regionInk` counts anything that is not paper, which cannot tell selection chrome from
 * the shape under it once the two share a line — and tracing a shape is exactly that. The
 * default ink is a near-black grey and the paper white or near-black, all with next to no
 * chroma, while the selection colour is a strong violet in either theme; so pixels whose
 * channels spread wide are the chrome and nothing else.
 *
 * Canvas-relative CSS pixels, as `regionInk`.
 */
export function chromaInk(
  page: Page,
  region: { left: number; top: number; right: number; bottom: number },
): Promise<number> {
  return page.evaluate((area) => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const box = canvas.getBoundingClientRect();
    const scaleX = canvas.width / box.width;
    const scaleY = canvas.height / box.height;
    const x0 = Math.round(area.left * scaleX);
    const y0 = Math.round(area.top * scaleY);
    const w = Math.round((area.right - area.left) * scaleX);
    const h = Math.round((area.bottom - area.top) * scaleY);
    if (w <= 0 || h <= 0) throw new Error("empty region");
    const { data } = ctx.getImageData(x0, y0, w, h);
    let coloured = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) coloured += 1;
    }
    return coloured / (w * h);
  }, region);
}
