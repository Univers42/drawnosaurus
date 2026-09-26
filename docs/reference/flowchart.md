# Flowchart mode

Confidence markers: **OBSERVED** (seen in the running app), **VERIFIED** (read in the
pinned source _and_ observed), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

Oracle pinned at `scripts/oracle-sha.txt` (`1118751f`): `packages/element/src/flowchart.ts`
and `packages/excalidraw/components/App.flowchart.ts`, with `revealIfHidden` and
`insertNewElements` from `App.tsx` and the fit from `App.viewport.ts`. Engine port:
`engine/crates/draw-engine/src/engine/flowchart.rs` (module doc comment cites exact line
ranges for every decision below). Host wiring: `engine/src/host/keys.ts`. Browser coverage:
`e2e/flowchart.spec.ts`.

## Held to the oracle's own output

**VERIFIED** — `engine/tools/flowchart-oracle` runs the oracle's `AppFlowchart`, unmodified,
through 285 key sequences (1462 key events): every node kind at four sizes and four styles,
turned nodes, repeated presses, direction changes, Escape, frames, zooms, scroll and chrome
offsets, and Alt+Arrow walks including the oracle's own navigation tests.
`ci_flowchart_oracle.rs` replays each against the engine and compares, after every key,
the pending cluster, the scene, the selection and the camera, within 1e-9: positions,
sizes, styles, ids in order, frame membership, which element each arrow end binds and how,
its anchor, its heads.

What is not compared, because the oracle's arrow is an elbow arrow and this engine does
not route one yet: each arrow's points (and so its width and height); its x/y and anchors
where an end sits on a diamond or a turned node, which the oracle snaps with elbow-only
rules; and the camera after a reveal whose bounds take in an arrow's hand-drawn wobble or
an elbow route. The test prints what it compared — 3064 anchors with 500 skipped, 1346
camera positions with 116 skipped — and fails if the share compared drops.

## What it does

**VERIFIED** — holding Ctrl/Cmd (without Shift) and pressing an arrow key, with exactly one
flowchart node selected (rectangle, diamond, ellipse, sticky note — `is_flowchart_node`,
`typeChecks.ts@1118751f:286-293` — and this app's figures), previews a new node off that
side and an arrow bound to both. The preview is held outside the scene
(`FlowchartCreator::pending`) and painted over it at a fifth of its opacity, as the oracle
paints `pendingFlowchartNodes` — nothing is added to the scene, the selection or the undo
history until the modifier is released. Releasing inserts every pending element as
**one** history step — into the start node's frame when every piece overlaps it — and
selects the first new node (`flowchart_commit`). Ctrl/Cmd+Arrow is taken even with nothing
to grow from; it never nudges.

**VERIFIED** — pressing the same arrow again while Ctrl/Cmd is held adds a sibling:
`place_cluster` lays the cluster out across the direction, clear of every node the start
is linked to, as `placeCluster` does. A different arrow starts over at one node that way.
Escape drops the preview and nothing else: the start stays selected.

**VERIFIED** — Alt+Arrow with one element selected selects the linked node in that
direction, cycles through same-level nodes on a repeat press, and falls back to any
unvisited linked node — `FlowchartNavigator::explore`, ported from `FlowChartNavigator`,
with the oracle's own heading test (`headingForPointFromElement`) on the point where each
arrow meets the node. With anything else selected Alt+Arrow is the plain nudge, as there.

**VERIFIED** — every press, the commit and every walk reveal what they reach when it is not
wholly on screen — `revealIfHidden` (`App.tsx@1118751f:5197`): the room is the canvas less
the chrome floating over it (`[data-viewport-ui]`, measured by `viewportOffsets.ts` at the
keypress, as `getOffsets` measures it) and 24px; a hidden target is fitted `scale-down` —
zoomed out to fit, or back **in** up to 100% — and centred in that room, over a 300ms
ease-out that zooms geometrically (`interpolateViewport`). A pan or zoom by the user ends
it. The toolbar is marked `top` and the inspector `side`, as the oracle marks its own.

## Divergences from the oracle, deliberate

- **No elbow routing yet.** The arrow is built by one function, `binding_arrow`, with
  everything the oracle's `createBindingArrow` sets — style, heads, both bindings, the
  anchors — and today's straight arrow between the two anchors. The switch, when elbow
  arrows land, is `elbowed: true` and the route there, `is_flowchart_link` narrowed to
  elbow arrows, and the diamond/turned anchors from the elbow snapping.
- **Selection-only steps take no history.** The oracle captures a history entry when an
  Alt walk ends; this engine records only steps that changed the scene.
- **The start node's `boundElements` is not rewritten** before the commit as the oracle's
  is; bindings here are resolved from the arrows.
- **Frame insertion counts live elements only**, so a board full of deleted elements can
  order a new node differently among tombstones, never among what is drawn.

## Extras this app has that the oracle does not

- **Digit shape choice.** While Ctrl/Cmd is held for creation, pressing 1/2/3 sets the
  pending nodes' shape to rectangle/diamond/ellipse (`flowchart_set_shape`,
  `FLOWCHART_SHAPE_KEYS` in `keys.ts`). The preview updates at once; releasing Ctrl/Cmd
  commits with that shape. A node started from a sticky note keeps cloning sticky notes
  unless one of the three is explicitly picked (`parse_shape` refuses `"stickynote"`).
- **A floating shape-chooser strip** (`FlowchartShapeStrip.svelte`) appears beside the
  node being created, offering the same three shapes by click, each with an accessible
  name (`"Rectangle (1)"`, etc.). Shown only while a cluster is pending
  (`onFlowchartCreatingChange`), positioned from the pending cluster's own bounds and kept
  there as the reveal moves the camera.
- **Enter starts typing in the new node** — no new code: the commit selects the first new
  node, and Enter already opens the text editor on whatever is selected
  (`keys.ts` › `handlePlainKeys`).

## Host wiring

`engine/src/host/keys.ts` › `dispatchKeyDown` recognises Ctrl/Cmd+Arrow (creation) and
Alt+Arrow (navigation) ahead of the generic modifier-chord and plain-key branches, because
both must fire held-and-repeated. `dispatchKeyUp` commits or ends navigation by looking at
which modifiers are **still** down when a key comes up — not which key was released — so a
fast Ctrl-then-Arrow release ordering still commits, the same approach as the oracle's own
keyup half. The engine reveals in all three cases; the host only feeds it the chrome's
offsets (`setViewportOffsets`) from the keydown.

## Cost

**IMPLEMENTATION DETAIL** — `benches/editing.rs` › `flowchart/*`, beside a 200-node diagram:
a press costs about 34µs on a 1,000-shape board and 90µs on a 20,000-shape one, a walk step
3µs and 97µs, the release 26µs and 185µs. The preview is painted over the cached board, so
a press does not repaint it.

## Limits

- A frame is not a flowchart node, matching `is_flowchart_node`; a node inside one grows
  its cluster into it, as above.
