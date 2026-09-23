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
