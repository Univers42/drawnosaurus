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

## The two exports no longer disagree on padding

**OBSERVED, 4.2.** They were 6px apart per side and now are not. `exportSvg` used to take a
bare `padding: f64` that the front supplied, and the front supplied `16`, in two places:
the dialog's own call and the host wrapper's default. The oracle's is 10
(`constants.ts@1118751f:398`), which is what the PNG path used.

`export_svg` now takes an `ExportOptions` and the margin is the same `10` for both formats.
The signature had nowhere left to pass a number, which is the point: §2 does not allow the
front to pick a margin, and a parameter that exists is a parameter someone will fill in.

`scene_to_svg` was the deeper half of it. It took `(bounds, padding)` and did the framing sum
itself — a second copy of `ExportFrame::for_bounds`'s arithmetic — so it could only ever be a
second framing path. It now takes the `ExportFrame` and does no arithmetic of its own.

**A ratchet that switched itself off, which is worth knowing about.** `exportParity.test.ts`
held the two debt sites as _patterns_ inside `KNOWN_FRONT_NUMBERS`. Emptying the list to
record that 4.2 paid the debt therefore also removed the detector, and putting
`engine.exportSvg(16)` back into the dialog left all twelve tests green. The patterns are now
`FRONT_NUMBER_PATTERNS` and the list is only the allow-list; the same mutation now fails with
the site named and its owner reported as `unowned`. An allow-list is not a detector.

## What a selection or one frame is, and the one thing this got wrong first

**VERIFIED.** There is no selection-bounds function and no frame-bounds function. The oracle
decides _which elements_ an export covers one layer above the framing, in
`prepareElementsForExport` (`packages/excalidraw/data/index.ts@1118751f:48-96`), and
`getCanvasSize` takes an element list. So `ExportScope` (`export/scope.rs`) is those two
decisions and the framing is still `ExportFrame`'s — one path to a box, reached from three
places.

| what is selected     | what is painted                        | what it is measured by         | padding |
| -------------------- | -------------------------------------- | ------------------------------ | ------- |
| nothing              | the whole live scene                   | `getRootElements` of the scene | 10      |
| one ordinary element | that element                           | its own **turned** box         | 10      |
| one frame            | the frame's overlapping contents       | **the frame's own box**        | **0**   |
| more than one        | the selection, plus a frame's children | `getRootElements` of the union | 10      |

**A frame is measured by the frame, and that is the part that reads like a bug.**
`exportingFrame ? [exportingFrame] : getRootElements(elementsForRender)` with
`exportPadding = 0` set in front of it (`export.ts@1118751f:228-233`, and `:337-342` for the
SVG, which is the same two lines twice). So the two halves diverge on purpose: the painted set
is the frame's contents, the framing box is the frame element. A child poking past the frame's
edge is **cropped**, because the box is the frame's and not the children's union.

The same frame export also sets `frameRendering.clip = false` — "for canvas export, don't
clip if exporting a specific frame as it would clip the corners of the content"
(`:217-219`). Without it the frame's own clip box cuts the content at the frame's very edge.

**An empty selection is the whole scene, and it is the oracle's deliberate answer.**
`isExportingSelection` is `exportSelectionOnly && isSomeElementSelected(...)` (`:56-58`), and
`isSomeElementSelected` is `elements.some(el => selectedElementIds[el.id])`
(`selection.ts@1118751f:141-143`). With nothing selected the flag never becomes true, so the
ternary at `:61-69` takes its `else` arm and `exportedElements = elements`. **What makes the
competing branch not run is that no _live element_ is selected** — not that the checkbox is
off, and not that the id list is empty in the abstract. The alternative is a 20×20 canvas of
nothing, which is what an empty element list would measure, and it is the case most likely to
be wrong and least likely to be noticed: it exports a picture and it downloads.

**There is no separate "export this frame" call, and the oracle has none either.** A frame
export is what a selection of exactly one frame _is_ (`data/index.ts@1118751f:73-79`). The
front passes one boolean and the engine decides which of the three rows above it meant.

## The bug this found: the two formats framed one drawing differently

**VERIFIED, and it is the reason `scene_to_svg` changed shape rather than just gaining a
field.** The SVG path measured with `scene_bounds` — the _unrotated_ union — while the PNG
path measured with `scene_outline_bounds`, the turned box `getCommonBounds` actually returns.
So one turned square exported as a diamond in PNG and as the box it was drawn in as SVG, from
the same drawing at the same padding: `expected 100 ~= 141.4213562373095`.

The oracle cannot do this, and the reason is structural rather than incidental: it builds one
`getCanvasSize` call and hands it to both formats (`export.ts@1118751f:232-235` and
`:341-344` are the same expression). A function taking `(bounds, padding)` can only ever be
one framing path's private arithmetic, which is what ours was. Taking the `ExportFrame`
instead is what makes the divergence unrepresentable.

