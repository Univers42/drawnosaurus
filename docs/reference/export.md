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
(`wasm/export.rs`). The front then does nothing but save it or hand it on — the clipboard
4.3 wants is a browser API the front is allowed, so `Blob` → `ClipboardItem` needs no engine
change at all.

A `toBlob` result is immutable, so the `tEXt` chunk cannot be added to _that_ `Blob`. 4.4
reads the bytes back out with `Blob.arrayBuffer`, splices the chunk in Rust, and hands the
front a **new** `Blob` typed `image/png` — the same three steps the oracle takes
(`blobToArrayBuffer` → `encodePngMetadata` → `new Blob([encodePng(chunks)], {type})`,
`data/image.ts@1118751f:32-46`). `toDataURL`, which this page once suggested, is worse: it is
synchronous, it blocks on a large canvas, and it would push a base64 round trip through the
front for no reason.

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

## Fonts: the SVG carries them, or it is a claim to a program that is not us

**VERIFIED.** An exported SVG has an `@font-face` declaration for every family its text
uses, and the face is the woff2 file itself, base64'd into the document. Before this the file
named the family and hoped; a `font-family` attribute is an address written for a renderer
that will never see the app it was exported from, and nothing in it is checked by anything.

The oracle inlines them too, which is the finding that decided the shape of the task:
`exportToSvg` awaits `Fonts.generateFontFaceDeclarations(elements)`
(`packages/excalidraw/scene/export.ts@1118751f:439-441`), puts the result in a
`<style class="style-fonts">` inside the `<defs>` (`:443-451`), and each declaration is
`` `@font-face { font-family: ${family}; src: url(${content}); }` ``
(`fonts/ExcalidrawFontFace.ts@1118751f:49`). **The plan line was right and the brief's grep
was too narrow** — it found no `@font-face` in `scene/export.ts` because the string lives in
`fonts/`, and Excalidraw's own committed snapshot carries 39 of them
(`tests/scene/__snapshots__/export.test.ts.snap@1118751f:18-42`).

Ours is in `engine/crates/draw-engine/src/export/font_face.rs`, and the whole decision is
there: which families, in which order, and which file each one is. **The host is given no
part in it and is not asked for anything** — the bytes are compiled into the crate, so
`exportSvg` stays synchronous, takes no new argument and has no new way to fail.

### What the document says, exactly

```
<defs><style class="style-fonts">
      @font-face { font-family: Excalifont; src: url(data:font/woff2;base64,d09GMgAB…); }
      @font-face { font-family: Excalifont; src: url(data:font/woff2;base64,d09GMgAB…); }</style></defs>
```

