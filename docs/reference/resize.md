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
handle) outside the corner, and `scale_for` puts the corner at the raw pointer with no
compensation for where in the handle it was grabbed. So a handle jumps by that offset on
the first pull. The oracle's does too.

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

**VERIFIED** — the mirror line is the middle of the **turned** boxes of what flips, plus
the words on an arrow (`getCommonBoundingBox`, `actionFlip.ts:131`;
`resizeElements.ts:1280-1310`). The unturned boxes put it in the wrong place whenever a
turned element was in the selection.

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
0.3 comes back at 2π − 0.3, as on excalidraw.com; it used to keep its angle.

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

**Open** — a box resized past its own corner (single element) still mirrors its stroke
through a negative extent (`ci_selection.rs`), where the oracle's stays positive. Flip
keeps whatever sign a box already has, so it neither introduces nor removes one.
