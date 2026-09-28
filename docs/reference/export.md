# Export

Confidence markers: **OBSERVED** (measured in the running editor), **VERIFIED** (read and
measured), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

The oracle is Excalidraw at `1118751f`. Everything below cites
`packages/excalidraw/scene/export.ts@1118751f` unless it says otherwise.

## The four numbers a PNG export is

**VERIFIED.** A whole-scene PNG is four numbers and nothing else, and all four live in the
engine (`crates/draw-engine/src/export/png.rs`, `ExportFrame`). The front asks for two of
them — a scale and whether there is a background — and is handed a **`Blob`**, not bytes.

**How the pixels get there, and what it costs 4.4.** The browser's canvas is the only
rasteriser here, and it has to be: a PNG encoder written in Rust is a new dependency, and
§3.2's library-first rule says no. So the engine makes an offscreen canvas, paints into it,
and hands _that_ to `canvas.toBlob`, resolving a promise with the `Blob` the browser builds
(`wasm/export.rs:48-66`). The front then does nothing but save it or hand it on — the
clipboard 4.3 wants is a browser API the front is allowed, so `Blob` → `ClipboardItem`
needs no engine change at all.

The consequence for **4.4** is worth writing down here rather than discovering halfway
through it: a `toBlob` result cannot be modified, so the `tEXt` chunk holding the scene JSON
cannot be added to _this_ Blob. 4.4 needs a different hand-off — `toDataURL`, whose base64
the engine can read, parse the chunk table of, and re-emit.

| number            | where it comes from                                     | oracle                       |
| ----------------- | ------------------------------------------------------- | ---------------------------- |
| the scene's box   | `getCommonBounds` over `getRootElements`                | `export.ts:232-235, 566-575` |
| the padding       | `DEFAULT_EXPORT_PADDING = 10`, added to every side      | `constants.ts:398`           |
| the backing store | `trunc(padded dimension × scale)`, as **device** pixels | `export.ts:199-203, 582-584` |
| the camera        | `scrollX = -minX + exportPadding` at `zoom: 1`          | `export.ts:264-266`          |

The two easy mistakes, both of which were available:

- **The scale is not a device pixel ratio.** The oracle multiplies the canvas by
  `exportScale` and hands _that same number_ to the renderer as the scale it draws at
  (`export.ts:199-203, 259`), leaving `zoom` at its default. On this engine those are two
  different fields — `PaintView::dpr` and `PaintView::camera.scale` — so the scale is the
  **dpr** and the camera stays at 1. Putting it in the camera instead would have scaled
  the _layout_ and drawn the scene at 1×, which is the same bug wearing a different hat.
- **The backing store truncates.** `Math.trunc(dimension * scale)`
  (`export.ts:582-584`), not `round`: 220.5 px at 1× is a 220-pixel canvas. The oracle's
  own test says why in as many words — "canvas truncates dimensions to integers"
  (`packages/excalidraw/tests/scene/export.test.ts@1118751f:367-371`).

## Bounds are what the elements _draw_

**VERIFIED.** `getCommonBounds` (`packages/element/src/bounds.ts@1118751f:1005-1029`)
folds `getElementBounds` over the elements, and for a rectangle that is its **four turned
corners** (`bounds.ts:210-235`) — so a square turned 45° is measured by the diamond it
becomes, and a framing built from stored boxes would crop its corners off. This engine's
`scene_outline_bounds` is that function; `scene_bounds`, which the SVG export still uses,
is the _unrotated_ union and is the wrong shape here.

The bounds are measured over **`getRootElements`** (`frame.ts:271-281`): an element inside
a frame does not widen the export, because the frame's own box already contains the region
it is a window onto. A child poking out past its frame's edge is **cropped** — which is
what the oracle does, and `what_is_inside_a_frame_does_not_widen_the_export` pins it.

## Transparent means nothing was painted

**VERIFIED.** Not a white fill and not a transparent-coloured fill: the oracle passes
`viewBackgroundColor: null` when `exportBackground` is false (`export.ts:263`), and
`bootstrapCanvas` skips its whole paint-the-background block unless that value is a
string (`renderer/helpers.ts:96-107`). A fresh canvas is already fully transparent, so
leaving it alone _is_ the feature. Here that is the `background: bool` parameter on
`paint_static` (`wasm/paint.rs`): skip the fill. The `clear_rect` above it still runs, and
that is deliberate rather than a divergence — on a canvas that was just made the clear is a
no-op, and the oracle clears too for any background it is not certain is opaque
(`helpers.ts:105-107`).

## The edge cases, and what each is worth

| scene                  | export at 1×           | why                                                                                                                                                                  |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| empty                  | 20 × 20                | `getCommonBounds` answers `[0,0,0,0]` for no elements (`bounds.ts:1009-1011`), so the width is the padding twice over. A zero-sized canvas cannot be encoded at all. |
| one element            | its box + 20           | no special case, and the oracle has none either                                                                                                                      |
| a zero-width rectangle | 20 × (its height + 20) | same sum over whatever the bounds came out as (`export.ts:571-572`)                                                                                                  |
| everything in a frame  | the frames' box + 20   | `getRootElements`; see above                                                                                                                                         |

