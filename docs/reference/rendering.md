# Rendering

Confidence markers: **OBSERVED** (measured in the running editor), **VERIFIED** (read and
measured), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

## Three caches, stacked

**VERIFIED.** Read this order, outermost first. Reading an inner one alone gives an
answer that is not wrong so much as about a different question.

| layer                         | what it skips                                      | counter                               |
| ----------------------------- | -------------------------------------------------- | ------------------------------------- |
| **static layer plan**         | replaying _any_ element — the layer bitmap is kept | `redraws` / `scrolls` / `reuses`      |
| **Path2D cache**              | rebuilding canvas paths, per piece of geometry     | `pathCacheHits` / `pathCacheMisses`   |
| **rough geometry (`SHAPES`)** | regenerating the sketched shape                    | `shapeCacheHits` / `shapeCacheMisses` |

On a `reuse` frame nothing below the first layer is consulted at all. So a healthy
renderer shows **high `reuses`** and **frozen** cache counters — and `shapeCacheHits` in
particular sits at zero forever, because `SHAPES` is only asked when the Path2D cache
misses.

This cost real time to work out. The first version of the instrumentation reported
`shapeCacheHits: 0, shapeCacheMisses: 6` and nothing else, which reads as "the cache is
broken" and means the opposite. A metric that lies is worse than no metric, because it is
believed.

## A pan rebuilds nothing

**OBSERVED**, 2026-09-23, through `editor-inspector` against `make dev`. One rectangle,
then a seven-step pan with the hand tool:

```
before pan    frames  8   redraws  4   reuses  4   pathHits 0   pathMisses 2
after  pan    frames 22   redraws 10   reuses 12   pathHits 6   pathMisses 2
```

`pathCacheMisses` and `shapeCacheMisses` both **flat**. `medianPaintMs` 1.1 → 0.1.

This is the architectural claim measured rather than asserted: position, zoom and rotation
are applied to the **context**, not baked into the geometry, so the caches stay valid
through every camera change. If a future change makes misses climb during a pan, the
geometry fingerprint has started covering something it should not.

## Frame cost is two different numbers

**VERIFIED.** `medianFrameMs` is the wall interval between frames — display cadence plus
everything else on the page, and meaningless when the browser is idle between scripted
steps (it reads in the seconds). `medianBuildMs` + `medianPaintMs` is _our_ CPU. A slow
interval with a fast paint means the time is going somewhere that is not us.

Reported as median and p95 over a 120-frame ring, not as a mean: frame costs are a floor
with occasional spikes, and a mean hides exactly the spikes anyone looking is hunting.

## What does not exist here

**VERIFIED.** No dirty regions — `take_dirty` is a boolean and the canvas repaints whole,
so "half the screen updated" is not a failure this architecture can have. No spatial index
— hit testing is a linear scan. No offscreen caching beyond the static layer.

**IMPLEMENTATION DETAIL:** Excalidraw splits static and interactive rendering across two
_canvases_; we use one canvas, two passes, plus the static-layer bitmap above. The
invariant theirs preserves — do not redraw the document to move a handle — is the same one
`reuses` measures here.

## Canvas state is sticky

**VERIFIED**, the hard way. Dash, line width, stroke and fill survive between draw calls
and between passes. Chrome that does not set what it needs inherits whatever the last
element wanted: selection frames were once drawn in the dash of the last shape painted,
which reads as no frame at all.

## Arrowheads: the modern six, the legacy four

**VERIFIED.** `Arrowhead` carries **eleven** modern values — the eight ordinary heads plus the
**six** cardinality marks of ER diagrams' crow's-foot notation — and the oracle's legacy four
(`dot`, `crowfoot_one`, `crowfoot_many`, `crowfoot_one_or_many`, `types.ts@1118751f:350-355`)
are **not** a second set of values. They are read-only compatibility:

- the engine's enum has no legacy variant; the four are `#[serde(alias)]`s on their modern
  names (`engine/crates/draw-engine/src/scene/element.rs:77,84,86,88`);
- nothing on the writing side can produce one, so `ARROWHEADS` in three places
  (`scene/element.rs:112`, `engine/src/types.ts:66`, `packages/contract/src/element.ts:48`)
  lists the modern values only, and the four appear solely in
  `LEGACY_ARROWHEADS` / `WIRE_ARROWHEADS` (`element.ts:72,83`) — what the wire _accepts_;
- the oracle does exactly this, in `normalizeArrowhead` (`arrowheads.ts@1118751f:3-21`) called
  from `restore.ts@1118751f:616-617,657-661`.

So a board saved holding `crowfoot_one` **loads as `cardinality_one`** — the modern mark, drawn
with the modern geometry — and the next save spells it the modern way. Pinned through
`load_scene`/`export_json` in
`engine/crates/draw-engine/tests/ci_cardinality_props.rs`.

A mark is **not** half-circle symmetric between the two ends of a line, and the property suite
deliberately does not claim it is: `getArrowheadPoints` measures its "just behind the tip" point
from `B(0.3)` _into_ the curve it reads (`bounds.ts@1118751f:790-812`), so both ends of a
two-point line measure from the same origin, and the two tips sit at angles opposite only on a
straight body. What is asserted instead is that the mark is **anchored on and oriented by its own
end** — the base on the line's own axis, and the whole drawing equivariant under translating or
turning the line. See `docs/reference/export.md` for the SVG side and
`e2e/arrowheads.spec.ts` for the canvas.

**KNOWN GAP:** an arrowhead value the engine does not know at all — one from a _newer_
Excalidraw — fails the whole document. `elements_from_json` (`export/json.rs:32-34`) deserializes
the entire `elements` array in one `serde_json::from_value`, so a single unknown variant returns
`None` and `load_scene` keeps the previous scene; the oracle loads the board and draws the head
as a plain arrow (`shape.ts@1118751f:567-576`, the `default:` arm). A data-compatibility bug, not
a format one; it needs its own task, because the load path is shared by every element.

## Open

**UNKNOWN** — what `scrolls` costs relative to `redraws` in practice. The strip path is
implemented but the comment beside it records a measurement where it lost to a plain
redraw (1592ms vs 1006ms on 300 screen-sized shapes), and `scrolls` has read 0 in every
session measured so far.
