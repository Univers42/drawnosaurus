# Reverse-engineering a reference feature before building it

For "make it work like Excalidraw does" — before writing any code.

## 1. Observe the real thing

Playwright MCP → excalidraw.com. Perform the gesture slowly and record what changes at
each step. Do not rely on memory of how it feels; it is usually wrong in the details that
matter.

Export the scene before and after. The `.excalidraw` JSON tells you what the gesture
actually *did* to the model, which is the part you have to reproduce.

## 2. Find the rule in the source

`third_party/excalidraw`, pinned at `scripts/oracle-sha.txt`. Search for the state the
observation implicated, not for the feature name — features are spread across files, state
is not.

Useful entry points:

| subject | file |
|---|---|
| gestures, tool state, the big switch | `packages/excalidraw/components/App.tsx` |
| element model and type guards | `packages/element/src/types.ts`, `typeChecks.ts` |
| groups | `packages/element/src/groups.ts` |
| linear elements, point editing | `packages/element/src/linearElementEditor.ts` |
| selection chrome, handles | `packages/excalidraw/renderer/interactiveScene.ts` |
| geometry, shape generation | `packages/element/src/shape.ts`, `bounds.ts` |
| constants worth transcribing | `packages/common/src/constants.ts` |

## 3. Write the rule down before implementing

Transcribe it into `docs/reference/<subject>.md` in as few lines as it really takes. If it
does not compress, you have not found the rule yet — you have found a symptom.

A good transcription is five lines and explains every case. Nested-group selection is the
example (`docs/reference/groups.md`).

## 4. Find the counter-intuitive parts

Every feature has one or two, and they are the ones that will bite:

- Excalidraw's double-click **does not** end a multi-point line; clicking the last placed
  point does, and a double click happens to do that.
- Only **arrows** bind. Lines never do.
- Marquee selection is **containment**, not overlap.
- Curvature is one global `roundness` flag; the violet dots are midpoint handles that
  *insert* a point, not curve controls.

Record these explicitly. They are the difference between parity and something that looks
similar and behaves wrong.

## 5. Decide what not to copy

Their implementation detail is not our requirement. Note the invariant, choose our own
structure, and say in the commit why it diverges — so the next person does not "fix" it
back.
