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
first edit, font change or relayout, and a label laid out again in a wider room unwraps
(`ci_text_model_compat.rs` › an edit keeps the source in step; `ci_text_model.rs` › relayout
wraps the source, not the drawn lines). A resize handle lays text out too, on every move
(`text.md` › A resize rewraps).
New text carries `originalText`, `fontFamily` 5 (Excalifont, the oracle's
`DEFAULT_FONT_FAMILY`) and that family's `lineHeight` from the start. Text with no
`fontFamily` is laid out, painted and exported exactly as before (`ci_text_model.rs` › a text
with no family keeps its old placement; `ci_export.rs`).

## The editor overlay

Typing is a session in the engine (`engine/crates/draw-engine/src/engine/text_session.rs`), a
port of the one `textWysiwyg` runs (`packages/excalidraw/wysiwyg/textWysiwyg.tsx@1118751f`).
The request opens it; `updateTextEdit(text)` lays out every keystroke — wrapped, measured, the
shape grown or shrunk and the arrows bound to it following — with no history step and no stamp;
`commitTextEdit(text, viaKeyboard)` records the whole edit as one step. Emptied, a text made for
the edit leaves nothing — its shape, the arrows bound to it and their labels go back as they
were — and an existing one is deleted; `setElementText(id, "")`, the one-shot write, empties a
text through the same routine. Undo and redo do nothing meanwhile: the textarea's own undo is
the one that applies. The text deleted while it is open (`deleteSelection`, as a host writing
text whole ends an empty one) ends the session. **VERIFIED** by `ci_text_edit.rs`.

The canvas does not paint the text being typed, nor its selection frame
(`Renderer.ts@1118751f:259-267`): the editor is its only copy, so it is never on screen twice.
Its shape and bound arrows are live and follow it. What is typed goes to peers on the gesture
channel (`gestureElements`), shape included, and their copy of it is refused until the commit,
which stamps above it — a peer's delete meanwhile included; an edit that came to nothing takes
their copy instead (`ci_text_edit.rs` › peers; `e2e/liveSync.spec.ts`).

The editor (`DrawTextEditor.svelte`, arithmetic in `textEditor.ts`) is a bare textarea — no
border, padding or background — in the text's font, size, line height, alignment, colour and
opacity, in world units, placed at `textEditLayout()`'s screen point and scaled and turned by
the camera about its middle (`getTransform`, `textWysiwyg.tsx@1118751f:80-99`). It is the
text's own box: a label's is half a unit wider, free text stops 8px short of the canvas's right
edge, and it has 5% of height to spare (`:386-431`). A label or a fixed-width text wraps
(`pre-wrap`) at that width, which the engine laid it out to; free text keeps its hard lines
(`pre`). It is read again after every keystroke, camera change, style change, peer update, font
arriving and resize (`e2e/textEditor.spec.ts`, `e2e/textEditRequest.spec.ts`,
`e2e/textLayout.spec.ts`).