`Scene::bounds()` is still the unrotated union, and two camera paths still use it —
`fit` (`engine/style.rs:688`) and `content_in_view` (`:898`) — while the oracle's
`actionZoomToFit` measures with `getCommonBounds` (`actionCanvas.tsx@1118751f:307-311`). A fit
that used a stored box would crop a turned element's corners. Not this task's; recorded here
because it is the same mistake in a different place.

## Copy as PNG / as SVG

The oracle's two copy actions are `actionCopyAsPng` (`actionClipboard.tsx@1118751f:192`) and
`actionCopyAsSvg` (`:124`). Both call `prepareElementsForExport(elements, appState, true)` —
the literal `true`, in both — so **a copy is the export scope, unchanged**, and there is no
third mode and no flag to forget. With nothing selected that is the whole scene
(`data/index.ts@1118751f:56-58, 61-69`), exactly as for a file, and a lone selected frame is
a frame export.

Three questions a _file_ never asks, all answered in the engine (`export/clipboard.rs`):

- **the MIME type** — `image/png` for the raster, and **`text/plain`** for the vector, not
  `image/svg+xml`: the oracle writes the string as text because `navigator.clipboard.write`
  "doesn't work with non-standard mime types" (`clipboard.ts@1118751f:622-625`).
- **whether to write at all** — the oracle's `predicate`
  (`actionClipboard.tsx@1118751f:186-188, 247-249`). The browser's half is a fact the host
  reports (`probablySupportsClipboardBlob`, `clipboard.ts@1118751f:68-72`); the verdict is
  the motor's, the same way `ExportOptions`'s default scale is decided from a device pixel
  ratio the engine cannot see (`export/png.rs:51-55`).
- **what was copied** — the toast's one word, `"selection"` or `"scene"`, carried by
  `ExportScope::kind` rather than re-derived by the front from its own `selectedCount`,
  which is not the same number: a selection of ids that are not on the board is not a
  selection (`selection.ts@1118751f:141-143`).

`ClipboardCopy` **carries its `ExportScope`** rather than a kind alone. Only a browser can
encode a canvas, so the raster has to be finished by the host, and a copy that handed back
only a word would send the host to `export_scope` for the elements — a second element-list
decision, in the one module whose reason to exist is that the two agree.

### The failure path, which is the whole point

