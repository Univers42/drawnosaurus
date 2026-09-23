# Something looks wrong on screen

Before touching the painter, separate the stages. The model is usually the problem.

```
MODEL → GEOMETRY → TRANSFORM → RENDER PARAMS → CANVAS → SCREEN
```

## Ask in this order

1. **Is the model right?** `get_element(id)`. Are x/y/width/height/angle what you expect?
   If not, this is an interaction bug — go to `debug-interaction.md`.
2. **Is the bounding box right?** `inspect_element_at(x, y)` and `get_handles()`. Handles
   are drawn from the same layout the hit test uses; if they disagree with the outline,
   the painter and the hit test have drifted apart.
3. **Right coordinate space?** Points are stored **relative to the element origin**.
   World = `element.x + point[0]`. The painter works in screen space via
   `world_to_screen`. Mixing the two produces an offset proportional to the camera.
4. **Rotation about the right origin?** `rotation_center(element)` — the centre of the
   _points_, not `x + width/2`, which sits outside a leftward arrow entirely.
5. **Scaled once or twice?** See the compounding check in `debug-interaction.md`.
6. **Device pixel ratio?** `get_canvas_state` gives CSS size, backing size and dpr. A
   factor-of-2 error here is always dpr.
7. **Is it drawing stale data?** There are no dirty regions — the whole canvas repaints.
   So "half updated" is impossible; "did not repaint" is not. Check `request_draw` was
   called on the mutation path.
8. **Is it antialiasing?** A one-pixel outline at dpr 1 can read as grey. Measure rather
   than squint: `region_ink` over a patch that should be empty.

## Measuring instead of squinting

Whole-canvas ink cannot see chrome: a one-pixel outline around shapes that are already
drawn moves that number by less than antialiasing does. Point `region_ink` at a patch that
should be **empty unless the thing you are looking for is there**, and take a control from
the same patch before the state change.

Choose the geometry so only one thing can contribute. When two shapes are level, a group
frame's top edge and an element's own border land on the same line and no measurement can
tell them apart — offset them deliberately.

## Only then

Change `wasm/paint.rs`. Remember canvas state is sticky: dash, line width, stroke and
fill survive between draw calls. Chrome that does not set what it needs inherits whatever
the element pass left.