The newline and the six spaces are the oracle's own separator — `const delimiter =
"\n      ";` at `export.ts@1118751f:443` — and they are **character data** that travel in
the file. Three things in there are decisions and each one has a near-miss that renders the
same and reads differently:

- **One name, no fallback, no descriptor.** The stack's fallbacks belong on the `<text>`,
  where `getFontFamilyString` puts them (`packages/common/src/utils.ts@1118751f:130-132`), and
  a `font-weight` belongs nowhere: `fonts.css:45-54` declares Nunito at 500 for the app, and
  `toCSS` writes neither weight nor style. A family with a space (`Lilita One`,
  `Comic Shanns`) is written unquoted and unescaped, as the oracle interpolates it.
- **The families the exported text uses, once each, in first-appearance order** — the
  oracle's `getUniqueFamilies` is a `Set` filled while walking the elements
  (`fonts/Fonts.ts@1118751f:421-432`). Shapes do not pull a face in, and neither does a
  deleted element.
- **Every id the contract accepts, named as the oracle names it.** For the eight families
  this app can produce our stack is the oracle's **character for character**; the six
  published-vector rows and the four that differ are in `ci_svg_fonts_props.rs`.

The `<defs>` is written **whether or not it holds anything**, because `exportToSvg` appends
the `<style>` unconditionally: a shapes-only drawing has a `<defs>` with an empty `<style>`,
and giving it no `<defs>` at all would be a second shape of document.

### Where we differ from the oracle, and what each one costs

- **A whole shard, not a subset.** The oracle subsets each face to the scene's codepoints
  through a WASM harfbuzz build (`subset/subset-main.ts`); harfbuzz is a dependency this
  crate may not take (§3.2), so a declaration here is the entire file. Same glyphs, same
  sizes, same rendering. **One Virgil text costs 75KB of base64 where the oracle's costs
  about 2KB**, and the ten files are 230,452 bytes of the 2,363,483-byte WASM module — 9.8% of
  it, for every user including those who never export. That is the price of
  `design.md:1348` being delivered at all without a `needs <package>`, and it is the one
  number the owner may want to overrule.
- **Liberation Sans (9) declares nothing.** The file Excalidraw ships is Liberation 1.05,
  whose own ID 13 points at the 1.x EULA, and that project's OFL covers 2.00 and later only
  (`apps/web/static/fonts/LICENSES.md:30`). The oracle inlines this family; we do not.
- **Helvetica (2) declares nothing** — and neither does the oracle: it registers
  `LOCAL_FONT_PROTOCOL` (`fonts/Helvetica/index.ts:6-8`) and `fontFacesStylesGenerator` skips
  a local font (`Fonts.ts@1118751f:301-304`).
- **No `unicode-range`, exactly as the oracle.** `toCSS` writes three properties, so a
  family shipped in two shards emits two bare rules of the same family and the browser unions
  their coverage — which is the situation the oracle is in with its per-codepoint subsets.
  `SHIPPED_FONT_FACES` copies `fonts.css`'s per-family shard order so the two agree on which
  shard is which.
- **Ids 4, 10 and 11..=64 draw the legacy system stack.** The contract accepts 1..=64
  (`packages/contract/src/element.ts:226`); `getFontFamilyString` answers `Segoe UI Emoji` for
  an id its table does not name and `Assistant, …` for id 10, and we answer
  `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`. In the one case that can actually
  arrive — a board from Obsidian carries `fontFamily: 4` — the oracle's answer is the worse
  one, because `Segoe UI Emoji` is an emoji font. Changing it would move measurement for
  those elements and the element schema is a public format, so it is a decision and not an
  oversight: `the_ids_we_answer_differently_from_the_oracle_are_named_and_deliberate`.

### The two copies of the files, and why

The woff2 files are in `apps/web/static/fonts` and in
`engine/crates/draw-engine/assets/fonts`, the same bytes kept twice: the app needs a face to
draw with and an exported file needs one to _be_ the drawing after it leaves. One copy would
mean the engine reaching into `apps/web` at build time, which the submodule cannot do.
`assets/fonts/LICENSES.md` records where each file came from and what it may be shipped
under, and does not repeat the licence reasoning — that is one argument in
`static/fonts/LICENSES.md`, and two copies of an argument is how they come to disagree.
**Nothing in either build stops them drifting**, which is what the cross-tree test in
`fonts.test.ts` is for.

## Round trip: the scene inside the file, and what we cannot read

**VERIFIED.** A saved PNG carries the scene in a `tEXt` chunk and a saved SVG in its
`<metadata>` element, and both restore on `openDrawing` → `engine.restoreFromImage`. The
oracle is `packages/excalidraw/data/image.ts@1118751f` (71 lines) for the raster and
`export.ts@1118751f:510-563` for the vector, and this is the whole of it:

- the chunk is **spliced in immediately before `IEND`** — `chunks.splice(-1, 0,
metadataChunk)`, commented "insert metadata before last chunk (iEND)"
  (`image.ts@1118751f:44`);
- the chunk is found with `chunks.find(chunk => chunk.name === "tEXt")` (`:18`) and then
  `tEXt.decode`, so **the first one wins** and a second is invisible;
- `decodePngMetadata` (`:49-71`) is a three-way decision: the keyword must match or it
  throws `INVALID` (`:70`); inside the match it `JSON.parse`s and asks
  `!("encoded" in encodedData)` (`:54`) — **no `encoded` means the payload is legacy,
  un-encoded scene JSON**, accepted only when `type === "excalidraw"`
  (`:57-58`, `constants.ts@1118751f:342`) — and anything that throws becomes `FAILED`
  (`:62, 67`).

### The three payload generations, and the one we cannot read

| generation | payload                                                               | the oracle                                                               | ours                                                 |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1          | scene JSON, plain                                                     | `image.ts:111`… `:54-63`, the "legacy, un-encoded scene JSON" arm        | **what we write** — base64 of the JSON, uncompressed |
| 2          | `encode({compress: true})`: a **zlib** byte string in a JSON envelope | `image.ts:111`… `:37-41`, `data/encode.ts@1118751f:99-121`, `pako@2.0.3` | **not written, and not readable**                    |
| —          | no payload                                                            | `INVALID` (`:70`)                                                        | `RestoreRefusal::NotOurs`                            |

**Generation 2 is a named limitation, not a missing feature.** Reading it needs an
inflater; `crates/draw-engine/Cargo.toml` has no compressor and no base64 or PNG crate, and
BUNNY.md §3.2 does not allow adding one. The crate that would close it, measured:

| crate         | version | licence                     | `.crate` | unpacked | lines of Rust | released   |
| ------------- | ------- | --------------------------- | -------- | -------- | ------------- | ---------- |
| `miniz_oxide` | 0.9.1   | `MIT OR Zlib OR Apache-2.0` | 70,519 B | 360 KB   | 7,299         | 2026-03-13 |
| `flate2`      | 1.1.10  | `MIT OR Apache-2.0`         | 80,244 B | —        | —             | 2026-08-28 |

`miniz_oxide` is the smaller of the two and does both directions in one crate; `flate2` is
the familiar name and wraps it. **The wasm size delta is UNKNOWN by construction** — it
cannot be measured without adding the crate, which is the owner's call. The way to measure
it: add it, `make wasm`, and diff `engine/pkg/draw_engine_bg.wasm` against the current
build. Both are past §11's seven-day `minimumReleaseAge`; the gate is approval, not age.

**What parity would actually buy, stated precisely.** Not much, today: an Excalidraw PNG
reaches us with its scene JSON _inside_ the zlib envelope we cannot open, so the
best case is a scene that still needs 4.7's schema mapping — which is deferred as RISK — to
become a board. **What it would cost is a scene we cannot read, silently**: an
`osidraw` scene in a file that looked like a drawing. The refusal below is louder.

### The key is `osidraw`, and not the oracle's

The oracle keys its chunk with `MIME_TYPES.excalidraw` = `application/vnd.excalidraw+json`
(`constants.ts@1118751f:310`). **Ours is `osidraw`** (`export/roundtrip.rs`,
`SCENE_FORMAT`), and the reason is that a key is a claim about what is inside: what is
inside is an `osidraw` scene — the word our own scene JSON already says in its `type` — and
the oracle's own reader would reject it three lines later for exactly that reason
(`image.ts@1118751f:57-58` asks for `type === "excalidraw"`). Borrowing the key would buy
nothing and cost a clean "this file is not mine" for a claim we cannot keep. It is also 7
bytes against 40, and it is not a MIME type, so nothing that sniffs types reaches for it.

### Why base64, which is not the oracle's shape

Two reachable constraints, neither decoration:

- a `tEXt` chunk is **Latin-1 with no NUL** (`png-chunk-text@1.0.0`, `encode.js:7-13, 15-41`
  writes `keyword ++ 0x00 ++ text`; `decode.js:25` throws on a NUL inside the text), and
  scene text is UTF-8 — so an emoji written raw comes back as four Latin-1 characters, and a
  text element holding a NUL makes the chunk unreadable to any conforming reader;
- the SVG's payload lives inside an XML comment, and `--` closes a comment, and a text
  element may well hold `--`.

The base64 alphabet is ASCII with no `-` and no NUL, so one encoding satisfies both and one
function (`scene_payload`) serves both containers. That is also the oracle's own
`payload-version:1` shape — base64 of the scene JSON — so an uncompressed payload is a
generation the oracle's reader already knows how to _reach_ before it rejects it at the
`type` test.

### The failure matrix, pinned

| a file that is…                                                      | answered     | why                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a PNG with **no** `tEXt` chunk                                       | `NotOurs`    | `getTEXtChunk` answers `null` (`image.ts:111`… `:19-22`)                                                                                                                             |
| a `tEXt` chunk under **another key**                                 | `NotOurs`    | the keyword test at `:51` fails the same way — the oracle cannot tell these two apart either, and neither do we                                                                      |
| a chunk with **our key** and garbage text                            | `Unreadable` | the oracle's `FAILED` (`:62, 67`)                                                                                                                                                    |
| a payload of a **generation we do not know**                         | `Unreadable` | refused, never misread                                                                                                                                                               |
| a payload of **our generation** with no elements                     | `Unreadable` | **the silent failure** — a restore that yields nothing looks exactly like a fresh board, and the oracle refuses to export one for the same reason (`data/index.ts@1118751f:120-122`) |
| **not a file we can walk** (no PNG signature, no `IEND`, not an SVG) | `Malformed`  | the oracle lets `png-chunks-extract`'s throw escape uncaught (`getTEXtChunk` is awaited outside its `try`, `:50`) and a person is told a library's name                              |
| a scene's own `version: 99`                                          | **restores** | not a gate: `OsidrawFile.version` is metadata (`export/json.rs`), which is what keeps the oracle's promise keepable — every generation ever written stays readable                   |

**The scene is loaded inside the binding**, not handed back for the host to load. A result
object the host then fed to `loadScene` would put the whole thing at risk in one line of
the front: a host that forgot the second call would open a file and see the board it already
had, which is the same silence as a blank board. A refusal cannot touch the scene, because
the scene is replaced on the one path that succeeded.

### What is deliberate and differs from the oracle

- **The embed is always on for a file export** (`ExportOptions::embed_scene`, default
  `true`), where the oracle's `appState.exportEmbedScene` defaults to `false` and is a
  checkbox (`actionExport.tsx@1118751f:99-105`). A picture that carries nothing is a lossy
  format wearing a `.png` name, and `design.md:1352` asks for a round trip. **The checkbox
  is not built** — a host may not grow a decision, and a person who wants a bare picture
  can save the `.png` and strip the chunk, or the owner can ask for the checkbox.
- **A clipboard copy embeds nothing**, which is the oracle's own line rather than ours:
  `exportEmbedScene: appState.exportEmbedScene && type === "svg"`
  (`data/index.ts@1118751f:132`) is false for `type === "clipboard-svg"`. Pinned in
  `ci_export_clipboard.rs`, and the `<metadata>` element and `svg-source` comment are in
  **both** — `exportToSvg` appends them unconditionally (`export.ts@1118751f:363-370`).

## What is not here yet

Phase 4's other export tasks, and what each would need:

- **4.4's two halves that are not.** The **reading** of a zlib payload (the oracle's
  generation 2) needs a crate, and the **schema** of an Excalidraw scene is 4.7's and
  deferred as RISK. Neither is a gap in the container; both are written down above with
  their cause.
- **4.5, background and theme.** A _chosen_ background colour. Today the export paints
  `view.theme.background` or nothing; there is no option anywhere that picks one, for
  either format.
- **4.6's subsetting.** The faces are embedded whole, not subset to the scene's codepoints as
  the oracle subsets them, and the ten files cost 9.8% of the WASM module. That is the trade
  written down above, not a gap.
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
- `crates/draw-engine/tests/ci_export_roundtrip.rs` — the round trip's **decisions**: the key,
  the generation prefix, and the six failure answers, one case each. Includes the five
  families the brief named — no chunk, another key, corrupt text, an unknown generation, an
  empty scene — plus every truncation of a good file at every length, and the clipboard's
  own `exportEmbedScene` difference.
- `crates/draw-engine/tests/ci_export_roundtrip_bytes.rs` — the **bytes**, against three
  things that are not the code under test: `tests/common/png.rs` (a second implementation of
  the PNG container, which walks the table, verifies every CRC and decodes the keyword split
  itself), RFC 4648 §10's published base64 vectors, and two committed fixtures written by a
  third implementation in another language. The strongest case in it is
  `the_engine_writes_the_fixture_back_byte_for_byte`: the engine re-writes the fixture's own
  picture and payload and the two files are compared byte for byte. A round trip cannot check
  that, because a round trip only ever sees one implementation twice.
- `crates/draw-engine/tests/ci_export_roundtrip_props.rs` — the two invariants over 240
  seeded corpora: **no byte sequence ever restores to an empty scene**, and every scene comes
  back field for field with every id and every text (accents, an emoji, an em dash, a `--`,
  a NUL). Reproducible from the seed alone; no `proptest`, which is not installed.
- `crates/draw-engine/tests/fixtures/embedded-scene.png` and `.svg` — a 1×1 picture carrying a
  hand-written two-element scene. `file(1)` reads the PNG as "PNG image data, 1 x 1, 8-bit/
  color RGBA", Python's `zlib` inflates its `IDAT`, and the scene inside was written by hand
  rather than printed by `scene_to_json`.
- `crates/draw-engine/tests/ci_svg_fonts.rs` — the **decisions**, character for character: the
  declaration's whole text, its place between the `<metadata>` and the paper, the empty
  `<style>` in a shapes-only drawing, a family with a space, the absence of every descriptor
  and fallback, the two families with no file, an unresolved family, both size paths, and the
  first-appearance order. Nothing asserts that an attribute _exists_; every assertion is the
  whole string.
- `crates/draw-engine/tests/ci_svg_fonts_bytes.rs` — the **bytes**, against four things that
  are not the code under test: `tests/common/svg.rs` (a second implementation of the document,
  with its own base64 decoder written as a bit list rather than a shift-accumulator), **the
  oracle's own committed `@font-face` payload** from `export.test.ts.snap`, RFC 4648 §10, and
  the WOFF2 §4.1 signature and `length` field. Its CRC-32 is checked against the published
  `0xCBF43926` for `123456789` _before_ it is trusted to check anything else.
- `crates/draw-engine/tests/ci_svg_fonts_props.rs` — every one of the 64 ids the contract
  accepts, both size paths, against a **second transcription** of the oracle's
  `FONT_FAMILY`/`getFontFamilyFallbacks`; plus 200 seeded corpora over the whole domain for
  four properties (declarations are exactly the used shipped families in first-appearance
  order; each family carries its own shards in that order; the output is a function of the
  elements; reversing the elements does not change the family set). The four ids that differ
  are named as a decision in their own test.
- `apps/web/src/lib/draw-chrome/fonts.test.ts` — that the engine's table and `static/fonts`
  hold **the same ten files with the same bytes**, which neither build can check alone.
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
