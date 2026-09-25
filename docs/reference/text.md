# Text wrapping

Markers: **OBSERVED**, **VERIFIED**, **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

## One wrapper, ported from the oracle

**VERIFIED**: every soft wrap in the engine goes through one function,
`text::layout::layout_text` (`engine/crates/draw-engine/src/text/layout.rs`, see
`text-model.md` › Layout), which wraps with `Measure::wrap` over the memo. It runs whenever a
text's words or its room change: `set_element_text` (the editor's commit), `text_preview`
(what peers see while it is typed), `set_text_box_width`, a font size, family or alignment
change, a pasted style, the label wrap and auto-resize switches, and `fonts_loaded`. The wrap itself is `crate::text`
(`engine/crates/draw-engine/src/text/`), a line-for-line port of Excalidraw's
`packages/element/src/textWrapping.ts` at the pinned SHA:

- `parse_tokens`: the oracle's break rules and emoji sequences;
- `wrap_text` / `wrap_lines`.

The old wrapper split on single spaces and broke a long word by re-measuring each longer
prefix. **OBSERVED**: it matched the oracle on only 517 of the 2,407 cases the engine
path is checked on; 1,890 differed.

## A resize rewraps

**VERIFIED**: a resize handle lays text out through the same `layout_text`, on every move of
the drag, from the source (`originalText`), so widening unwraps and narrowing wraps and grows
the shape:

- **a free text's side** fixes its width and wraps it there (`resizeSingleTextElement`,
  `resizeElements.ts@1118751f:360-408`); a corner scales its font and keeps its lines;
- **a shape's handle** lays its label out in the new room, never narrower than a character
  of it nor lower than a line (`handleBindTextResize`, `textElement.ts@1118751f:155-247`;
  `resizeSingleElement`, `resizeElements.ts@1118751f:778-803`);
- **several elements** scale their texts' fonts and lay their labels out again
  (`resizeMultipleElements`, `resizeElements.ts@1118751f:1499-1514`).

The rules, the divergences and the cost per move are in `resize.md` › Text and labels
(`ci_text_resize.rs`, `e2e/textResize.spec.ts`).

## How it is held to the oracle

**VERIFIED**: `engine/tools/text-oracle/generate.mjs` runs the oracle's own
`textWrapping.ts` and `textMeasurements.ts`, unmodified, under Node's type stripping.
`make oracle-fixtures` runs it in `mcr.microsoft.com/playwright:v1.63.0-noble`. Before
writing anything it checks its output against 63 oracle expectations and exits 2 on any
mismatch: the 43 unit tests in `textWrapping.test.ts`, the CJK sentence cases, and
invalid widths, offsets and tokens. It refuses a checkout that is not at the pin.

`tests/ci_text_wrap_oracle.rs` replays the fixture. Every case must match exactly:

| Check                                             | Cases                                          |
| ------------------------------------------------- | ---------------------------------------------- |
| `wrap_text`, three width models                   | 3,049 (`jsdom` 791, `table` 1,473, `kern` 785) |
| `wrap_lines` offsets (texts NFC leaves alone)     | 2,090                                          |
| `parse_tokens`                                    | 9,219 lines                                    |
| the engine path (`set_element_text`, fixed-width) | 2,407                                          |

The three width models:

- **`jsdom`** gives every UTF-16 unit 10 px, what the oracle's own tests run under.
- **`table`** gives each code point its own width, and adds them up.
- **`kern`** is `table` plus pair kerning on whole-line measures only. A port that sums
  char widths where the oracle measures a whole line, or the reverse, fails it.

The engine path skips widths under 8 (the engine never gives a column less) and texts
of only whitespace (`set_element_text` deletes those).

**VERIFIED**: the fixture catches a broken port. Four mutations, each applied alone and
then reverted, each failed it:

| Mutation                                           | What failed                       |
| -------------------------------------------------- | --------------------------------- |
| no NFC                                             | 775 wrap cases, 1,162 token lines |
| `wrapWord` measuring whole prefixes (kerned)       | 8 `kern` cases, 7 offsets         |
| `<` for `<=` in `wrapLine`                         | 193 wrap cases, 146 offsets       |
| Rust's `char::is_whitespace` in place of JS's `\s` | 134 wrap cases, 26 token lines    |

**VERIFIED**: `tests/ci_text_wrap_props.rs` checks what the fixture cannot:

- offsets lead back to the source;
- no line is wider than the width unless it holds an emoji;
- measuring stays linear in the text length;
- the memo answers a rewrap, and stays bounded in lines and in bytes.

## Measuring