## One options struct, and what it does not yet reach

**IMPLEMENTATION DETAIL.** `ExportOptions` (`export/png.rs`) is the one thing an export is
asked: `padding`, `scale`, `background`, `frame_labels`. The oracle asks the same four
questions of a canvas and an SVG under the same names, so the type exists once and both
formats will read it.

**What it does not reach: `scene_to_svg`.** That still takes a bare `padding: f64` and
always draws its `<rect>`, and moving it is 4.5's — it changes the SVG export's output and
`ci_export.rs`'s pinned widths. Until then this struct is the PNG path's, and a reader
should assume the SVG path has not been converted. What 4.1 did do is put the struct in
`export/` rather than in the painter, so 4.2 and 4.5 add fields to it instead of inventing
a second one.

**`frame_labels` is the one field the PNG path honours and nothing plumbs yet.** The
painter reads it off the frame, and `ci_export_png.rs` pins both settings. It is not a
parameter of the `exportPng` binding on purpose: its only consumer is the painter, and the
format that would let a person choose it is 4.5's. **The two formats disagree today** — a
PNG draws a frame's name, and `scene_to_svg` draws none at all, where the oracle adds the
label to both (`export.ts:169-172`). That disagreement is 4.5's to close; what 4.1 owes
4.5 is the flag, and the flag is there.

## The scale the dialog starts on is 2×, and the oracle's is the device's

**DIVERGENCE, deliberate.** The oracle's default is
`EXPORT_SCALES.includes(devicePixelRatio) ? devicePixelRatio : 1`
(`appState.ts@1118751f:20-22`), so on a dpr-1 machine its export dialog starts at **1×** and
ours starts at **2×** (`DrawExportModal.svelte`). Which chips to offer is chrome and stays
in the front; the engine takes whatever number it is given and does not clamp it
(`ci_export_png.rs`, "a scale is taken as given").

Reading `devicePixelRatio` in the front to fix this would be the worse law-3 violation: the
engine's own default is 1 (`ExportOptions::default`), and on a dpr-1 machine that is exactly
what the oracle's expression answers. The disagreement is on a dpr-2 machine, where the
oracle would also pick 2 and the chips look the same. Recorded here because the registry's
`Scale` line reads as a flat `covered` and would not tell the next agent.

## Where the two exports disagree on padding, and who owns it

**IMPLEMENTATION DETAIL, and a law-3 smell left in place on purpose.** `export_svg` takes
its padding from the host, which passes `16` (`engine/src/engine.ts:918`), while the PNG
export uses the oracle's `10` (`export/png.rs:18`). They are 6px apart per side. The PNG
side follows the oracle because the PNG path is this task's; the SVG side was not touched.

That `16` is a number the _front_ chose about an export, which §2 does not allow, and it is
written in two places: the dialog passes one and the host's wrapper defaults to the other.
Changing either changes the SVG export's output and its tests, which is 4.5's business.

**It is not just a note.** `exportParity.test.ts` names both sites in
`KNOWN_FRONT_NUMBERS` with 4.5 as the owner, skips exactly those two, and fails on a
third. So the debt is a ratchet rather than a sentence in a page nobody re-reads — the
window it reads is two statements wide, which is how it reaches the wrapper's default at
all.

## What is not here yet

Phase 4's other export tasks, and what each would need:

- **4.2, the selection or one frame.** The seam is open and tested: `ExportFrame::for_bounds`
  takes bounds rather than elements, and `DrawEngine::export_view_of` takes the subset to
  paint, so 4.2 hands over elements and a box instead of writing a second framing path.
  The frame export passes `exportPadding = 0` (`export.ts:228-230`). What is missing is the
  selection, and a `only` field on `ExportOptions` if it is to reach both formats.
- **4.3, the clipboard.** `exportPng` resolves a `Blob` and stops. The clipboard is the
  host's (§2), so this needs a menu entry and nothing in the engine changes.
- **4.4, the round trip.** A `tEXt` chunk holding the scene JSON. Not started, and it needs
  a different hand-off than 4.1's — see above, the `Blob` a `toBlob` returns cannot be
  modified.
- **4.5, background and theme.** A _chosen_ background colour. Today the export paints
  `view.theme.background` or nothing; there is no option anywhere that picks one, for
  either format.
- **4.6, fonts.** `export/svg.rs` names the families and embeds no `@font-face`.

## Where the tests are

- `crates/draw-engine/tests/ci_export_png.rs` — the four numbers, and the edge cases, as
  arithmetic derived from the lines above. Natively; no browser needed.
- `apps/web/src/lib/draw-chrome/exportParity.test.ts` — that the front holds none of it.
- `e2e/exportPng.spec.ts` — that the numbers reach the pixels: the real dialog, the real
  chips, the downloaded file's own IHDR for the size, its own corner pixel for the
  background, and its own middle pixel for the scale — a 3x export that is a 3x canvas
  holding a 1x drawing has the right IHDR and a blank middle, and nothing in Rust can see
  the difference.
