# The properties panel

Confidence markers: **VERIFIED** (read in the pinned source _and_ covered by a test),
**IMPLEMENTATION DETAIL**, **UNKNOWN**. Oracle pinned at `scripts/oracle-sha.txt`
(`1118751f`); paths below are relative to the Excalidraw checkout.

## One summary, one revision

**VERIFIED** — Excalidraw reads each row with `getFormValue` (`actions/actionProperties.tsx:229`):
the value every target element shares (`reduceToCommonValue`), or the row's default when
they differ, which for most rows is `null`, so nothing is marked. The targets are the
selection plus the labels its shapes carry (`getTargetElements`).

Here the engine gives the whole panel in one pass: `selectionStyle()`
(`engine/crates/draw-engine/src/engine/selection_style.rs`), with `null` for a mixed
value, the same targets, and the oracle's row predicates (`textAlignable`,
`verticalAlignable`, and `canAlign` / `canDistribute` counted in arrange units). The
host asks again only when `styleRevision()` has moved. The revision moves on a selection
change, a style change, undo or redo, a text commit, and a peer's patch that touches a
selected element or its label. So the panel follows all of those without the host
tracking each one (`e2e/console.spec.ts`).

**IMPLEMENTATION DETAIL**: measured with criterion (`benches/editing.rs` ›
`selection_style`) on a shared 20-core host:

| selection            | time    |
| -------------------- | ------- |
| 1,000 of 1,000       | 252 µs  |
| 5,000 of 5,000       | 1.67 ms |
| 5,000 of 5,000, JSON | 2.47 ms |
| 1 of 5,000           | 649 µs  |

Most of the 5k cost is counting arrange units (`edit::units`, whose ungrouped path
searches linearly per element). Most of the 1-of-5k cost is `selection_is_group` cloning
the scene.

## What a style reaches

**VERIFIED** — `changeProperty(..., includeBoundText)` reaches a shape's label only for the
stroke colour and the opacity (`actionProperties.tsx`). The label keeps its own
background, width and dash. Choosing a style for the selection also makes it the next
element's style (`currentItem*`). An element the patch leaves unchanged keeps its version
(`newElementWith`, `packages/element/src/mutateElement.ts:170-172`). Covered by
`ci_style_reach.rs`.

## Copy and paste styles

**VERIFIED** — `actions/actionStyles.ts:51-236`, ported as `copy_styles` / `paste_styles`.
Copy takes the first selected element in stacking order, plus its label. Paste applies
the shared style to every target:

- roundness only where the kind takes it;
- a text's font from the source, or the defaults;
- arrowheads only from an arrow to an arrow;
- a frame target keeps a transparent background and no roundness.

Ctrl/Cmd+Alt+C and +V are matched on `event.code`, as the oracle does, because Option+C
types "ç" on a Mac. The context menu carries both items.

## Divergences

| what                            | Excalidraw                                                                                                                                                                                        | here                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S** with nothing selected     | opens the stroke picker under a drawing tool (`components/App.tsx:5895-5918`)                                                                                                                     | only with a selection. Our S is also the lasso key, which Excalidraw folds into the selection tool, and with nothing selected the key keeps that meaning     |
| eyedropper                      | its own sampler: it reads the canvas's pixels (`components/EyeDropper.tsx:107-120`), applies live while the pointer is held, and is also opened by holding Alt (`ColorPicker/ColorInput.tsx:141`) | the browser's `EyeDropper` API, Chromium only, opened by the button or **I**; no Alt hold and no live application. The button is absent where the API is     |
| arrowheads of a mixed selection | a non-arrow counts as the next element's arrowheads (`actionProperties.tsx:2002-2028`), so a box plus an arrow reads as mixed whenever the arrow's heads differ from those                        | read from the arrows only: a box plus an arrow shows the arrow's heads                                                                                       |
| opacity of a frame              | offered for everything but the autoshape tool (`components/shapeActionPredicates.ts:157`)                                                                                                         | a frame alone gets no style rows, opacity included (it predates this package; `shapeActions.test.ts` › a frame has a fixed appearance)                       |
| top picks in the dark theme     | the same five values, painted through the dark-mode filter (`ColorPicker/TopPicks.tsx`)                                                                                                           | darker values of their own (`inspector.ts` › `DARK_*_SWATCHES`, which predates this package); the popover's grid uses the light palette as Excalidraw's does |
| top picks                       | reorderable by drag and replaceable from a context menu (`ColorPicker/TopPicks.tsx:48`, `:75`)                                                                                                    | fixed                                                                                                                                                        |
| "Copied styles." toast          | on every path (`actions/actionStyles.ts:73`)                                                                                                                                                      | on the keyboard path only. The context menu lives in `DrawModals.svelte`, which has no way to raise a notice                                                 |

## Gaps

- **No number fields** for position, size or rotation. Those rows are not built;
  geometry is edited on the canvas.
- **No font family row.** Font families belong to the text-layout work.
- **No arrow-type row** (sharp / curved / elbow).
- **No next arrowheads.** The engine has no next-element arrowheads, so with nothing
  selected the arrowhead row has nothing to set.