The oracle reports every way this can fail and none of them quietly: `exportCanvas` rethrows
for the vector (`data/index.ts@1118751f:151-159`) and classifies the raster's into three —
too big, a Firefox `ClipboardItem` that is not defined, and the generic case (`:194-213`) —
and both actions' `catch` puts the message on screen (`actionClipboard.tsx@1118751f:176-184,
236-245`). `apps/web/src/lib/draw-chrome/clipboard.ts` is the host side of that, and
**`copied` is reachable only after the browser has accepted the payload**.

The two formats are not symmetric, and it is not in _whether_ they report: in English the
oracle's two generic messages are the **same string** (`locales/en.json@1118751f:278` and
`:320`), so the difference is that the raster can also say _why_ — `too-big` is that branch,
and the only one a person can act on.

A refused copy carries **which** of the two reasons it was refused, because the oracle says
two different things about the two: a browser that cannot take the payload makes the menu
entry **absent** (`ContextMenu.tsx@1118751f:38-48` filters on `predicate`), while an empty
board leaves the entry visible and reports `alerts.cannotExportEmptyCanvas`
(`data/index.ts@1118751f:120-122`) — the key path never consults `predicate` at all, only
`keyTest` (`actions/manager.tsx@1118751f:98-112`).

The oracle's Safari quirk is a **success** path, not a failure one: the `ClipboardItem` has
to be built in the same tick or the browser complains about lack of user intent
(`clipboard.ts@1118751f:558-563`), which is why the host awaits the blob and builds the item
synchronously.

### The chord, and the one place we differ

`Alt+Shift+C` is the oracle's own chord, **for the raster alone**:
`event.code === CODES.C && event.altKey && event.shiftKey` (`actionClipboard.tsx@1118751f:250`).
`actionCopyAsSvg` declares **no `keyTest` at all** (`:124-190` ends at `keywords`), so
copy-as-SVG is a menu entry and not a chord.

**Divergence, deliberate:** that `keyTest` has no Ctrl/Cmd condition and copy styles' has no
Shift condition (`actionStyles.ts@1118751f:78-79`), so on `Ctrl+Alt+Shift+C` both match — and
the oracle's `handleKeyDown` refuses to choose, logging "Canceling as multiple actions match
this shortcut" and returning false (`actions/manager.tsx@1118751f:114-119`). **The oracle's
answer to the four-key chord is that nothing happens at all.** Ours is a first-match chain,
not a filter, so the copy chord carries `!mod` (the guard zen mode and snap already use) and
the four-key press copies styles. Reproducing a no-op would mean advertising a chord that
does nothing.

### Known limits

- The toast omits the oracle's colour-scheme clause (`locales/en.json@1118751f:575-576`,
  "…({{exportColorScheme}})"). It reads `appState.exportWithDarkMode`, which is always false
  by default, and printing "(light mode)" would state a fact this engine has no dark-mode
  export for. The clause arrives with that feature.
- The raster's **Firefox hint** (`hints.firefox_clipboard_write`) is not reproduced; the
  generic message is. It is a string for one browser, and a host that cannot tell which
  browser refused has nothing to attach it to.
- The copy takes no scale or transparent-background option: it uses `ExportOptions::default`,
  the picture the file export produces with its dialog untouched. The oracle passes its live
  `appState` through, so it honours whatever the export dialog was last set to — which for a
  person who never opened it is the same default.

## What is not here yet

Phase 4's other export tasks, and what each would need:

- **4.4, the round trip.** A `tEXt` chunk holding the scene JSON. Not started, and it needs
  a different hand-off than 4.1's — see above, the `Blob` a `toBlob` returns cannot be
  modified.
- **4.5, background and theme.** A _chosen_ background colour. Today the export paints
  `view.theme.background` or nothing; there is no option anywhere that picks one, for
  either format.
- **4.6, fonts.** `export/svg.rs` names the families and embeds no `@font-face`.
- **4.2's leftovers, both small.** `frame_labels` now has one consumer that can act on it
  (`export_view_of` withdraws the names), but the two formats still disagree: a PNG draws a
  frame's name and `scene_to_svg` draws none, where the oracle adds the label to both
  (`export.ts@1118751f:169-172`). And `ExportOptions::background` still does not reach the
  SVG's `<rect>`, which is drawn unconditionally — 4.5's, as above.

## Where the tests are

- `crates/draw-engine/tests/ci_export_png.rs` — the four numbers, and the edge cases, as
  arithmetic derived from the lines above. Natively; no browser needed.
- `crates/draw-engine/tests/ci_export_scope.rs` — what an export is **of**: the three scopes,
  the empty selection, the frame's own box at no padding, and two invariants over ten scene
  shapes. Both invariants are mutation-checked — aiming the subset's cull at the editor
  camera, framing a frame by its contents, dropping the `isSomeElementSelected` half of the
  guard and reversing the `includeElementsInFrames` direction each fail them, and each of
  those four was run.
- `crates/draw-engine/tests/ci_export_clipboard.rs` — the four decisions: the type, the
  predicate, the scope, and which of the two reasons a copy was refused. Natively.
- `crates/draw-engine/tests/ci_export_clipboard_props.rs` — the invariant, over 200 seeded
  corpora and **every** subset of each as a selection: the clipboard's text is byte-identical
  to the file export's, the scope word matches an independent restatement of
  `isSomeElementSelected`, a frame is measured by its own box, a turned element by what it
  draws, and a declined copy carries nothing. All four were mutation-checked — a clipboard
  that decided its own scope, a frame reported as the scene, bounds measured unrotated and a
  declined copy claiming success each fail one, and one of those two failures is what
  changed the scope assertion in this list.
- `apps/web/src/lib/draw-chrome/exportParity.test.ts` — that the front holds none of it.
- `apps/web/src/lib/draw-chrome/clipboard.test.ts` — the host's side, including every
  failure: a refused write, a browser with no clipboard, an empty board and a canvas too
  large to encode, each asserted to produce a _sentence_ and never a silent success.
- `e2e/copyAsImage.spec.ts` — that the copy reaches a real clipboard. `write` is
  **recorded and then delegated**, so the type is observed at the moment of the write (an
  `image/png` cannot be read back in headless Chromium) while the app's success path stays
  real; the vector is read back off the OS clipboard outright. Permissions are the
  `context.grantPermissions(["clipboard-read", "clipboard-write"])` on 127.0.0.1 that
  `e2e/clipboard.spec.ts:51-53` already uses, and no assertion in the file depends on the
  grant being honoured — a stub that swallowed the write would still be recorded, and the
  real write failing shows as a reported failure rather than a pass.
- `e2e/exportPng.spec.ts` — that the numbers reach the pixels: the real dialog, the real
  chips, the downloaded file's own IHDR for the size, its own corner pixel for the
  background, and its own middle pixel for the scale — a 3x export that is a 3x canvas
  holding a 1x drawing has the right IHDR and a blank middle, and nothing in Rust can see
  the difference.
