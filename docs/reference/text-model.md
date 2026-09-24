# Text model

Confidence markers: **OBSERVED** (seen in the running app), **VERIFIED** (read in the
pinned source _and_ observed), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

Oracle pinned at `scripts/oracle-sha.txt`. The fields below are data only: nothing in the
engine lays text out, measures or paints with them yet.

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
| `wrap`         | boolean                     | a label wraps inside its shape              | none yet               | none, see below                                        |

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

**Not yet.** A text without `originalText` gains none when edited here: its `text` is still the
source, and an old board edited by this engine saves the fields it always did. The layout
package writes the field for every text, together with wrapping from `source_text`. Until then
an element that carries one can only come from a newer client.

## The editor overlay

The overlay's font size is `fontSize × zoom% / 100`, and it is never NaN. `screenFontPx` in
`apps/web/src/lib/draw-chrome/camera.ts` falls back to the element's own size
(`engine.getFontSize()`), then to 20.

The request carries the box the canvas wraps the lines in: its width is `wrap_width`, the one
function `with_text` wraps with, and its left edge puts the lines' anchor where the painter puts
it (`text_anchor_x`). For a shape's label and a fixed-width column that box is the element
itself. For an arrow's label it is not: the label is an 8-unit placeholder on the arrow's middle,
while its lines wrap at the arrow's width less the padding, so the box is that width around the
middle. The overlay's text box is exactly that width, with the padding and border outside it and
no minimum for a label, so it wraps where the canvas does, however narrow the shape
(`ci_text_model_compat.rs` › an arrow label's editor is the box its lines wrap in;
`e2e/textEditRequest.spec.ts` › a narrow shape's label, an arrow's label).

**Divergence, until the layout package.** An arrow's label wraps at the arrow's horizontal
extent less 16, so a steep arrow's label wraps at 8 units, a character a line, on the canvas and
in the editor alike. The oracle wraps it at `max(0.7 × width, 11 × fontSize)`
(`packages/element/src/textElement.ts:511-520`). A fixed-width free text still opens the
measured, unwrapped editor: only a label's editor wraps.

**ponytail.** The chrome is 14px because the 1.5px border is drawn as 1px at a device pixel
ratio of 1. At a ratio of 2 the text box is 1px narrower than the label. The overlay still
starts about 7px right of the canvas text and ignores rotation. That is the editor rewrite's job,
and it drops the border.
