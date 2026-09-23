---
name: frontend-reverse-engineering
description: The debugging loop for this editor — reproduce, inspect state, compare against the Excalidraw oracle, find the FIRST divergence, and only then change code. Use whenever behaviour differs from the reference, whenever something "looks wrong" on the canvas, or before changing geometry, hit testing, selection, or the render path.
---

# Reverse-engineering this editor

A visual bug is usually not a rendering bug. This canvas is the **last** stage of a long
pipeline, and by the time something looks wrong on screen the mistake is normally several
stages upstream. This skill exists to stop the classic failure:

```
looks wrong → change CSS → looks different → change coordinates → break something else → "fixed"
```

## The loop

Nine steps, in order. Do not skip to step 8.

1. **Reproduce** deterministically — a fixed gesture from a known starting state.
2. **Inspect application state** — `get_app_state`, `get_scene`, `get_selected_elements`.
3. **Inspect canvas and viewport** — `get_viewport`, `get_canvas_state`.
4. **Capture a screenshot** — evidence of output, not of correctness.
5. **Compare scene state** against the oracle — `compare_scene`, canonical form.
6. **Identify the FIRST divergence**, not the final one.
7. **Trace event → state → render** through the pipeline below.
8. **Only then modify the implementation.**
9. **Re-run the interaction test**, plus a control that passed before.

## The pipeline

Find where the first divergence occurs. Search upstream before touching the renderer.

```
USER ACTION
  → DOM pointer/keyboard event        host/pointerInput.ts, host/keys.ts
  → event normalization               coalesced to one engine step per frame
  → engine state                      DrawEngine (Rust/WASM)
  → scene / element model             scene/element.rs, scene/store.rs
  → geometry / transform              scene/geometry.rs, selection/transform.rs
  → hit testing                       scene/geometry.rs, selection/linear.rs
  → render pipeline                   render/shape.rs → wasm/paint.rs
  → canvas                            2D context
  → pixels
```

Architecture facts that decide where to look:

- The scene, geometry, hit testing and selection live in **Rust compiled to WASM**. They
  are not inspectable from the DOM. Go through `window.__drawEngine` (DEV builds only).
- The frame loop is in `wasm/mod.rs` — Rust drives its own `requestAnimationFrame`. There
  is no React reconciliation in the drawing path.
- There are **no dirty regions**: `take_dirty()` is a boolean and the engine repaints the
  whole canvas. A "partial redraw" bug cannot exist; a "did not repaint at all" one can.
- A transparent shape is hit on its **outline only**. The middle of an empty rectangle is
  a hole, deliberately.
- Chrome floats _on top of_ the canvas. A gesture starting under the toolbar or inspector
  is swallowed silently. Start inside `OPEN_CANVAS`.

## Tools, and what each is actually good for

| tool                            | use it for                                                                   | do not use it for                        |
| ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| `editor-inspector` MCP          | our editor's semantic state, hit tests, render stats, deterministic gestures | anything about the reference             |
| Playwright MCP                  | driving **excalidraw.com** to observe reference behaviour                    | measuring our internals                  |
| Chrome DevTools MCP             | performance traces, memory, console, network                                 | semantic scene state (use the inspector) |
| `third_party/excalidraw` source | the reference's _rules_ — pinned by `scripts/oracle-sha.txt`                 | what the reference does at runtime       |
| `docs/reference/*.md`           | what we have already established, with confidence markers                    | anything not yet investigated            |

A screenshot proves visual output. It proves nothing about state, coordinates,
serialization or performance. Keep the three categories separate: **visual**,
**behavioural**, **structural**.

## Confidence

Mark every claim, in commits, docs and reports:

- **VERIFIED** — read in both implementations, or measured.
- **INFERRED** — consistent with the evidence, not confirmed.
- **UNKNOWN** — say so rather than guessing.

Never promote an inference to a fact without verification. If evidence contradicts an
assumption, stop and update the model rather than rationalising.

## Before changing anything

Write the diagnosis first:

```
Symptom:
Reproduction:
Expected:
Actual:
First divergence:
Root cause:
Proposed change:
Risk:
Verification:
```

If you cannot fill in _First divergence_ and _Root cause_, you are not ready to edit. Keep
investigating.

## Workflows

- `workflows/debug-interaction.md` — a gesture behaves wrong
- `workflows/inspect-canvas.md` — something looks wrong on screen
- `workflows/compare-render.md` — differential testing against the oracle
- `workflows/inspect-tool.md` — reverse-engineering a reference feature before building it
- `workflows/performance.md` — measuring before optimising

## References

- `references/excalidraw-architecture.md` — the oracle's shape
- `references/canvas-rendering.md` — our render path
- `references/interaction-model.md` — coordinate spaces and gesture state
- `docs/reference/` — the accumulated knowledge base, per subsystem
