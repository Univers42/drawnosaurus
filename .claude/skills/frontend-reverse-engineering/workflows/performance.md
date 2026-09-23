# Measuring before optimising

Never claim something is faster without measuring it. Never optimise code because it
*looks* inefficient.

## 1. Define the workload first

A number without a workload is not a measurement. State: element count, gesture, number
of pointer moves, zoom, viewport size, browser.

Workloads that exercise the real bottlenecks here:

- **drag** a selection of N elements across 60 moves — the per-frame scene traversal
- **group resize** of N elements across 60 moves — the same, plus point scaling
- **hit test** on a board of N elements — no spatial index, so this is linear
- **zoom out** until all N are visible — culling stops helping, every element repaints

## 2. Measure

`get_render_stats` gives frame duration, render duration, elements rendered vs total,
shape-cache hits and misses, and repaint count. `make bench` (criterion) covers the engine
in isolation.

Warm up first, run many iterations, and record the **distribution** — median and spread,
not one number. A single sample on a shared machine is noise.

Chrome DevTools MCP for traces when you need to see *where* the time goes rather than how
much there is.

## 3. Separate the costs

`algorithmic complexity · CPU time · allocations · render time · frame time · latency`

They do not move together. Fewer elements traversed can still cost more if it adds an
allocation per frame.

## 4. Know what this architecture already does

Before optimising, check you are not re-doing work that exists:

- **Viewport culling** — `PaintView.elements` is already culled; `elements_rendered` vs
  `elements_total` tells you whether it is working.
- **Shape cache** — rough geometry is kept between frames, keyed by a geometry
  fingerprint, so a pan or zoom rebuilds nothing. Cache misses during a drag mean the
  fingerprint is moving when it should not.
- **Path2D cache** — one path per op set, so a hachure fill is one canvas call per frame
  rather than thousands.
- **Pointer coalescing** — one engine step per animation frame, in `host/pointerInput.ts`.

What genuinely does not exist: a **spatial index** (hit testing is linear), **dirty
regions** (the whole canvas repaints), and **offscreen caching**.

## 5. Report honestly

Not "3x faster". Say: under *this* workload on *this* runtime, median frame time went
from X to Y, and the mechanism was Z — traversing A elements per frame instead of B.

If the mechanism cannot be named, the measurement is not understood yet.
