# Text model

Confidence markers: **OBSERVED** (seen in the running app), **VERIFIED** (read in the
pinned source _and_ observed), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

Oracle pinned at `scripts/oracle-sha.txt`, cited as `path@1118751f:line`. The engine lays
text out, measures, paints and exports it with the fields below: see [Layout](#layout).

## What was wrong

| cause                                                                                                                                                                                                                                                                                                                                                                 | pinned by                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The engine sent the text editor request as `font_size`, `text_align`, `container_id`. The host reads camelCase, so all three were `undefined`. The overlay's font size was NaN (`NaNpx` is invalid CSS, so the browser used its 13.33px textarea default), its alignment was `start`, and a label was edited as free text: unwrapped and as wide as its longest line. | `ci_text_model_compat.rs` › the text edit request is camel case; `e2e/textEditRequest.spec.ts` |
| Once the request was readable, a label's box was set to the label's width with `box-sizing: border-box`, so the padding and border came out of the text: the overlay would wrap 14px before the canvas. Its height was read before its width was set.                                                                                                                 | `e2e/textEditRequest.spec.ts` › a label wraps at its shape's width                             |

## The fields

All four are optional and **undefaulted** in the contract, the TS `DrawElement` and the Rust
`DrawElement` (`skip_serializing_if = "Option::is_none"`). When a field is absent, the engine
does what it did before the field existed. A scene saved before them loads and exports
byte-identical (`ci_text_model_compat.rs` › a legacy scene round-trips byte-identical). Nothing
is added on the way through the server (`boards.test.ts` › adds none). Read them through the
resolvers in `scene/element.rs`, not directly.

The engine and the contract hold one range for `fontFamily` and `lineHeight`. A value the
contract refuses is dropped where it comes into the engine (a file, the server, a peer's patch),
because the server refuses a whole patch for one such value and the autosave resends an
unacknowledged element with every later change: the board would never save again. Dropping it
is what happened to these keys before the engine knew them (`ci_text_model_compat.rs` › a value
the contract refuses is dropped where it comes in; `e2e/textModel.spec.ts` checks the engine's
export against `patchElementsSchema` at every edge).

| field          | contract                    | absent means                                | resolver               | oracle                                                 |
| -------------- | --------------------------- | ------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `originalText` | string, ≤ `MAX_TEXT_LENGTH` | `text` is the source, and so when empty     | `source_text`          | `originalText`; restore `\|\| text` (`restore.ts:572`) |
| `fontFamily`   | integer 1..=64              | the system stack (`render::FONT_FAMILY`)    | `resolved_font_family` | `fontFamily`, same numeric ids                         |
| `lineHeight`   | finite 0.5..=4              | the family's own, 1.25 for the system stack | `resolved_line_height` | `lineHeight`                                           |
| `wrap`         | boolean                     | a label wraps inside its shape              | `layout::wrap_width`   | none, see below                                        |

**INFERRED** (read in the pinned source, not observed on excalidraw.com): the known family
ids and their line heights are the oracle's (`packages/common/src/constants.ts:133-144`,
`packages/common/src/font-metadata.ts:35-104`). Virgil 1, Excalifont 5, Nunito 6 and Comic
Shanns 8 use 1.25. Helvetica 2, Lilita One 7 and Liberation Sans 9 use 1.15. Cascadia 3 uses
1.2. The oracle's 4 is retired and its 10 (Assistant) is private to its own UI, so neither
counts as known here.

## Decisions

**Divergence, deliberate.** The engine keeps a family id it does not know but the contract
allows (4, 10, 11..=64) and never rewrites it, but it draws that text with the system stack.
Keeping the id lets a newer client's font survive a trip through this one. The contract allows
up to 64 for the same reason. An id outside 1..=64 is dropped as it comes in (see above). For
an unknown id the oracle falls back to Excalifont's metrics (1.25, the same number) and to the
emoji font for the face (`packages/common/src/utils.ts:123-136`).

**Divergence, deliberate.** A line height outside 0.5..=4 is dropped as it comes in, and
`resolved_line_height` ignores one set in code (or a non-finite one) rather than clamping it:
the family's own is used. The oracle has no range. Its restore replaces only a missing or zero
line height, and for legacy elements it detects one from the height (`restore.ts:557-564`). We
do not detect: our legacy text was always drawn at 1.25, which is what `None` resolves to.

**IMPLEMENTATION DETAIL.** `fontFamily` is a `u8`. Every value the contract refuses (0, 65,
300, -1, 1.5, a string) is dropped by the field's own deserializer, so it never refuses the rest
of the document, and one door or another cannot disagree about it. `5.0` is kept as 5, as the
contract (which reads JSON numbers) keeps it.

**Divergence, no oracle equivalent.** `wrap` only means something on a label. When it is
absent or `true`, the label wraps inside its shape, which is the oracle's only behaviour.
When it is `false`, the label keeps its hard lines and its shape grows wide enough to fit them.
Free text says the same thing with `autoResize`, as in the oracle.

**The source stays the source.** A text that carries `originalText` keeps it in step: an edit
records what was typed as the source (the oracle's `originalText`), the editor opens on
`source_text` as the oracle's does (`textWysiwyg.tsx:488`), and a column given a new width
re-wraps `source_text`, not the text drawn at the old width (`ci_text_model_compat.rs` › an edit
keeps the source in step, the editor opens on the source, a resized column rewraps its source).
Left stale, the source would still read what the text said before the edit, and a client laying
text out from it would put the old words back.

**Every writer keeps it.** Laying a text out (`text::layout::layout_text`) writes
`originalText` from `source_text` and wraps from it, so a text without one gains it at its
first edit, font change or relayout, and widening a label's room unwraps it
(`ci_text_model_compat.rs` › an edit keeps the source in step; `ci_text_model.rs` › relayout
wraps the source, not the drawn lines).
New text carries `originalText`, `fontFamily` 5 (Excalifont, the oracle's
`DEFAULT_FONT_FAMILY`) and that family's `lineHeight` from the start. Text with no
`fontFamily` is laid out, painted and exported exactly as before (`ci_text_model.rs` › a text
with no family keeps its old placement; `ci_export.rs`).

## The editor overlay

The overlay's font size is `fontSize × zoom% / 100`, and it is never NaN. `screenFontPx` in
`apps/web/src/lib/draw-chrome/camera.ts` falls back to the element's own size
(`engine.getFontSize()`), then to 20.

The request carries the box the canvas wraps the lines in: its width is `wrap_width`, the one
function layout wraps with, and its left edge puts the lines' anchor where the painter puts it
(`text_anchor_x`). For a shape it is the shape's text box (`getBoundTextMaxWidth`,
`getContainerCoords`), so a label's editor is its padded box, not the label, which is only as
wide as its longest line. For an arrow it is `max(0.7 × width, 11 × fontSize)` around the
arrow's middle (`packages/element/src/textElement.ts@1118751f:511-540`). The overlay's text box
is exactly that width, with no minimum for a label, so it wraps where the canvas does, however
narrow the shape (`ci_text_model_compat.rs` › a shape's label editor is its padded box, an arrow
label's editor is the box its lines wrap in; `e2e/textEditRequest.spec.ts`,
`e2e/textLayout.spec.ts`). A fixed-width free text still opens the measured, unwrapped editor:
only a label's editor wraps.

The request also names the family (`fontFamily`, an id, 0 for the system stack) and the
`lineHeight`: the overlay types in `engine.fontFamily(id)`, measures with it, and spaces its
lines as the canvas does.

**ponytail.** The chrome is 14px because the 1.5px border is drawn as 1px at a device pixel
ratio of 1. At a ratio of 2 the text box is 1px narrower than the label. The textarea sits 7px
left and 3px up of the request's point, so its text box is the canvas's; before, the text sat
7px right, past a small shape's edge, and jumped back on commit. The overlay does not grow the
shape as it is typed and ignores rotation: that is the editor rewrite's job, and it drops the
border.

## Layout

One function lays a text out, `text::layout::layout_text`
(`engine/crates/draw-engine/src/text/layout.rs`), a port of `redrawTextBoundingBox`
(`packages/element/src/textElement.ts@1118751f:51-153`). Every path that sets text or changes
its room goes through it: the editor's commit, a peer's preview, a font size, family or
alignment change, `set_text_box_width`, `relayout_text` and `fonts_loaded`. It wraps from the
source, measures, and grows a label's shape to hold it. **VERIFIED** by `ci_text_model.rs`
(every shape, growth, unwrap, rotation, the free-text anchors, style reaching a label, a font
arriving) and `e2e/textLayout.spec.ts` (a label typed into a rectangle, an ellipse and a
diamond; a family change; the SVG export).

| oracle                                                                                       | here                                                           |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `getBoundTextMaxWidth` / `MaxHeight` (`textElement.ts@1118751f:511-570`)                     | `bound_text_max_width` / `bound_text_max_height`               |
| `getContainerCoords`, `computeBoundTextPosition` (`:396-417`, `:249-324`)                    | `container_coords`, `bound_text_position` (and `layout_label`) |
| `computeContainerDimensionForBoundText` (`:492-509`)                                         | `container_dimension_for_bound_text`                           |
| `getBoundTextElementCenter` (`linearElementEditor.ts@1118751f:1942-1960`)                    | `linear_label_center`                                          |
| `measureText` (`textMeasurements.ts@1118751f:12-27`)                                         | `Measure::size`                                                |
| `getAdjustedDimensions` (`newElement.ts@1118751f:393-527`)                                   | `edit_anchor`                                                  |
| `offsetElementAfterFontResize` (`actionProperties.tsx@1118751f:273-292`)                     | `font_resize_anchor`                                           |
| `actionTextAutoResize` (`actionTextAutoResize.ts@1118751f`)                                  | `auto_resize_anchor`, `set_text_auto_resize`                   |
| `changeFontFamily` sets the family's line height (`actionProperties.tsx@1118751f:1285-1290`) | `set_font_family`                                              |
| `FONT_METADATA`, `getVerticalOffset` (`font-metadata.ts@1118751f:35-170`)                    | `text::font::FAMILIES`, `vertical_offset`                      |
| the arrow clipped under its label (`renderElement.ts@1118751f:784-812`)                      | `paint_linear_around`                                          |
| the arrow masked under its label (`staticSvgScene.ts@1118751f:404-470`)                      | `linear_svg`                                                   |
| text painted per line on its baseline (`renderElement.ts@1118751f:626-676`)                  | `paint_text`, `text_line_placement`                            |
| text exported per line (`staticSvgScene.ts@1118751f:776-832`)                                | `text_svg`                                                     |

`BOUND_TEXT_PADDING` is 5, as in the oracle (it was 8 here). A label taller than its shape
allows is placed by the oracle's rule, above the padding, rather than clamped inside
(`ci_text_align.rs` › a label taller than its container is placed by the oracle's rule), and
the shape grows to hold it anyway. Style applied to a shape reaches its label for stroke colour
and opacity (`actionChangeStrokeColor`, `actionChangeOpacity`).

The web fonts (`apps/web/static/fonts/LICENSES.md`) load when some text first asks for them;
`watchFonts` (`apps/web/src/lib/draw-chrome/fonts.ts`) then calls `engine.fontsLoaded()`, which
re-measures and re-lays every text in a family without stamping it (`ci_text_model.rs` › a loaded
font relays texts without stamping them; `e2e/textLayout.spec.ts` › a font family change).

### Where layout departs from the oracle

| divergence                                                                                                                                                                                                                                  | oracle                                               | pinned by                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| A line or arrow never grows for its label: its extent is its points'. The oracle writes the new width onto an arrow, which its points then contradict.                                                                                      | `textElement.ts@1118751f:127-133`                    | `ci_text_model.rs` › an arrow's label wraps at the oracle's width |
| A font arriving re-lays text, unstamped. The oracle only drops caches and repaints, so a box sized in a fallback keeps its size until the next edit. Arrows bound to a grown shape are re-routed at the next edit of either.                | `Fonts.ts@1118751f:106-148`                          | `ci_text_model.rs` › fonts_loaded                                 |
| A peer's preview carries the label only; the shape it grows is sent grown on commit.                                                                                                                                                        | `textWysiwyg.tsx` grows the container as it is typed | none: the editor rewrite streams both                             |
| Text with no `fontFamily` (every text made before this) keeps the system stack, 1.25 lines, drawn from the top of each line, and its SVG baseline at 0.85 of the size.                                                                      | `restore.ts` gives such text a family                | `ci_text_model.rs` › families, `ci_export.rs`                     |
| No `direction` on exported or painted text: right-to-left text is laid out left to right.                                                                                                                                                   | `staticSvgScene.ts@1118751f:776-832`                 | none (gap)                                                        |
| A line can carry a label here, and its stroke is cut under it as an arrow's is.                                                                                                                                                             | only arrows take labels                              | `ci_export.rs`                                                    |
| The SVG export names each text's family but embeds no `@font-face`, so a viewer without the font draws the fallback.                                                                                                                        | `Fonts.generateFontFaceDeclarations`                 | none (gap)                                                        |
| Excalifont (the default) and Liberation Sans are not shipped, nor Xiaolai, emoji, or non-Latin shards: their licence could not be read from the file, or they are out of scope. Text asks for them and draws in the next face of its stack. | `packages/excalidraw/fonts/`                         | `apps/web/static/fonts/LICENSES.md`                               |
