# Our render path

```
scene → cull to viewport → rough geometry → Path2D → canvas ops → pixels
                ↑ cached              ↑ cached
```

## The frame loop is in Rust

`wasm/mod.rs` drives its own `requestAnimationFrame`. There is no React in the drawing
path and no reconciliation to blame. `request_draw()` marks dirty; `take_dirty()` is a
**boolean**.

Consequence: there are **no dirty regions**. The whole canvas repaints or nothing does.
"Half the screen updated" is not a possible bug here; "nothing updated" is.

## Two caches, both keyed by geometry

- **ShapeCache** (`render/cache.rs`) — rough.js geometry, kept between frames, keyed by a
  fingerprint of the element's _geometry only_. Panning, zooming and dragging leave the
  fingerprint untouched, so none of them regenerate anything. A cache miss during a drag
  means the fingerprint includes something it should not.
- **Path2D cache** (`wasm/paint.rs`) — one `Path2D` per op set, so a hachure-filled
  rectangle is one canvas call per frame instead of thousands. Keyed by the same
  fingerprint, so duplicated shapes share one path.

Position, zoom and rotation are applied to the **context**, not baked into the geometry.
That is what keeps both caches valid through every camera change.

## Two passes

1. **Elements** — the document. Rough-generated for most kinds; text is filled glyphs;
   freedraw is a filled variable-width outline, because a varying width cannot be stroked.
2. **Overlay** (`paint_overlay`) — marquee, snap guides, selection chrome, linear handles,
   binding highlight, lasso, laser.

**Canvas state is sticky across passes.** Dash, line width, stroke and fill survive. The
overlay sets what it needs explicitly; anything that does not, inherits whatever the last
element wanted. That was a real bug: selection frames drawn in the dash of the last shape
painted.

## Device pixel ratio

`quality_dpr()` caps at 2. During motion `interactive_dpr()` drops it to keep frames
cheap, so a screenshot taken mid-gesture is at a different resolution than one taken at
rest. Measure at rest unless the point is motion.

## What does not exist

No spatial index — hit testing is a linear scan. No offscreen canvas. No dirty
rectangles. No separate static/interactive canvas layers: Excalidraw splits those, we do
not. Before claiming a rendering optimisation, check `docs/reference/rendering.md` for
whether the invariant that split preserves even applies to us.