**VERIFIED**: a hook call is a `measureText` round trip across the wasm boundary, so the
engine keeps a `MeasureCache` (`text/measure.rs`). It holds:

- **char widths**, per font and per char;
- **wrapped hard lines**, per font and width;
- **line widths**, per font and line, capped at 4 × `MEMO_LIMIT` lines and `MEMO_BYTES`.

A font is its size and family (`FontKey`); the hook the browser answers is
`measure_font_line`, which sets the canvas font to the family's stack
(`text::font::font_string`) only when it changes.

The wrapped lines are capped at `MEMO_LIMIT` = 4,096 hard lines and at `MEMO_BYTES` =
1 MiB of text (each hard line, its wrapped lines and their structs). The whole memo
clears when either fills. The engine clears the whole cache when its measure hook is
replaced.

The byte cap is there because, with a peer watching, every keystroke into a label is
previewed, and each preview memoises the whole hard line typed so far. **OBSERVED** with
a byte-counting allocator, wrapping every prefix of a 9,980-char paragraph at 290 px
through the memo, as typing it into a label does:

- **Capped by count only**: 50.7 MB live in the memo afterwards, 78.9 MB at the peak.
- **Capped by bytes too**: 0.5 MB live, 1.1 MB at the peak.

Wasm memory never shrinks, so the peak is what the page keeps.

What is measured, and how, follows the oracle:

- a token of one UTF-16 unit adds its cached char width;
- anything longer is measured whole, kerning included;
- `wrapWord` and trailing whitespace add unkerned char widths.

**OBSERVED** in `the_engine_measures_linearly_and_remembers`:

- **The old wrapper**, on a 5,000-char word in a 300 px column: 5,003 hook calls over
  95,058 chars.
- **The port**: 15 calls over 15,252 chars.
- **Setting the same text again**: 1 call. That call measures the element's size; the
  wrap comes from the memo.

## Where the port departs from the oracle

**IMPLEMENTATION DETAIL, divergent**:

- **Char widths are cached per full char.** The oracle keys its cache by the first UTF-16
  unit (`textMeasurements.ts:179-208`). So there, two astral chars with the same high
  surrogate share whichever width was measured first. This only shows in `wrapWord` and
  trailing whitespace; a lone astral token is measured whole. The fixture's `table` model
  gives astral chars their width by high surrogate, so the difference cannot show there.
- **Offsets point into the source text.** `getWrappedTextLines` reports code units of
  the NFC text (`textWrapping.ts:378-381`). `WrappedLine` reports byte ranges of the
  source instead, even where NFC rewrote the line. Inside a segment NFC rewrote, only
  its edges map back exactly: the segment counts as the earlier line's.
- **NFC comes from two places.** In the browser it is the platform's
  `String.prototype.normalize`, which is what the oracle calls. Natively, for tests and
  benches, the `unicode-normalization` crate stands in. Only a hard line that wraps is
  normalised, as in the oracle; a line that fits is kept verbatim.

**VERIFIED**: the measure hook returns the browser's width, with no floor (the old 4 px
floor went with `measure_via_ctx`).

**VERIFIED**: the oracle clears a font's char widths when that font finishes loading
(`fonts/Fonts.ts@1118751f:136`). Here the host calls `engine.fontsLoaded()` on the first
`loadingdone` of each face of a text family, and never on `document.fonts.ready`, which
resolves before any face is asked for (`apps/web/src/lib/draw-chrome/fonts.ts`,
`text-model.md` › Divergences); it clears the whole cache and re-lays every text in a
family, unstamped (`text-model.md` › Layout).

## Unicode version

**VERIFIED**: the character classes in `text/unicode.rs` are evaluated by the regex
engine the oracle runs on. They are generated by Node v24.20.0 (Unicode 17.0), and the
file's header records this. The NFC tables come from the same Node.

**UNKNOWN**: how a browser on an older Unicode classifies chars assigned since then. The
tables are regenerated with the fixture, never by hand.

## Size

**VERIFIED**, from `make wasm` output (`engine/pkg/draw_engine_bg.wasm`, sizes in bytes):

| Build                                              | Raw       | gzip -9 |
| -------------------------------------------------- | --------- | ------- |
| Before the port                                    | 1,355,882 | 425,847 |
| With the port (NFC from the platform)              | 1,392,722 | 437,172 |
| With the port, `unicode-normalization` in the wasm | 1,518,262 | 507,815 |

Adding the crate to the wasm would cost another 125,540 bytes (70,643 gzipped) for what
the browser already does. That is why the crate is a native-only dependency.

The two builds with the port are engine `f1ec4d5`. The memo's byte cap came after:
1,392,949 bytes (437,346 gzipped) with NFC from the platform.
