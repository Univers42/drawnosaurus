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

**VERIFIED** — a handle is hit where the pointer is. A press tests the resize, rotation,
radius and point handles, a text's sides and a group's corners at the raw pointer, as the
hover cursor does and as the oracle does (`pointerDownState.origin`,
`App.tsx@1118751f:9220`, `:9366-9404`); only the positions the drag produces are snapped.
Hit at the grid-snapped point, a handle a few pixels off a grid line showed its cursor and
a press on it moved the shape instead (`ci_handles.rs` › with the grid on a press takes the
handle the cursor shows).

**VERIFIED** — a line, an arrow or a stroke is resized from the box its handles are drawn
on, its points' own box, as the oracle's is (`previousOrigin`,
`resizeElements.ts@1118751f:848-851`). Its `x`, `y` is its first point, which need not be a
corner: resized from there, a handle taken where it is drawn flattened a line whose first
point was not its top-left (`ci_handles.rs` › a line's handle does not jump when its first
point is no corner).

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
  widening it again unwraps, and "Enable text auto-resizing" in the context menu or Grow
  in the panel's Text wrap row gives it its own width back. The width kept is the one the
  lines were wrapped at
  (`:398-405`), so laying them out again — a face arriving, an edit — gives the same
  lines, and a glyph wider than it hangs out of the box, as it does there (`ci_text_resize.rs`
  › a glyph wider than the box hangs out of it);
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
  scales with the room it has from where the last move left it, an arrow's with its width
  (`:815-833`, `:904-915`). A move without Shift lays the label out at the font it had when
  the drag began (`:805-814`), so letting go of Shift mid-drag gives it back
  (`ci_text_resize.rs` › letting go of shift gives the label its font back).

**VERIFIED** — several elements (`resizeMultipleElements`, `:1209-1594`): they scale as one
— as with Shift — when any of them is turned, is a text, or is in a group
(`:1370-1377`); a text's font scales with it and a label's does too when they scale as one,
otherwise it keeps its size (`:1491-1514`); a font that would fall below 1 stops the move.
Every label is laid out again in its resized shape. The frame the drag scales is the frame
that is drawn and hit-tested: what the selection carries, a label included when the
selection carries it, as a group's are (a click on a group selects its labels). The labels
of the other shapes ride inside it. So the corner opposite the handle holds where it is
drawn (`ci_text_resize.rs` › a group's drawn corner holds with an arrow's label past its
shapes). A label someone else deleted, which its shape can still name after concurrent
edits, is left out and laid out by no resize (`ci_text_resize.rs` › a deleted label is left
out of a resize of several).

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
Measured again once the smallest room read its chars from the cache: the same 2.26 ms and
214 µs, because the bench's estimate makes a measure free. In a browser each measure is a
`measureText` call across the wasm boundary, and a warm move now makes none
(`ci_text_resize.rs` › a warm resize measures nothing).

### Divergences

