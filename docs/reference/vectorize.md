# Vectorize

Right-click one unlocked image → **Vectorize image…** traces the picture and puts the trace
where the image was, as either:

- **editable shapes** (the default) — every traced region a filled, closed line, all of them
  in one new group; or
- **one vector picture** — a single image element whose picture is the trace as an SVG,
  which stays sharp however far the board is zoomed.

Either way it is one engine call and one step of history: one undo takes the trace away
and gives the image back. Confidence markers as in the other references: **VERIFIED**
(pinned by a test named here), **MEASURED** (a number from the command in
[Performance](#performance)), **DESIGN** (a choice, with its reason).

## Where each part lives

| part                | where                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| the tracer          | `engine/crates/draw-trace` — its own WASM, `engine/pkg/draw_trace*`                    |
| its thread          | `engine/src/vectorize.worker.ts`, driven by `TraceWorker` in `engine/src/vectorize.ts` |
| the insert          | `engine/crates/draw-engine/src/engine/vectorize.rs`, bound in `wasm/vectorize_api.rs`  |
| the insert, from TS | `DrawEngine.vectorizeImage` (`engine/src/engine.ts`)                                   |
| presets, caps, copy | `apps/web/src/lib/draw-chrome/vectorize.ts`                                            |
| the dialog          | `VectorizeDialog.svelte`, opened from `DrawModals.svelte`                              |
| the menu entry      | `menu.ts` › `vectorizeId` (one selected, unlocked image), `DrawContextMenu.svelte`     |
| the benchmark       | `perf/vectorize/` — not a test, nothing gates on it                                    |

The boundary rule holds: the tracer runs in the browser, the server never sees anything
but the elements the insert makes.

## The tracer

**DESIGN** — `draw-trace` wraps the tracing core of the Univers42 fork of
[vtracer](https://github.com/Univers42/vtracer) (the `vtracer` crate only, no CLI or
bindings), taken as a **git dependency pinned to `b79628f`** rather than vendored: it does no
I/O, builds for `wasm32` as it is, and a pin means a push to the fork cannot change what a
board traces. It adds what the board needs on top: a clamped config the page may send
(`config.rs`, unknown fields refused), the rings an editable insert needs (`rings.rs`), and
the stats the dialog shows.

**DESIGN** — its own WASM module, never linked into `draw-engine`, loaded only inside the
worker. A board that never vectorizes never downloads it, and a trace — seconds of
clustering on a photo — cannot freeze the board. Cancel is `Worker.terminate()`; there is no
other way to stop a thread that is busy. The next trace opens a new worker over the bitmap
the dialog kept.

| module                | bytes                                                      |
| --------------------- | ---------------------------------------------------------- |
| `draw_engine_bg.wasm` | 1,355,882 → 1,374,621 (+18,739: the insert, no tracer)     |
| `draw_trace_bg.wasm`  | 459,661 (167.6 KB gzipped in the production build), lazily |

`scripts/wasm-build.sh` builds both crates and refuses to when either drifts from the
`wasm-bindgen` CLI pin; `docker/web.Dockerfile` checks both outputs are there. Vite serves
the worker from source in dev and emits it under `_app/immutable/workers/` in a production
build, with the tracer's WASM as an asset beside it — checked by hand against `vite preview`
(a 240 × 160 picture traced, inserted and painted, no page error), not by a gate.

**The pipeline.** The dialog decodes the element's `dataUrl`, brings it down to
`TRACE_MAX_SIDE` (1024 px) with `scaledToFit`, and hands the bitmap to the worker, which
reads its pixels through an `OffscreenCanvas` into a `TraceSession`. The session keeps the
clustering, so a dial that does not feed it (smoothness) re-renders without re-clustering.
Each render reports progress by phase — _segment_ ("Finding colours", 80% of the bar),
_compose_ ("Tracing outlines"), _optimize_ ("Smoothing curves"). A preset retraces at once;
a slider after 300 ms still, so a drag is one trace. Renders run one at a time and the newest
request replaces a queued one.

## Editable shapes

**DESIGN** — always **stacked** (`Hierarchical::Stacked`), whatever the preset: each colour
is painted whole over the ones below it, so each region is one element that still reads
correctly on its own. A cutout trace shares boundaries that would have to be split back
apart to become elements at all.

What the insert makes of each traced region, and why:

- **Curves flattened adaptively** to within 0.25 traced px (Fischer's bound on a cubic's
  distance from its chord), points rounded to hundredths, repeats dropped, ring closed —
  `flattening_stays_within_the_tolerance`, `rings_are_closed_small_enough_and_free_of_repeated_points`.
- **Holes.** vtracer's regions are filled by SVG's non-zero rule, holes wound the other way;
  a line element is one closed polyline. Colour layers come out solid when stacked, but
  line art traces only the dark parts, so the paper inside an `O` is a hole
  (`colour_layers_are_solid_but_line_art_keeps_its_holes`). Each hole goes to the smallest
  outer ring containing it and is **spliced in as a zero-width keyhole** — across, round the
  hole the other way, back along the same line — the splice `bucket_fill.rs` makes for a
  fill with islands. **VERIFIED** by painting both under either fill rule
  (`every_hole_is_spliced_so_the_rings_paint_what_the_trace_paints`,
  `the_hole_shows_what_was_under_it_in_the_source`).
- **One element per outer ring**, so a region in several pieces is several elements: the
  dialog counts _shapes_ (rings) for an editable insert and _regions_ for a picture.
- **Point cap.** A ring over `MAX_POINTS_PER_ELEMENT` (10,000) is simplified
  (Ramer–Douglas–Peucker) in `draw-trace` before its holes are spliced — the only order that
  keeps a keyhole zero-width — and the engine holds any ring it is handed to the same cap
  in board units, tolerance from 0.1 doubling until it fits
  (`a_ring_over_the_point_cap_is_simplified_to_fit`: 12,000 points on a radius-150 circle
  come back ≤ 10,000, every one within 0.02 of the circle).
- **The element** is what a bucket fill makes: a closed `line`, `backgroundColor` the
  region's colour, solid fill, roughness 0, `roundness: null`, the image's opacity
  (`every_ring_is_a_closed_filled_line_that_paints_like_the_trace`).
- **No stroke** (transparent, width 1). The regions are stacked, so the edges already are
  where the colours meet; a stroke would widen each region into the one above it and draw
  along every keyhole's bridge. vtracer's SVG has none either, so both modes look alike.
- **Placement.** All of the trace goes directly above the image in one run
  (`place_above`), in one new group added _inside_ the image's groups, in the image's frame,
  and is left selected (`the_trace_sits_directly_above_the_image_grouped_and_selected`,
  `the_trace_joins_the_image_s_groups_and_frame`). An image already 32 groups deep gets no
  new group rather than an element the contract refuses
  (`an_image_as_deep_in_groups_as_they_go_adds_no_group`).
- **The image goes** (a tombstone, as a delete makes) unless _Keep the original image_ is
  ticked — off by default, since a trace is asked for to replace a picture
  (`keeping_the_original_leaves_it_under_the_trace`).

## One vector picture

A clone of the image — same box, angle, mirror, groups, frame, opacity — with a new id,
`version` 1, and `dataUrl` = `data:image/svg+xml;base64,…` (the contract's `dataUrl` must be
base64; a `;utf8,` URL is refused as `not-a-picture`) — `a_picture_takes_the_image_s_place`.

**VERIFIED — sharp when zoomed, with no engine change.** Chromium redraws an SVG `<img>` at
the scale it is drawn, so the painter's `drawImage` stays crisp. `e2e/vectorize.spec.ts`
measures the anti-aliased ramp across the right edge of a traced square at 8× zoom: the
raster original's is 6 px wide (the spec requires > 4, so it would notice a blurry control),
the SVG's 0 px (required ≤ 3).

## Where the trace goes

The trace arrives as fractions of the traced picture (`0,0` top-left, `1,1` bottom-right),
so the engine never needs the size it was traced at. Each point is put through the same
transform the painter draws the image with — `T(centre)·R(angle)·S(mirror)·T(−local centre)`,
`wasm/paint.rs` › `element_matrix` — after scaling up to `|width| × |height|`; a negative
extent is a mirror. **VERIFIED** for a plain box, a turn of π/3, a horizontal flip, and a
negative height turned by 2.2 rad (`ci_vectorize.rs` › `the_trace_lands_on_the_image_s_box`,
`a_turned_…`, `a_flipped_…`, `a_flipped_and_turned_image_keeps_its_corners`).

## Refusals

The engine refuses and changes nothing; the dialog, still open, says why. It predicts the two it can from the stats alone (`insertBlocker`) and says which way to
go — Poster → "Try the Photo preset, or fewer colours", Photo → "fewer colours or less
detail", Line art → "less detail"; the engine has the last word on what only it knows.

| refusal           | when                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `not-an-image`    | no live image by that id                                                  |
| `locked`          | the image is locked                                                       |
| `held`            | a peer has it selected (`engine.setPeers`)                                |
| `too-many-shapes` | more than `MAX_TRACE_SHAPES` (5,000) rings                                |
| `malformed`       | lengths that do not add up, a non-finite number, a colour over `0xffffff` |
| `empty`           | nothing left with an inside                                               |
| `board-full`      | live − the image (unless kept) + new > `MAX_ELEMENTS_PER_BOARD` (20,000)  |
| `not-a-picture`   | a picture that is not a base64 SVG `data:` URL                            |
| `too-large`       | a picture over `MAX_IMAGE_DATA_URL_LENGTH` (6 MB)                         |

Each is a test in `ci_vectorize.rs`; their wording in `vectorize.test.ts`.

**DESIGN — the shape cap.** MEASURED: 4,530 shapes cost 79 ms for the frame they first
appear in and 8.5 ms a frame at 4× zoom; 6,983 cost 129 ms and 11.9 ms; 9,724 cost 182 ms
and 17 ms. Five thousand keeps a zoomed redraw under 10 ms.

## Presets

Three sliders set the tracer's dials: **Colours** 1–16 → `layerDifference = 8·(17−c)`,
**Detail** 1–16 → `filterSpeckle = 17−d`, **Smoothness** 0–12 → `cornerThreshold = 15·s`.
Line art has two colours, not layers, so its Colours slider is disabled.

| preset   | sends                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| Poster   | `colorPrecision 6, layerDifference 32, filterSpeckle 4, cornerThreshold 60`             |
| Photo    | `colorPrecision 6, layerDifference 48, filterSpeckle 10, cornerThreshold 180` (default) |
| Line art | `filterSpeckle 4, cornerThreshold 60` (binary clustering)                               |

**DESIGN, MEASURED** — tuned from vtracer's own. On the photo at 1024 px, 6 bits a channel
instead of 8 traces Poster in 1.5 s rather than 3.7 s and Photo in 1.1 s rather than 3.3 s,
for 4% and 1% more shapes; and vtracer's Poster (16 apart, 8 bits) makes 9,724 shapes where
32 apart makes 4,359 at 8 bits and 4,530 at 6. (Measured by setting `PRESETS` to the
tracer's values and re-running the benchmark.)

## Performance

**MEASURED** on an i5-13600KF (20 threads), in Playwright 1.63's headless Chromium, one run
each — variance was not measured, so read the last digit loosely. Traced in the worker,
inserted into an engine showing the image 1200 px wide at a 1280 × 800 viewport, frame times
the engine's own (`paintStats`: build + paint).

```sh
make wasm
git clone https://github.com/Univers42/vtracer third_party/vtracer
git -C third_party/vtracer checkout b79628fa0ff3c735638e4fe949783479a9f2f97a
mkdir -p third_party/trace-images
for f in angel-luciano-LATYeZyw88c-unsplash.jpg 'Cityscape Sunset_DFM3-01.jpg' K1_drawing.jpg; do
  cp "third_party/vtracer/docs/assets/samples/$f" third_party/trace-images/
done
docker run --rm --ipc=host -v "$PWD":/app -w /app -e TRACE_IMAGES=/app/third_party/trace-images \
  mcr.microsoft.com/playwright:v1.63.0-noble node perf/vectorize/run.mjs [longest side]
```

At 1024 px, the size the dialog traces at:

| picture               | preset   | trace   | shapes | points  | SVG     | shapes: insert · first frame · 4× | picture: insert · 4× |
| --------------------- | -------- | ------- | ------ | ------- | ------- | --------------------------------- | -------------------- |
| photo, 1024 × 683     | Poster   | 1450 ms | 4,530  | 122,535 | 1.67 MB | 9.0 · 78.8 · 8.5 ms               | 3.8 · 8.4 ms         |
|                       | Photo    | 1091 ms | 735    | 59,979  | 695 KB  | 2.7 · 29.4 · 5.3 ms               | 1.7 · 3.7 ms         |
|                       | Line art | 64 ms   | 297    | 11,637  | 181 KB  | 0.8 · 9.1 · 2.2 ms                | 0.5 · 1.6 ms         |
| cityscape, 1024 × 717 | Poster   | 234 ms  | 552    | 8,583   | 142 KB  | 4.3 · 11.8 · 2.0 ms               | 1.0 · 4.9 ms         |
|                       | Photo    | 189 ms  | 314    | 13,814  | 195 KB  | 1.0 · 9.3 · 1.6 ms                | 0.5 · 1.4 ms         |
|                       | Line art | 20 ms   | 107    | 3,278   | 47 KB   | 0.4 · 2.9 · 0.7 ms                | 0.1 · 0.9 ms         |
| drawing, 1024 × 410   | Poster   | 425 ms  | 2,251  | 53,297  | 835 KB  | 5.5 · 53.2 · 5.1 ms               | 1.9 · 8.4 ms         |
|                       | Photo    | 318 ms  | 552    | 53,196  | 713 KB  | 1.9 · 24.9 · 3.9 ms               | 1.7 · 3.8 ms         |
|                       | Line art | 40 ms   | 210    | 11,466  | 152 KB  | 0.6 · 8.1 · 1.5 ms                | 0.7 · 1.2 ms         |

At 1440 px (`run.mjs 1440`, the largest a board keeps a picture), the photo takes 2968 ms
with Poster (6,983 shapes, past the cap) and 2551 ms with Photo (1,149) — 2.0–2.3× the time
for 2× the pixels, which is why the dialog traces at 1024. Poster and Photo take 540 and
455 ms on the cityscape, 1175 and 943 ms on the drawing. A picture's first frame is not
reported: it can paint before the SVG has decoded.

## Tests

| suite                                             | what                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `engine/crates/draw-trace/tests/trace.rs`         | flattening, holes, caps, flat rings, stats (+ config unit tests) |
| `engine/crates/draw-engine/tests/ci_vectorize.rs` | mapping, elements, stacking, groups, history, every refusal      |
| `apps/web/.../vectorize.test.ts`, `menu.test.ts`  | presets, slider maps, caps, messages, the menu entry             |
| `e2e/vectorize.spec.ts`                           | both modes end to end, autosave, undo, the zoom sharpness        |

## Known limits

- **Arrows bound to the image are not bound to the trace.** The image is removed exactly
  as a delete removes it, and its arrows are left as a delete leaves them.
- **A stroke added to a traced shape shows its keyhole bridges**, the zero-width cuts that
  carry its holes. Traced shapes have none, and without one the cuts are invisible.
- **Only the context menu offers it**, for exactly one unlocked image; there is no inspector
  entry or shortcut.
- **`MAX_GROUP_DEPTH` is written twice**: the contract does not export it, so `vectorize.ts`
  repeats 32 and `vectorize.test.ts` pins the two together through the element schema.
- **A picture that has not arrived yet** (a peer's image whose bytes are still on their way)
  cannot be read; the dialog says so and offers to try again.
- **The board's window-level shortcuts** (Ctrl+S, Ctrl+O, N, …) still fire while the dialog
  has focus, as under the other dialogs in `DrawModals.svelte`.
- **Zoomed far past the size it was traced at**, an editable trace shows the facets of its
  flattened curves; the picture keeps the curves.
