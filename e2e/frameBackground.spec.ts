import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { chromaInk, openBoard, regionInk } from "./board.ts";

/**
 * A frame's `backgroundColor` — Excalidraw parity for the oracle's frame case
 * (`renderElement.ts@1118751f:1022-1058`): it never reads `backgroundColor` at all,
 * painting only a constant translucent highlight (`rgba(0, 0, 200, 0.04)`) when frame
 * outlines are shown. `hasBackground` (`element/src/comparisons.ts@1118751f:3-14`) leaves
 * `frame` out on purpose, and there is no panel row or action that offers one.
 *
 * Reported: giving a frame a background painted a fill that bled past the frame's own
 * border. Root cause was `render/opts.rs`'s `generate_rough_options`, which grouped
 * `Frame` with `Rectangle`/`Image`/`Embed` and set `options.filled` from
 * `backgroundColor` — so a frame took a real rough fill: a solid fill is drawn as a
 * second, independently sketchy polygon around the same four corners the outline is, not
 * a clip of it, and the two disagree by a few pixels along the middle of each edge.
 *
 * Fixed by making ours agree with the oracle exactly: a frame never fills, whatever
 * `backgroundColor` holds — not "clipped to the frame's rectangle", genuinely nothing,
 * because that is what the oracle paints. `backgroundColor` can still end up stored on a
 * frame element (a multi-selection with a fillable element leaks it, in the oracle too —
 * `changeProperty`/`getColorUpdate` apply a background pick to every selected element
 * with no `hasBackground` gate of their own), so this scene loads one directly rather
 * than reaching it through the panel, which already refuses to offer the control for a
 * frame-only selection.
 */

const FRAME = { x: 500, y: 250, w: 300, h: 200 };

/** Well inside the frame, clear of every edge. */
const INSIDE = {
  left: FRAME.x + 60,
  top: FRAME.y + 60,
  right: FRAME.x + FRAME.w - 60,
  bottom: FRAME.y + FRAME.h - 60,
};

/** Just past the frame's bottom edge — inside the frame's own rectangle nowhere. */
const BELOW = {
  left: FRAME.x + 10,
  top: FRAME.y + FRAME.h + 2,
  right: FRAME.x + FRAME.w - 10,
  bottom: FRAME.y + FRAME.h + 20,
};

/** Just past its right edge. */
const RIGHT_OF = {
  left: FRAME.x + FRAME.w + 2,
  top: FRAME.y + 10,
  right: FRAME.x + FRAME.w + 20,
  bottom: FRAME.y + FRAME.h - 10,
};

async function loadFrameWithBackground(page: Page): Promise<void> {
  await page.evaluate((frame) => {
    window.__drawEngine!.loadScene(
      JSON.stringify({
        type: "osidraw",
        version: 1,
        source: "e2e",
        elements: [
          {
            id: "F",
            type: "frame",
            name: "Frame 1",
            x: frame.x,
            y: frame.y,
            width: frame.w,
            height: frame.h,
            angle: 0,
            strokeColor: "#1e1e1e",
            // A strong, saturated red — unmistakable from the near-grey border and the
            // white paper `chromaInk` is built to tell apart from real colour.
            backgroundColor: "#e03131",
            fillStyle: "solid",
            strokeWidth: 2,
            strokeStyle: "solid",
            // The default sloppiness real elements get (`ROUGHNESS_ARTIST`,
            // `render/opts.rs`); zero would leave the fill polygon's edges exact and
            // hide the very overflow this spec exists to catch.
            roughness: 1,
            opacity: 100,
            roundness: null,
            seed: 12345,
            version: 1,
            versionNonce: 1,
            updated: 0,
            isDeleted: false,
          },
        ],
      }),
    );
  }, FRAME);
}

/** Spans the frame plus a margin either side of every edge: whatever the frame paints,
 *  border or fill, lands somewhere in here. */
const AROUND_FRAME = {
  left: FRAME.x - 4,
  top: FRAME.y - 4,
  right: FRAME.x + FRAME.w + 4,
  bottom: FRAME.y + FRAME.h + 4,
};

test("a frame's background never paints past its own border", async ({ page }) => {
  const board = await openBoard(page);
  await loadFrameWithBackground(board.page);

  // `loadScene` triggers a repaint the page has not necessarily finished by the time the
  // pixels below are read — wait until the frame has actually landed on the canvas
  // (its border, at the least) before reading the colour checks that follow, or a slow
  // frame reads as an empty canvas and a fast one as a false pass.
  await expect.poll(() => regionInk(page, AROUND_FRAME)).toBeGreaterThan(0);

  // Nothing red anywhere near the frame: the oracle's frame case never reads
  // `backgroundColor`, so ours must not paint it either — not outside the rectangle, and
  // not clipped inside it — leaving only the frame's own border.
  expect(
    await chromaInk(page, INSIDE),
    "no fill inside the frame either — the oracle paints none",
  ).toBe(0);
  expect(await chromaInk(page, BELOW), "the background must not bleed past the bottom edge").toBe(
    0,
  );
  expect(await chromaInk(page, RIGHT_OF), "nor past the right edge").toBe(0);
});
