# Resize

Markers: **OBSERVED**, **VERIFIED**, **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

## Measure from the start of the gesture

**VERIFIED** — every resize path must derive from state captured when the drag began,
never from the live element. The live element has already been transformed by every
earlier move of the same gesture, so reading it compounds.

**OBSERVED** — the group path read its points live. Four moves put a drawing's ring
**499 units outside a 200-unit box**; the box itself was right. `GroupOrigin` was
`#[derive(Copy)]`, a `Vec` cannot be `Copy`, so the ring had nowhere to be captured.

**A single-move drag cannot see this.** One move gives the live value and the captured
one the same number. Every resize test drags in several steps, and keeps a single-move
case as a control that must still pass.

## The grab offset

**VERIFIED** — a handle's centre sits `handle_offset` (4px frame margin + half an 8px
handle) outside the corner it moves. The press records where it was taken from that
corner, or from the side's middle for a side (`grab` on `Interaction::Resize` and
`ResizeGroup`, measured from the unsnapped press), and every move takes it off the pointer
before the grid snaps it, as the oracle does (`getResizeOffsetXY`,
`packages/element/src/resizeElements.ts@1118751f:497-554`, taken at
`App.tsx@1118751f:9406-9416` and applied at `:13578-13582`). So the edge moves exactly as
far as the pointer, turned or not, one element or a group, and never jumps on the first
pull (`ci_handles.rs` › where in the handle it was taken; `ci_group_resize.rs` › a group's
handle taken where it is drawn does not jump; `e2e/textResize.spec.ts`).

**OBSERVED** before: the corner went to the raw pointer, so a handle jumped 8px on the
first pull. An earlier version of this page said the oracle's jumps too; it does not.

## Text and labels

**VERIFIED** — a free text (`resizeSingleTextElement`,
`packages/element/src/resizeElements.ts@1118751f:317-409`):

- a corner scales the font and the box by the height it is given, from where the last
  move left them; the lines are the same lines. A drag that would take the font below 1
  (`MIN_FONT_SIZE`), through the anchor included, leaves the text as the last move had it:
  a text is never mirrored;
- a side (east or west) fixes the width (`autoResize` false) and wraps the source
  (`originalText`) at it through `text::layout::layout_text`, never narrower than a space
  and the padding (`getMinTextElementWidth`, `textMeasurements.ts@1118751f:46-51`);
  widening it again unwraps;
- the corner or side opposite the handle stays put, turned or not (`getResizedOrigin`);
- a text shows its four corners and the rotation handle only (`DEFAULT_OMIT_SIDES`,
  `transformHandles.ts@1118751f:57-62`, `:112-131`); its sides are taken on the frame line, within 4
  screen pixels of it (`SIDE_RESIZING_THRESHOLD`, `resizeTest.ts@1118751f:96-121`), and the
  hover cursor says so.

**VERIFIED** — a shape holding a label (`resizeSingleElement`, `:729-986`):

- it is never made narrower than the widest character of the label's font nor lower than
  one of its lines, each plus the padding (`:778-803`), and the label is laid out again on
  every move (`handleBindTextResize`, `textElement.ts@1118751f:155-247`): narrowing wraps
  it, widening unwraps it, and a label that needs more room than it has grows the shape
  back from the side the drag holds (the bottom for a north handle, the top otherwise, the
  other way round once the drag has turned the shape through its anchor);