| what                                          | Excalidraw                                                                                                                                                                                                                             | here                                                                                                                                                                                                                                                                           | pinned by                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a labelled shape's minimum width              | the widest character measured so far in that font (`getMaxCharWidth`, the `charWidth` cache, `textMeasurements.ts@1118751f:32-104`)                                                                                                    | the widest of `A`–`Z` and `0`–`9` in the label's font, every time: the oracle's number depends on what that session happened to measure                                                                                                                                        | `ci_text_resize.rs` › a labelled shape stops at one char of its label                                                                                                                                                                                                     |
| a north or south drag of a labelled shape     | lays the label out only when the width it wraps at changed                                                                                                                                                                             | lays it out on every move; the lines come out of the wrap memo and the smallest room's chars out of the char-width cache, so a warm move asks the host to measure nothing (bench above)                                                                                        | `ci_text_resize.rs` › a north handle grows the shape from its bottom; a warm resize measures nothing                                                                                                                                                                      |
| a label too wide for a narrowed shape         | grows the shape's height only (`handleBindTextResize`)                                                                                                                                                                                 | also widens the shape to hold a line that cannot wrap, from the side a west handle holds. A rectangle's minimum keeps a drag from needing it; an ellipse's or a diamond's text box is narrower than the shape, and a label with `wrap` false does not fit a narrow one         | `ci_text_resize.rs` › a labelled shape stops at one char of its label                                                                                                                                                                                                     |
| an arrow's label in a multi-selection's frame | counted in the frame drawn and scaled, grouped or not (`getElementBounds` → `getLinearElementRotatedBounds`, `bounds.ts@1118751f:175`, `:934-990`; `getNextMultipleWidthAndHeightFromPointer`, `resizeElements.ts@1118751f:1101-1131`) | counted, in both, only when the selection carries it, as a group's are; the frame of a loose selection, drawn and scaled alike, leaves an arrow's label out                                                                                                                    | `ci_text_resize.rs` › a group's drawn corner holds with an arrow's label past its shapes                                                                                                                                                                                  |
| the sides of anything but a text              | on a desktop no element has side handles: every one takes its sides on the frame line (`resizeTest.ts@1118751f:62-121`); a phone draws them                                                                                            | a shape keeps its drawn side handles; only a text, as the oracle's desktop does, has none and takes its sides on the frame line                                                                                                                                                | `ci_handles.rs` › a text's handles                                                                                                                                                                                                                                        |
| a fixed-width text's reset handle             | a small handle right of a fixed-width text puts it back to auto width (`textAutoResizeHandle.ts@1118751f`)                                                                                                                             | **gap**: not drawn. The way back is the oracle's other one, "Enable text auto-resizing" in the context menu (`actionTextAutoResize.ts@1118751f`), or Grow in the panel's Text wrap row: both are `setTextAutoResize(true)`, the typed lines measured and the aligned edge held | `ci_text_resize.rs` › a side-resized text takes its own width back; `e2e/textResize.spec.ts` › from the menu, or from the wrap row                                                                                                                                        |
| a side of a multi-selection                   | taken on the frame line (`resizeTest.ts@1118751f:62-121`)                                                                                                                                                                              | a discrete drawn handle — the same divergence as the row above, extended to a group rather than adding a second, frame-line way of taking a side; hidden below `minimumSizeForEightHandles` on that axis, as the oracle's is                                                   | `ci_group_resize.rs` › the_groups_east_handle_resizes_it_along_one_axis, a_cardinal_handle_is_hidden_on_a_tiny_selection; `e2e/multiSelect.spec.ts` › a side handle on the group frame                                                                                    |
| a turned element in a flipped group           | its angle is negated when the group is dragged through its anchor (`resizeElements.ts@1118751f:1417-1420`)                                                                                                                             | **gap**: the angle is kept                                                                                                                                                                                                                                                     | none                                                                                                                                                                                                                                                                      |
| Alt: resize from the centre                   | Alt scales about the centre (`shouldResizeFromCenter`)                                                                                                                                                                                 | ported, one element or several, composed with Shift's aspect lock (`self.alt_held`, read live during every resize move)                                                                                                                                                        | `ci_selection.rs` › alt_resizes_a_single_element_from_its_centre, shift_and_alt_compose_on_a_single_element; `ci_group_resize.rs` › alt_resizes_a_group_from_the_frames_centre; `ci_text_resize.rs` › alt_resizes_a_free_text_from_its_centre; `e2e/resizeCenter.spec.ts` |

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
selection as the anchor (`actions/actionFlip.ts`, `element/src/resizeElements.ts@1118751f:1209-1569`
at the oracle SHA). Pinned by `tests/ci_flip.rs` (every kind, round trips, undo) and
`e2e/flip.spec.ts` (keys, pixels, saved scene).

**VERIFIED** — what flips is what a drag would move (`moving_selection`): a frame's
children and a locked member of a selected group come along (`actionFlip.ts@1118751f:87-94`,
`groups.ts@1118751f:94-132`). Nobody changes frame (`frame.ts@1118751f:845-855`).

**VERIFIED** — the mirror line is the middle of what flips as it is drawn, turned, plus
the words on an arrow (`getCommonBoundingBox`, `actionFlip.ts@1118751f:131`;
`resizeElements.ts@1118751f:1280-1310`). Each kind is measured the way the oracle's
`getElementBounds` measures it (`bounds.ts@1118751f:147-240` at 1118751f), in
`scene/geometry.rs` › `element_outline_bounds`: an ellipse by its own curve, a diamond by
its four corners, a line, arrow or freehand stroke by its turned points, anything else by
its turned box. The unturned boxes put the line in the wrong place whenever a turned
element was in the selection, and the turned box for every kind still did for a turned
ellipse, diamond, line or stroke — 70 units off for a line stood on end
(`ci_flip.rs` › `the_axis_is_what_each_kind_draws`).

**VERIFIED** — each kind, as the oracle does it (`resizeElements.ts@1118751f:1409-1497`):

