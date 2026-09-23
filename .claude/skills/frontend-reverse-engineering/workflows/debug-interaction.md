# A gesture behaves wrong

Drag, resize, rotate, select, draw — anything where the input is a pointer sequence.

## 1. Make it deterministic

Never debug from a hand-made gesture. Script it:

```
open_board
tool  { name: "rectangle" }
pointer [ {down, x, y}, {move, x, y}, {move, x, y}, {up} ]
```

**Use several moves.** A single-move drag hides every compounding bug — a scale applied
to already-scaled state looks correct until the second move. This is exactly how the
group-resize drift survived (`docs/reference/resize.md`).

## 2. Snapshot after every transition

```
get_app_state      → tool, selection, editing group, interaction kind
get_scene          → geometry after each step
get_viewport       → camera; a wrong zoom explains a wrong coordinate
```

Record the state after *each* pointer event, not only at the end. The question is where
the first divergence is, and a final-state diff cannot answer it.

## 3. Classify the divergence

| what is wrong | look at |
|---|---|
| nothing happened at all | was the gesture swallowed by chrome? start inside `OPEN_CANVAS` |
| wrong element picked up | `hit_test` — and remember a transparent shape is hit on its outline only |
| right element, wrong movement | `engine/pointer_move.rs`, the `Interaction` arm for this gesture |
| correct until you let go | `engine/pointer_end.rs` — settle, discard and history live there |
| drifts over a long drag | state captured at drag start vs read live — the compounding class |
| correct state, wrong pixels | `wasm/paint.rs`; state is fine, go to `inspect-canvas.md` |

## 4. The compounding check

If geometry drifts across a drag, ask: **is this derived from state captured when the
gesture began, or from the live element?** Anything read live has already been
transformed by every earlier move of the same gesture.

`Interaction::Resize` holds `origin` and `origin_points` for precisely this reason
(`engine/pointer_move.rs`). `GroupFrame` holds `origins` for the same reason.

## 5. Write the test at the layer the bug is in

- Engine semantics → a Rust test in `engine/crates/draw-engine/tests/ci_*.rs`. Fast,
  deterministic, no browser.
- Host wiring, pointer capture, the WASM boundary → a Playwright spec in `e2e/`.

Both, when a fix could pass one and fail the other — which is the usual case for anything
involving pointer events.