Escape and Ctrl/Cmd+Enter end the edit, leaving the text or the label's shape selected — nothing
with the tool locked or the autoshape tool (`App.tsx@1118751f:6446-6453`); Tab,
Shift+Tab and Ctrl/Cmd+] / [ indent and outdent the selected lines by four spaces; Ctrl/Cmd
with + − 0, without Shift, zoom the board; Ctrl/Cmd+Enter and Tab are held while an input method composes
(`:662-805`, `textEditor.test.ts`). Every other key is the textarea's, so no letter reaches a
tool or a style shortcut, and the font-size chord goes on up to the board. A press on the
style panel — its slider included, but not a field that takes typing of its own
(`isWritableElement`, `packages/common/src/utils.ts@1118751f:99-118`) unless it is in the
colour picker — or on the zoom buttons, or a middle-button pan, leaves it open
(`textWysiwyg.tsx@1118751f:947-998`); the zoom bar's fit button, which the oracle's footer
lacks, counts as a zoom button. Any other press ends it: on the board, and with the text tool
kept it only ends it (`App.tsx@1118751f:9815-9824`); on Undo or Redo, which sit beside the zoom
buttons and not among them (`components/footer/Footer.tsx@1118751f:48-62`), it ends and the
click then undoes it (`textEditor.test.ts`, `e2e/textEditor.spec.ts`). Leaving the page ends it.
Ending it gives the keyboard back to the board.

### Where the editor departs from the oracle

| divergence                                                                                                                                                                                                                | oracle                                                                                                                               | pinned by                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| The text stays selected while it is typed, so the style panel keeps working on it; its frame and handles are not drawn. A style changed meanwhile commits what was typed so far.                                          | deselects everything (`App.tsx@1118751f:6509-6510`)                                                                                  | `ci_text_edit.rs` › painting, peers; `e2e/textEditor.spec.ts` › a colour picked in the panel |
| Deleting lines shrinks the shape back, never below its height when the edit began.                                                                                                                                        | shrinks to fit in one step once the shape is taller than it was, which can take it lower (`textWysiwyg.tsx@1118751f:359-373`)        | `ci_text_edit.rs` › growth                                                                   |
| A new label left empty puts its shape back as it was, one-line growth included.                                                                                                                                           | leaves the shape grown, uncaptured until the next step (`App.tsx@1118751f:6974-7006`)                                                | `ci_text_edit.rs` › a new text left empty leaves nothing                                     |
| A new label's shape grows to one line of the widest capital or digit.                                                                                                                                                     | the widest character measured so far, which depends on what was typed before (`textMeasurements.ts@1118751f:29-44`)                  | `ci_text_edit.rs` › a new label grows its shape to one line                                  |
| The editor's colour is the stroke colour untouched, because the painter draws it untouched in both themes.                                                                                                                | inverts it in the dark theme, as its canvas does (`applyDarkModeFilter`, `textWysiwyg.tsx@1118751f:421-424`)                         | none                                                                                         |
| A peer taking the label or its shape ends the edit and what was typed goes back, as a drag of it does.                                                                                                                    | no holds                                                                                                                             | `ci_text_edit.rs` › a peer taking the shape ends the edit                                    |
| The editor listens for presses from the moment it opens, since it never opens inside one; after a press on the style panel it takes the keys back unless a field or the colour picker has them.                           | waits a frame; refocuses on the scene's next update unless a popup is open (`textWysiwyg.tsx@1118751f:897-936`, `:1008-1015`)        | `e2e/textEditor.spec.ts`                                                                     |
| Known limit: the caret goes nowhere in particular — the whole text is selected on every opening.                                                                                                                          | a click on a selected text opens it with the caret at the click (`App.tsx@1118751f:12402-12428`, `textWysiwyg.tsx@1118751f:488-555`) | none (gap)                                                                                   |
| Known limit: Ctrl/Cmd+S while typing neither ends the edit nor saves; Excalidraw JSON pasted into the editor is pasted as its text; a fixed-width text has no outline while typed; a new text is not snapped to the grid. | `textWysiwyg.tsx@1118751f:683-686`, `:558-646`; `renderTextBox`; `getTextCreationGridPoint` (`App.tsx@1118751f:7008`)                | none (gap)                                                                                   |

## Layout

One function lays a text out, `text::layout::layout_text`
(`engine/crates/draw-engine/src/text/layout.rs`), a port of `redrawTextBoundingBox`
(`packages/element/src/textElement.ts@1118751f:51-153`). Every path that lays text out goes
through it (`DrawEngine::laid_out`): the editor's commit, a peer's preview, a font size,
family, alignment or wrap change, a pasted style, `set_text_auto_resize`,
`set_text_box_width`, `fonts_loaded` and a resize handle (`bound_text_resize`, on every move
of the drag; `resize.md` › Text and labels). It wraps from the source, measures, and grows a
label's shape to hold it. Moving a shape only places its label (`layout_label`). **VERIFIED** by `ci_text_model.rs`
(every shape, growth, unwrap, rotation, the free-text anchors, style reaching a label, a font
arriving) and `e2e/textLayout.spec.ts` (a label typed into a rectangle, an ellipse and a
diamond; a family change; the SVG export).

| oracle                                                                                               | here                                                           |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `getBoundTextMaxWidth` / `MaxHeight` (`textElement.ts@1118751f:511-570`)                             | `bound_text_max_width` / `bound_text_max_height`               |
| `getContainerCoords`, `computeBoundTextPosition` (`:396-417`, `:249-324`)                            | `container_coords`, `bound_text_position` (and `layout_label`) |
| `computeContainerDimensionForBoundText` (`:492-509`)                                                 | `container_dimension_for_bound_text`                           |
| `getBoundTextElementCenter` (`linearElementEditor.ts@1118751f:1942-1960`)                            | `linear_label_center`                                          |
| `measureText` (`textMeasurements.ts@1118751f:12-27`)                                                 | `Measure::size`                                                |
| `getAdjustedDimensions` (`newElement.ts@1118751f:393-527`)                                           | `edit_anchor`                                                  |
| `offsetElementAfterFontResize` (`actionProperties.tsx@1118751f:273-292`)                             | `font_resize_anchor`                                           |
| the typing session, `handleTextWysiwyg` (`App.tsx@1118751f:6344-6515`)                               | `text_session.rs`: `update_text_edit`, `commit_text_edit`      |
| `updateWysiwygStyle`, `getTransform` (`textWysiwyg.tsx@1118751f:80-99`, `:268-450`)                  | `text_edit_layout`; `textEditor.ts` › `editorBox`              |
| `actionTextAutoResize` (`actionTextAutoResize.ts@1118751f`)                                          | `auto_resize_anchor`, `set_text_auto_resize`                   |
| `handleBindTextResize` (`textElement.ts@1118751f:155-247`)                                           | `bound_text_resize`, `keep_point`                              |
| `getApproxMinLineWidth` / `Height`, `getMinTextElementWidth` (`textMeasurements.ts@1118751f:32-104`) | `min_container_size`, `min_text_width`                         |
| `changeFontFamily` sets the family's line height (`actionProperties.tsx@1118751f:1285-1290`)         | `set_font_family`                                              |
| `FONT_METADATA`, `getVerticalOffset` (`font-metadata.ts@1118751f:35-170`)                            | `text::font::FAMILIES`, `vertical_offset`                      |
| the arrow clipped under its label (`renderElement.ts@1118751f:784-812`)                              | `paint_linear_around`                                          |
| the arrow masked under its label (`staticSvgScene.ts@1118751f:404-470`)                              | `linear_svg`                                                   |
| text painted per line on its baseline (`renderElement.ts@1118751f:626-676`)                          | `paint_text`, `text_line_placement`                            |
| text exported per line (`staticSvgScene.ts@1118751f:776-832`)                                        | `text_svg`                                                     |

`BOUND_TEXT_PADDING` is 5, as in the oracle (it was 8 here). Style applied to a shape reaches
its label for stroke colour and opacity (`actionChangeStrokeColor`, `actionChangeOpacity`;
the panel's one path, `selection_style.rs` › `style_targets`, `ci_style_reach.rs`),
except a label a peer holds: typing into a label holds the label, and every writer that
follows a shape to its label skips one that is `untouchable`, as everything else does
(`ci_text_model.rs` › a label a peer holds is left alone). Nor is a label reached without
its shape when that shape is not ours: one clicked on its own or taken by Select All in a
shape a peer holds, or a loose locked one, is neither restyled nor laid out again, and
opens no editor — laying it out would grow the shape (`style.rs` › `restylable`;
`ci_text_model.rs` › a shape a peer holds is not grown through its label, nor by typing
into its label). An edit under way when a peer takes the label or its shape ends, and what
was typed goes back (`ci_text_edit.rs` › a peer taking the shape ends the edit). A writer
stamps only what it changed, through the commit: picking the family, colour or wrap a text
already has is not an edit (`newElementWith`, `mutateElement.ts@1118751f:149-181`;
`ci_text_model.rs` › a change that changes nothing is not an edit). `set_text_auto_resize` re-routes the arrows bound to
the text it resizes (`updateBoundElements` in `actionTextAutoResize.ts@1118751f`). The cut
in an arrow's stroke follows its label as it is painted, a peer's preview included
(`ci_text_model.rs` › the cut under an arrow's label follows a peer's preview).

The web fonts (`apps/web/static/fonts/LICENSES.md`: Virgil, Excalifont, Cascadia, Nunito,
Lilita One and Comic Shanns) load when some text first asks for them; `watchFonts`
(`apps/web/src/lib/draw-chrome/fonts.ts`) then calls `engine.fontsLoaded()`, which re-measures
and re-lays every text in a family without stamping it (`ci_text_model.rs` › a loaded font
relays texts without stamping them; `fonts.test.ts`; `e2e/textLayout.spec.ts` › a font family
change, new text is written in Excalifont). `setFontFamily` lays the text out at once, in
whatever face the browser has: a family picker loads the face first
(`document.fonts.load`), as `changeFontFamily` waits for it
(`actionProperties.tsx@1118751f:1302-1356`), or a shape grown in a wider fallback keeps the
growth.

### Where layout departs from the oracle

| divergence                                                                                                                                                                                                                                                                                                                                                                                                                    | oracle                                                                    | pinned by                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A line or arrow never grows for its label: its extent is its points'. The oracle writes the new width onto an arrow, which its points then contradict.                                                                                                                                                                                                                                                                        | `textElement.ts@1118751f:127-133`                                         | `ci_text_model.rs` › an arrow's label wraps at the oracle's width      |
| A font arriving re-lays text, unstamped. The oracle only drops caches and repaints, so a box sized in a fallback keeps its size until the next edit. Arrows bound to a grown shape are re-routed at the next edit of either.                                                                                                                                                                                                  | `Fonts.ts@1118751f:106-148`                                               | `ci_text_model.rs` › fonts_loaded                                      |
| Text with no `fontFamily` (every text made before this) keeps the system stack, 1.25 lines, drawn from the top of each line, and its SVG baseline at 0.85 of the size.                                                                                                                                                                                                                                                        | `restore.ts` gives such text a family                                     | `ci_text_model.rs` › families, `ci_export.rs`                          |
| A label taller than its shape starts at the padded top, whatever its vertical alignment, when only placed (a move, a peer's patch): overflowing downward, it is still read from its first line. The oracle never meets one, because laying a label out grows its shape; here one saved before shapes grew, or in a shape resized smaller, is placed on every move.                                                            | `computeBoundTextPosition` (`textElement.ts@1118751f:249-324`) centres it | `ci_text_align.rs`, `ci_text_model.rs` › a label taller than its shape |
| Only the first load of each face of a text family is reported, and nothing when watching starts: `document.fonts.ready` resolves before any face is asked for, and reporting it re-laid every text in the fallback's widths. The UI's own faces (Inter) are ignored.                                                                                                                                                          | `Fonts.onLoaded` bails on faces it has seen (`Fonts.ts@1118751f:106-127`) | `fonts.test.ts`                                                        |
| Known limit: a sticky note is still the host's four elements (`stickyNotes.ts`). Its label grows the note, as Excalidraw's `stickynote` grows past its base height, but the locked shadow and the date do not follow. The sticky package makes it one element with a painted shadow and footer.                                                                                                                               | one `stickynote` element (`packages/element/src/stickyNote.ts@1118751f`)  | none (gap)                                                             |
| No `direction` on exported or painted text: right-to-left text is laid out left to right.                                                                                                                                                                                                                                                                                                                                     | `staticSvgScene.ts@1118751f:776-832`                                      | none (gap)                                                             |
| A line can carry a label here, and its stroke is cut under it as an arrow's is.                                                                                                                                                                                                                                                                                                                                               | only arrows take labels                                                   | `ci_export.rs`                                                         |
| The SVG export names each text's family but embeds no `@font-face`, so a viewer without the font draws the fallback.                                                                                                                                                                                                                                                                                                          | `Fonts.generateFontFaceDeclarations`                                      | none (gap)                                                             |
| Liberation Sans is not shipped: the file Excalidraw ships is Liberation 1.05 (name IDs 0 and 5), under Red Hat's agreement granting the GPL v2 with a font exception (`liberation-fonts@eba8555b`, `source/License.txt`), not the OFL, which covers 2.00 and later only (its `ChangeLog`, 2012-07-06). Nor are Xiaolai, emoji, or non-Latin shards: out of scope. Text asks for them and draws in the next face of its stack. | `packages/excalidraw/fonts/`                                              | `apps/web/static/fonts/LICENSES.md`                                    |