| kind                                            | after a flip                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| rectangle, ellipse, diamond, frame, embed, text | reflected position, **same** width and height, negated angle — the stroke, hatching and glyphs are not mirrored       |
| image                                           | reflected, and its extent goes negative on that axis — the pixels mirror (see `images.md` › Flip)                     |
| line, arrow                                     | points mirrored about the origin, `x` reflected, width negated as before (`packages/contract/src/bounds.ts` reads it) |
| freehand stroke                                 | points mirrored inside its own box, box reflected                                                                     |
| label                                           | not flipped itself; follows its container, turned with it                                                             |

An embed's page is never mirrored: Excalidraw only turns the iframe (`App.tsx@1118751f:2047-2052`),
and a mirrored video would show its controls and captions backwards. A text turned by
0.3 comes back turned by -0.3, the same turn as excalidraw.com's 2π − 0.3; it used to keep
its angle. The angle is negated and not normalised into `[0, 2π)` as the oracle's
`normalizeRadians` does, so a second flip gives back the original number exactly.

A flip that moves nothing — a lone unturned box, which is its own mirror image — is not an
edit: no new version, nothing saved or sent, no step of undo, as the oracle's
`mutateElement` keeps the version when no value changed (`mutateElement.ts@1118751f:129-131`).
`apply_patches` drops such a patch for align, distribute and lock as well
(`ci_flip.rs` › `a_flip_that_changes_nothing_is_not_an_edit`).

**VERIFIED** — arrows:

- a selection made only of bound arrows turns them round: the resolved heads trade ends
  and nothing moves (`actionFlip.ts@1118751f:116-129`);
- an arrow flipped with the shape an end is bound to keeps that binding, its anchor
  mirrored in the shape's frame (`[1 − fx, fy]` for H, `[fx, 1 − fy]` for V);
- an end bound to a shape that did not flip lets go (`resizeElements.ts@1118751f:1558-1569`);
- an arrow that did not flip, bound to a shape that did, keeps its anchor and follows the
  shape (`updateBoundElements`).

### Divergences

| what                               | Excalidraw                                                                                                                                                                                                                       | here                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| anchors of a straight/curved arrow | mirrored for elbow arrows only (`resizeElements.ts@1118751f:1446-1474`). The path is mirrored but the anchors are stale, so the arrow jumps back to the old sides when a bound shape next moves — **OBSERVED** on excalidraw.com | mirrored for every arrow. Every bound arrow is re-resolved right after a commit here, so stale anchors would undo the flip at once |
| arrows-only check                  | counts an arrow's label (`getSelectedElements` with `includeBoundTextElement`, `actionFlip.ts@1118751f:87-94`), so a labelled arrow flipped alone is mirrored and let go of both shapes                                          | labels are not counted: a labelled bound arrow alone turns round like any other                                                    |
| re-centring after the flip         | moves the selection back onto its old middle (`actionFlip.ts@1118751f:158-192`): a curved arrow is measured by its rendered curve, which can bump the box by a pixel                                                             | not ported: boxes are measured from points, which mirror exactly; `ci_flip.rs` › `every_kind_round_trips` guards drift             |
| an image's mirror                  | a `scale: [sx, sy]` field                                                                                                                                                                                                        | a negative width or height, painted and exported as the same scale — `images.md` › Flip                                            |
| a line's reach                     | its rendered rough path (`getLinearElementRotatedBounds`, `bounds.ts@1118751f:934-995`), which can wander a pixel or so off its points, and a curve's bulge past them                                                            | its points: the line through a curved arrow's bulge can differ by as much as the bulge                                             |

**Open** — a box resized past its own corner (single element) still mirrors its stroke
through a negative extent (`ci_selection.rs`), where the oracle's stays positive. Flip
keeps whatever sign a box already has, so it neither introduces nor removes one.

**VERIFIED** — the frame drawn round a multi-selection (`group_box`) is the union of
**turned** bounds (`scene_outline_bounds`, folding `element_outline_bounds` the way
`scene_bounds` folds the unturned box), the same bounds its mirror line already used. Read
by the frame, its handles and `pointer_is_inside_selection`/`hits_selection_box` alike, so
hit-testing a group's handle and telling a click on its frame from a click past it both
moved with the fix. Before, a turned element's unturned box reached past what was actually
drawn, so the frame and its handles shifted sideways on a flip and shifted back on the
next one: a 200×20 bar stood on end beside a box at 300..350 had its frame at 0..350
before a horizontal flip and 90..440 after, where excalidraw.com's stays at 90..350 — now
matched exactly (`ci_flip.rs` › the_multi_selection_frame_does_not_drift_across_a_flip;
`ci_group_resize.rs` › the_frame_is_the_union_of_turned_bounds_not_unturned_boxes;
`e2e/flip.spec.ts` › a rotated element's frame handle sits at its turned bounds, and stays
put across a flip).
