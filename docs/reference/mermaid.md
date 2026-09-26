# Mermaid import

A Mermaid definition becomes a diagram on the board, Excalidraw's way. The oracle hands the
definition to `@excalidraw/mermaid-to-excalidraw` (`TTDDialog/common.ts@1118751f:70-110`).
That library parses the definition and lays it out with Mermaid itself, then returns
element skeletons. We use the same library at the same version (2.2.2) and turn its
skeletons into our elements (`apps/web/src/lib/mermaid/skeleton.ts`).

## How a definition gets in

- **The dialog.** Open it from the command palette (Ctrl+/ → "Mermaid to diagram…") or from
  the main menu (`DrawMermaidModal.svelte`).
  - The preview redraws as you type.
  - A definition Mermaid cannot read shows the error, and Insert is disabled.
  - Insert, or Ctrl+Enter, places the diagram in the middle of the view, selected, with
    the camera fitted to it.
  - The dialog keeps the last definition in `localStorage`.
- **Paste.** Text that starts like a diagram (the oracle's `isMaybeMermaidDefinition`, in
  `importMermaid.ts` › `looksLikeMermaid`) is converted and placed at the pointer. The
  camera does not move (`App.tsx@1118751f:4686-4708`).
  - Text that only looks like a definition, such as "graph paper", falls back to the
    engine's ordinary paste.
- Both ways go through `engine.insertJson` (`engine/…/engine/clipboard.rs` › `place_json`).
  Either way, the whole diagram comes back with one undo.

## Coverage — every type, `e2e/mermaid/types.ts`

| Type                                                   | Comes in as                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| flowchart, sequence, class, state, er                  | **native**: shapes, bound arrows, labels, subgraphs as frames         |
| gantt, pie, mindmap, timeline, gitGraph, journey       | **fallback**: Mermaid's SVG as one image, with a "not editable" badge |
| quadrant, sankey, xychart, block, architecture, c4     | **fallback**                                                          |
| requirement, kanban, packet                            | **fallback**                                                          |
| a native type whose own parser fails (the converter's) | **fallback**: the converter draws it as a picture instead             |

No type is broken. The badge reads "Mermaid diagram · image, not editable" and is grouped
with the picture it describes.

## Where we differ from the oracle, and why

- **Labels shrink to fit their shape.** The engine lays each label out in the board's
  fonts. A label that no longer fits the box Mermaid made for it is set smaller, down to 12. Only then does the shape grow (`clipboard.rs` › `fitted`). The oracle grows the
  shape at once, so neighbours overlap. It shrinks only cylinders, down to
  `MIN_VERTEX_LABEL_FONT_SIZE` 12.
- **An arrow is bound only to a shape its end reaches**, within 40 of the shape's box
  (`skeleton.ts` › `BIND_REACH`).
  - Our engine routes a bound end onto its shape straight away. The converter binds a
    sequence message to the boxes at the top of both lifelines, so a bound message would
    jump up to them.
  - The oracle binds it anyway and keeps its points until a box moves
    (`transform.ts@1118751f` › `bindLinearElementToElement`).
  - The 40 comes from the converter's own output, measured over 60 seeds of each type.
    An end stops at most 33 from the box it names in a class diagram, which is the room
    Mermaid leaves for a marker. In a flowchart it is at most 5, in a state diagram at
    most 3, and in an ER diagram 0. A sequence message runs 48 or more below its actor
    box.
- **Entities are restored.** The converter leaves its placeholders (`ﬂ°name¶ß`,
  `ﬂ°°123¶ß`) in class relation titles, which the oracle shows as they are.
  `restoreEntities` turns them back into their characters.
- **A skeleton with a non-finite number is skipped, not placed.** An empty `alt`/`loop`
  block in a sequence diagram makes Mermaid lay it out at NaN. Import fails only when
  nothing at all is left.
- **Mermaid is pinned to 11.12.2** (`pnpm-workspace.yaml` › `overrides`), with
  `@mermaid-js/parser` 0.6.3. The converter accepts any 11.x, but 11.17 renames subgraph
  ids, so the converter can no longer find its own clusters.

Inherited from the converter, and not changed here:

- Flowchart self-loops and `~~~` links are dropped.
- Mermaid removes a raw `<` from a label; write `#lt;`.
- Click links are not carried.

## How it is tested

- `apps/web/src/lib/mermaid/mermaid.test.ts`: the skeleton rules, one by one.
- `engine/…/tests/ci_insert_json.rs`: placement and label fitting.
- `e2e/mermaid.spec.ts`: the dialog, paste, parse errors and the picture badge.
- `e2e/mermaidCorpus.spec.ts`: 22 real diagrams (`e2e/mermaid/corpus.ts`).
  - Each one attaches a side-by-side of Mermaid's own SVG and the board's export.
  - The assertions are geometric: nothing at NaN, and labels fit.
- `e2e/mermaidFuzz.spec.ts`: seeded random definitions of all 20 types.
  - The inputs range from 1 to 200 nodes, and include unicode, long labels, nested
    subgraphs, cycles and styles.
  - Each case checks that nothing throws and nothing is NaN, that every node has a
    shape and every edge a bound arrow, that no shapes overlap, that labels fit and
    that positions are kept.
  - A seed that failed goes in `e2e/mermaid/regressions.ts`, and every run replays it.
  - `make fuzz-mermaid` runs 1,000 cases per type (`CASES=` to change). The ordinary
    suite runs 5.
- **Not done:** a pixel diff against Mermaid's SVG. The two renderers draw different
  strokes and fonts, so a pixel diff would measure style, not the conversion. The
  geometric checks and the side-by-side sheets stand in for it.
