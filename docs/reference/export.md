# Export

Confidence markers: **OBSERVED** (measured in the running editor), **VERIFIED** (read and
measured), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

The oracle is Excalidraw at `1118751f`. Everything below cites
`packages/excalidraw/scene/export.ts@1118751f` unless it says otherwise.

## The four numbers a PNG export is

**VERIFIED.** A whole-scene PNG is four numbers and nothing else, and all four live in the
engine (`crates/draw-engine/src/export/png.rs`, `ExportFrame`). The front asks for two of
them — a scale and whether there is a background — and is given bytes.

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
  (`export.test.ts:367-371`).

## Bounds are what the elements _draw_

**VERIFIED.** `getCommonBounds` (`packages/element/src/bounds.ts@1118751f:1005-1027`)
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
`paint_static` (`wasm/paint.rs`): skip both the clear and the fill.

## The edge cases, and what each is worth

| scene                  | export at 1×           | why                                                                                                                                                                  |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| empty                  | 20 × 20                | `getCommonBounds` answers `[0,0,0,0]` for no elements (`bounds.ts:1009-1011`), so the width is the padding twice over. A zero-sized canvas cannot be encoded at all. |
| one element            | its box + 20           | no special case, and the oracle has none either                                                                                                                      |
| a zero-width rectangle | 20 × (its height + 20) | same sum over whatever the bounds came out as (`export.ts:571-572`)                                                                                                  |
| everything in a frame  | the frames' box + 20   | `getRootElements`; see above                                                                                                                                         |

## Where the two exports disagree, and why only one is fixed

**IMPLEMENTATION DETAIL.** `export_svg` takes its padding from the host, which passes
`16` (`engine/src/engine.ts`), while the PNG export uses the oracle's `10`. They are 6px
apart per side. The PNG side follows the oracle because the PNG path is this task's; the
SVG side was not touched, and `DrawExportModal.svelte` still calls `exportSvg(16)`.

**A law-3 smell left in place on purpose:** that `16` is a number the _front_ chose about
an export, which §2 does not allow. Changing it means changing the SVG export's output and
its tests, which is 4.5's business. `exportParity.test.ts` deliberately scans `exportPng`
lines and not `exportSvg` lines, so it does not trip over the thing it is reporting.

## What is not here yet

Phase 4's other export tasks, and what each would need:

- **4.2, the selection or one frame.** `ExportFrame::for_scene` takes an element list and
  a padding, and the frame export passes `exportPadding = 0` (`export.ts:228-230`), so the
  seam is already the right shape. What is missing is threading the selection through.
- **4.3, the clipboard.** `exportPng` resolves a `Blob` and stops. The clipboard is the
  host's (§2), so this needs a menu entry and nothing in the engine changes.
- **4.4, the round trip.** A `tEXt` chunk holding the scene JSON. Not started.
- **4.5, background and theme.** A _chosen_ background colour. Today the export paints
  `view.theme.background` or nothing; there is no option anywhere that picks one, for
  either format.
- **4.6, fonts.** `export/svg.rs` names the families and embeds no `@font-face`.

## Where the tests are

- `crates/draw-engine/tests/ci_export_png.rs` — the four numbers, and the edge cases, as
  arithmetic derived from the lines above. Natively; no browser needed.
- `apps/web/src/lib/draw-chrome/exportParity.test.ts` — that the front holds none of it.
- `e2e/exportPng.spec.ts` — that the numbers reach the pixels: the real dialog, the real
  chips, and the downloaded file's own IHDR for the size and its own corner pixel for the
  background.
