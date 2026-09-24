# Selection

Markers: **OBSERVED** (measured in the running editor), **VERIFIED** (read and
measured), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

## The marquee

**VERIFIED** — containment, not overlap (`getElementsWithinSelection`). A band that clips
a shape leaves it; one that encloses it takes it.

**OBSERVED**, 2026-09-23 — the rubber band was never _drawn_ during a drag. Mid-gesture
`get_pointer_state` reported `kind: "marquee"` and `region_ink` inside the rectangle read 0. The `Marquee` arm of `advance_interaction` updated the rectangle and never called
`request_draw`; the band is chrome, so nothing else dirtied the frame. After the fix the
same patch reads 1. `ci_repaint.rs` now checks every gesture asks for a frame on move —
that is a class of bug, and state-reading tests cannot see it.

## Shift

**VERIFIED** — shift-click adds; shift-click on a held element removes it on the
release, so a shift-drag from a held element moves everything held
(`App.tsx:9656-9660`, `:12183-12260`); shift-drag extends; shift on empty canvas keeps the
selection. A plain click on empty canvas clears, and so does one in the hole of the
selection's box, where a drag would move it (`App.tsx:12344-12387`, `ci_grab_selected.rs`).
Each rule is another's escape hatch (`ci_multi_select.rs`).

## Moving

**VERIFIED** — grabbing any member of a multi-selection carries the rest, and does not
narrow the selection to it.

**VERIFIED** — a bound arrow moved on its own **releases** each end whose shape is not
moving with it (`dragElements.ts:110-167`). An end whose shape is in the drag stays bound.
A lone arrow must first travel 10px (`DRAGGING_THRESHOLD`) so the click that selects it
cannot detach it.

**OBSERVED** — before this, a bound arrow could not be moved at all: `apply_bindings` ran
every frame of the move and re-snapped its ends onto its shapes. Dragged 150px, it ended
exactly where it started.

**IMPLEMENTATION DETAIL, divergent** — the oracle unbinds a multi-selection on the first
pixel; ours applies the threshold there too, so a sub-10px wobble never detaches anything.

**OBSERVED** — a press on the _middle_ of a selected two-point arrow hits its midpoint
handle and bends it rather than moving it. The oracle does the same.

## The chrome

**VERIFIED** — each selected element gets its own outline, and a multi-selection gets a
dotted box around all of them (`interactiveScene.ts:1922-1948`, `:2027-2052`). Canvas
dash state is sticky, so chrome sets its dash explicitly or inherits the last element's.

## Open

**UNKNOWN** — alignment snapping is on by default here (a moved arrow snapped 6px onto a
box edge). Excalidraw's object snapping is a toggle, off by default. Not yet compared.

**UNKNOWN** — whether moved elements should bump `version`. Moves currently do not; a
radius edit does, because history deduplicates on version and geometry and a radius
changes no geometry. Worth checking against the server's merge, which ranks by version.