- a label with `wrap` false keeps its lines;
- with Shift (or an image's locked proportions) there is no minimum: the label's font
  scales with the room it has, an arrow's with its width (`:815-833`, `:904-915`).

**VERIFIED** — several elements (`resizeMultipleElements`, `:1209-1594`): they scale as one
— as with Shift — when any of them is turned, is a text, or is in a group
(`:1370-1377`); a text's font scales with it and a label's does too when they scale as one,
otherwise it keeps its size (`:1491-1514`); a font that would fall below 1 stops the move.
Every label is laid out again in its resized shape. The frame the drag scales is the
union of what was selected, its labels excluded (the oracle's counts an arrow's label,
`getNextMultipleWidthAndHeightFromPointer`, `:1101-1131`; here an arrow's label is left out
of the frame too, as the drawn frame leaves it out).

**VERIFIED** — a resize stamps nothing while it moves: the shape and its label are stamped
once each, by the commit (`ci_text_resize.rs` › a drag stamps the shape and its label once).

**MEASURED** — `cargo bench -p draw-engine --bench text -- resize_label` (a 400 × 300
shape, a 2,000-character label, twenty moves, the host estimate for measuring):

| drag               | before (lines kept, label only moved) | after (laid out on every move) |
| ------------------ | ------------------------------------- | ------------------------------ |
| east (new width)   | 17.2 µs                               | 2.26 ms (113 µs a move)        |
| south (same width) | 17.1 µs                               | 214 µs (11 µs a move)          |

The east drag wraps 2,000 characters at a new width on every move; the south drag's lines
come out of the wrap memo after the first move. Both are far inside a 16 ms frame.

### Divergences

| what                                      | Excalidraw                                                                                                                                  | here                                                                                                                                                                                                                                                                   | pinned by                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| a text narrowed by its side               | stops at a space's width; a glyph wider than the box hangs out of it (`resizeElements.ts@1118751f:360-408`)                                 | also stops at the widest glyph the wrapped lines hold, so the box always holds its ink                                                                                                                                                                                 | `ci_text_resize.rs` › a side stops at the widest glyph                |
| a labelled shape's minimum width          | the widest character measured so far in that font (`getMaxCharWidth`, the `charWidth` cache, `textMeasurements.ts@1118751f:32-104`)         | the widest of `A`–`Z` and `0`–`9` in the label's font, every time: the oracle's number depends on what that session happened to measure                                                                                                                                | `ci_text_resize.rs` › a labelled shape stops at one char of its label |
| a north or south drag of a labelled shape | lays the label out only when the width it wraps at changed                                                                                  | lays it out on every move; the lines come out of the wrap memo, so it costs no measuring (bench above)                                                                                                                                                                 | `ci_text_resize.rs` › a north handle grows the shape from its bottom  |
| a label too wide for a narrowed shape     | grows the shape's height only (`handleBindTextResize`)                                                                                      | also widens the shape to hold a line that cannot wrap, from the side a west handle holds. A rectangle's minimum keeps a drag from needing it; an ellipse's or a diamond's text box is narrower than the shape, and a label with `wrap` false does not fit a narrow one | `ci_text_resize.rs` › a labelled shape stops at one char of its label |
| the sides of anything but a text          | on a desktop no element has side handles: every one takes its sides on the frame line (`resizeTest.ts@1118751f:62-121`); a phone draws them | a shape keeps its drawn side handles; only a text, as the oracle's desktop does, has none and takes its sides on the frame line                                                                                                                                        | `ci_handles.rs` › a text's handles                                    |
| a fixed-width text's reset handle         | a small handle right of a fixed-width text puts it back to auto width (`textAutoResizeHandle.ts@1118751f`)                                  | **gap**: not drawn, and nothing in the app calls the engine's `setTextAutoResize`, so a fixed-width text cannot go back to auto width                                                                                                                                  | none                                                                  |
| a side of a multi-selection               | taken on the frame line (`resizeTest.ts@1118751f:62-121`)                                                                                   | **gap**: the group frame has corners only                                                                                                                                                                                                                              | none                                                                  |
| a turned element in a flipped group       | its angle is negated when the group is dragged through its anchor (`resizeElements.ts@1118751f:1417-1420`)                                  | **gap**: the angle is kept                                                                                                                                                                                                                                             | none                                                                  |
| Alt: resize from the centre               | Alt scales about the centre (`shouldResizeFromCenter`)                                                                                      | **gap**: not ported, for any element                                                                                                                                                                                                                                   | none                                                                  |

## Corner radius

**VERIFIED** — our handle writes an explicit radius into `corner_radius`; absent means
the adaptive corner (`min(shortSide/4, 32)`), exactly as before. The oracle has the slot
(`roundness.value`) but no UI.

**IMPLEMENTATION DETAIL, divergent** — ours runs to half the short side (a pill); the
oracle caps at a quarter.

**VERIFIED** — a radius drag is measured from the grab, not the corner, because the
handle is drawn at `max(radius, 12px)`: on a small radius it sits further in than the
radius it controls, and measuring from the corner would jump.

**VERIFIED** — the radius is in the geometry fingerprint. Left out, both render caches
would serve the old outline and the handle would appear to do nothing.

**OBSERVED** — the SVG exporter wrote `rx = roundness` (the ignored `8`) while the canvas
drew 32. It now calls the same `corner_radius` the canvas does.

## Flip

Shift+H / Shift+V, the context menu and the panel's mirror buttons all call
`flip_selection` (`engine/crates/draw-engine/src/edit/flip.rs`). Excalidraw flips through
`resizeMultipleElements` with `flipByX | flipByY`, a scale of 1 and the middle of the
selection as the anchor (`actions/actionFlip.ts`, `element/src/resizeElements.ts:1209-1569`
at the oracle SHA). Pinned by `tests/ci_flip.rs` (every kind, round trips, undo) and
`e2e/flip.spec.ts` (keys, pixels, saved scene).

**VERIFIED** — what flips is what a drag would move (`moving_selection`): a frame's
children and a locked member of a selected group come along (`actionFlip.ts:87-94`,
`groups.ts:94-132`). Nobody changes frame (`frame.ts:845-855`).

**VERIFIED** — the mirror line is the middle of what flips as it is drawn, turned, plus
the words on an arrow (`getCommonBoundingBox`, `actionFlip.ts:131`;
`resizeElements.ts:1280-1310`). Each kind is measured the way the oracle's
`getElementBounds` measures it (`bounds.ts:147-240` at 1118751f), in
`scene/geometry.rs` › `element_outline_bounds`: an ellipse by its own curve, a diamond by
its four corners, a line, arrow or freehand stroke by its turned points, anything else by
its turned box. The unturned boxes put the line in the wrong place whenever a turned
element was in the selection, and the turned box for every kind still did for a turned
ellipse, diamond, line or stroke — 70 units off for a line stood on end
(`ci_flip.rs` › `the_axis_is_what_each_kind_draws`).

**VERIFIED** — each kind, as the oracle does it (`resizeElements.ts:1409-1497`):

| kind                                            | after a flip                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| rectangle, ellipse, diamond, frame, embed, text | reflected position, **same** width and height, negated angle — the stroke, hatching and glyphs are not mirrored       |
| image                                           | reflected, and its extent goes negative on that axis — the pixels mirror (see `images.md` › Flip)                     |
| line, arrow                                     | points mirrored about the origin, `x` reflected, width negated as before (`packages/contract/src/bounds.ts` reads it) |
| freehand stroke                                 | points mirrored inside its own box, box reflected                                                                     |
| label                                           | not flipped itself; follows its container, turned with it                                                             |

An embed's page is never mirrored: Excalidraw only turns the iframe (`App.tsx:2046-2051`),
and a mirrored video would show its controls and captions backwards. A text turned by
0.3 comes back turned by -0.3, the same turn as excalidraw.com's 2π − 0.3; it used to keep
its angle. The angle is negated and not normalised into `[0, 2π)` as the oracle's
`normalizeRadians` does, so a second flip gives back the original number exactly.

A flip that moves nothing — a lone unturned box, which is its own mirror image — is not an
edit: no new version, nothing saved or sent, no step of undo, as the oracle's
`mutateElement` keeps the version when no value changed (`mutateElement.ts:129-131`).
`apply_patches` drops such a patch for align, distribute and lock as well
(`ci_flip.rs` › `a_flip_that_changes_nothing_is_not_an_edit`).

**VERIFIED** — arrows:

- a selection made only of bound arrows turns them round: the resolved heads trade ends
  and nothing moves (`actionFlip.ts:116-129`);
- an arrow flipped with the shape an end is bound to keeps that binding, its anchor
  mirrored in the shape's frame (`[1 − fx, fy]` for H, `[fx, 1 − fy]` for V);
- an end bound to a shape that did not flip lets go (`resizeElements.ts:1558-1569`);
- an arrow that did not flip, bound to a shape that did, keeps its anchor and follows the
  shape (`updateBoundElements`).

### Divergences

| what                               | Excalidraw                                                                                                                                                                                                              | here                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| anchors of a straight/curved arrow | mirrored for elbow arrows only (`resizeElements.ts:1446-1474`). The path is mirrored but the anchors are stale, so the arrow jumps back to the old sides when a bound shape next moves — **OBSERVED** on excalidraw.com | mirrored for every arrow. Every bound arrow is re-resolved right after a commit here, so stale anchors would undo the flip at once |
| arrows-only check                  | counts an arrow's label (`getSelectedElements` with `includeBoundTextElement`, `actionFlip.ts:87-94`), so a labelled arrow flipped alone is mirrored and let go of both shapes                                          | labels are not counted: a labelled bound arrow alone turns round like any other                                                    |
| re-centring after the flip         | moves the selection back onto its old middle (`actionFlip.ts:158-192`): a curved arrow is measured by its rendered curve, which can bump the box by a pixel                                                             | not ported: boxes are measured from points, which mirror exactly; `ci_flip.rs` › `every_kind_round_trips` guards drift             |
| an image's mirror                  | a `scale: [sx, sy]` field                                                                                                                                                                                               | a negative width or height, painted and exported as the same scale — `images.md` › Flip                                            |
| a line's reach                     | its rendered rough path (`getLinearElementRotatedBounds`, `bounds.ts:934-995`), which can wander a pixel or so off its points, and a curve's bulge past them                                                            | its points: the line through a curved arrow's bulge can differ by as much as the bulge                                             |

**Open** — a box resized past its own corner (single element) still mirrors its stroke
through a negative extent (`ci_selection.rs`), where the oracle's stays positive. Flip
keeps whatever sign a box already has, so it neither introduces nor removes one.

**Open** — the frame drawn round a multi-selection (`group_box`, from `scene_bounds`) is
the union of the **unturned** boxes, where the oracle's comes from the same turned bounds
as its mirror line. So with a turned element in the selection the frame and its handles
shift sideways on a flip, and shift back on the next one: a 200×20 bar stood on end beside
a box at 300..350 has its frame at 0..350 before a horizontal flip and 90..440 after, where
excalidraw.com's stays at 90..350. The mirror line is right; the frame is what is off, and
making it turned-aware is a change to every selection frame, not to flip.
