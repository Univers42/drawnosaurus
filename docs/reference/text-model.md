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

| field          | contract                    | absent means                                | resolver               | oracle                                                 |
| -------------- | --------------------------- | ------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `originalText` | string, ≤ `MAX_TEXT_LENGTH` | `text` is the source                        | `source_text`          | `originalText`; restore `\|\| text` (`restore.ts:572`) |
| `fontFamily`   | integer 1..=64              | the system stack (`render::FONT_FAMILY`)    | `resolved_font_family` | `fontFamily`, same numeric ids                         |
| `lineHeight`   | finite 0.5..=4              | the family's own, 1.25 for the system stack | `resolved_line_height` | `lineHeight`                                           |
| `wrap`         | boolean                     | a label wraps inside its shape              | none yet               | none, see below                                        |

**INFERRED** (read in the pinned source, not observed on excalidraw.com): the known family
ids and their line heights are the oracle's (`packages/common/src/constants.ts:131-141`,
`packages/common/src/font-metadata.ts:35-104`). Virgil 1, Excalifont 5, Nunito 6 and Comic
Shanns 8 use 1.25. Helvetica 2, Lilita One 7 and Liberation Sans 9 use 1.15. Cascadia 3 uses
1.2. The oracle's 4 is retired and its 10 (Assistant) is private to its own UI, so neither
counts as known here.

## Decisions

**Divergence, deliberate.** The engine keeps a family id it does not know (0, 4, 10, 64, 99…)
and never rewrites it, but it draws that text with the system stack. Keeping the id lets a
newer client's font survive a trip through this one. The contract allows up to 64 for the same
reason. For an unknown id the oracle falls back to Excalifont's metrics (1.25, the same number)
and to the emoji font for the face (`packages/common/src/utils.ts:123-136`).

**Divergence, deliberate.** A line height outside 0.5..=4, or one that is not finite, is
ignored rather than clamped, and the family's own is used. The contract refuses such values,
so only a file or a peer can carry one. The oracle has no range. Its restore replaces only a
missing or zero line height, and for legacy elements it detects one from the height
(`restore.ts:557-564`). We do not detect: our legacy text was always drawn at 1.25, which is
what `None` resolves to.

**IMPLEMENTATION DETAIL.** `fontFamily` is a `u8`. A value the field cannot hold (300, -1,
1.5, a string) makes the whole document invalid, the same as any other ill-typed field:
`elements_from_json` returns `None` and `load_scene` returns `false`. Nothing panics
(`ci_text_model_compat.rs` › a family the field cannot hold refuses the document). The contract
never stores such a value.

**Divergence, no oracle equivalent.** `wrap` only means something on a label. When it is
absent or `true`, the label wraps inside its shape, which is the oracle's only behaviour.
When it is `false`, the label keeps its hard lines and its shape grows wide enough to fit them.
Free text says the same thing with `autoResize`, as in the oracle.

**Not yet.** `set_element_text` does not write `originalText`. The layout package does that,
together with wrapping from `source_text`. Until then nothing produces the field, so an
element that carries one can only come from a newer client.

## The editor overlay

The overlay's font size is `fontSize × zoom% / 100`, and it is never NaN. `screenFontPx` in
`apps/web/src/lib/draw-chrome/camera.ts` falls back to the element's own size
(`engine.getFontSize()`), then to 20. For a label, the text box is the label's width and the
padding and border sit outside it, so it wraps where the canvas does.

**ponytail.** The chrome is 14px because the 1.5px border is drawn as 1px at a device pixel
ratio of 1. At a ratio of 2 the text box is 1px narrower than the label. The overlay still
starts about 7px right of the canvas text and ignores rotation. That is the editor rewrite's job,
and it drops the border.
