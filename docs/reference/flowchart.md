# Flowchart mode

Confidence markers: **OBSERVED** (seen in the running app), **VERIFIED** (read in the
pinned source _and_ observed), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

Oracle pinned at `scripts/oracle-sha.txt` (`1118751f`): `packages/element/src/flowchart.ts`
and `packages/excalidraw/components/App.flowchart.ts`. Engine port:
`engine/crates/draw-engine/src/engine/flowchart.rs` (module doc comment cites exact line
ranges for every decision below). Host wiring: `engine/src/host/keys.ts`. Browser coverage:
`e2e/flowchart.spec.ts`.

## What it does

**VERIFIED** — holding Ctrl/Cmd and pressing an arrow key, with exactly one flowchart-
eligible shape selected (rectangle, diamond, ellipse or sticky note —
`is_flowchart_node`, mirrors `typeChecks.ts@1118751f:286-293`), previews a new node off
that side and a straight arrow bound to both. The preview is held outside the scene
(`FlowchartCreator::pending`) and painted alongside it (`engine/frame.rs`) — nothing is
added to the scene, the selection or the undo history until the modifier is released.
Releasing commits every pending element as **one** history step and selects the first new
node (`flowchart_commit`).

**VERIFIED** — pressing the same arrow again while Ctrl/Cmd is still held adds another
sibling rather than moving the first one further away: `place_cluster` grows the cluster
across the axis perpendicular to the direction, obstacle-aware, matching the oracle's own
`placeCluster` (`flowchart.ts@1118751f`).

**VERIFIED** — Alt+Arrow selects the connected node in that direction, cycling through
same-level nodes on a repeat press before falling back to any unvisited linked node in
another direction — `FlowchartNavigator::explore`, ported from `FlowChartNavigator`.

**VERIFIED** — a commit or a successful navigate eases the camera to the node if it is not
already visible (`DrawEngine::reveal`, `style.rs`): a 300ms pan, matching the oracle's own
`revealIfHidden` duration (`App.tsx@1118751f:~5197`), and a zoom-out only if the node would
not otherwise fit — never a zoom in, and never a jump. No-op when the node is already on
screen (`ci_flowchart.rs::commit_does_not_move_the_camera_when_the_node_is_already_visible`).

## Divergences from the oracle, deliberate

- **No elbow arrows.** This engine draws no elbow-routed arrows at all (`engine.ts`'s own
  doc comment), so the binding arrow is a straight line, bound at both ends with
  `BindMode::Orbit`, and left to the existing `refresh_bindings_in_place` to resolve —
  the same machinery every other bound arrow in this app already uses.
- **Obstacle membership follows any bound arrow**, not only elbow ones, since there is no
  elbow/non-elbow distinction here.
- **Navigation heading compares node centres** rather than the arrow's own endpoint
  (`heading_from_center`). Given this engine's straight arrows and axis-clean placement,
  this lands the same answer as the oracle's endpoint-based heading for every cluster this
  mode itself builds.

## Extras this app has that the oracle does not

- **Digit shape choice.** While Ctrl/Cmd is held for creation, pressing 1/2/3 sets the
  pending nodes' shape to rectangle/diamond/ellipse (`flowchart_set_shape`,
  `FLOWCHART_SHAPE_KEYS` in `keys.ts`). The preview updates at once; releasing Ctrl/Cmd
  commits with that shape. A node started from a sticky note keeps cloning sticky notes
  unless one of the three is explicitly picked (`parse_shape` refuses `"stickynote"`).
- **A floating shape-chooser strip** (`FlowchartShapeStrip.svelte`) appears beside the
  node being created, offering the same three shapes by click, each with an accessible
  name (`"Rectangle (1)"`, etc.). Shown only while a cluster is pending
  (`onFlowchartCreatingChange`), positioned from the pending cluster's own bounds.
- **Enter starts typing in the new node** — no new code: the commit selects the first new
  node, and Enter already opens the text editor on whatever is selected
  (`keys.ts` › `handlePlainKeys`).

## Host wiring

`engine/src/host/keys.ts` › `dispatchKeyDown` recognises Ctrl/Cmd+Arrow (creation) and
Alt+Arrow (navigation) ahead of the generic modifier-chord and plain-key branches, because
both must fire held-and-repeated and Alt alone never otherwise counts as a dispatch
modifier. A new `dispatchKeyUp`, wired into `attachKeyboardInput`'s keyup handler, commits
or ends navigation by looking at which modifiers are **still** down when a key comes up —
not which key was released — so a fast Ctrl-then-Arrow release ordering still commits, the
same approach as the oracle's own keyup half.

The host reveals the camera itself only for the **still-pending** preview
(`onFlowchartReveal`, fired from the create branch): the engine already eases the camera
at commit and at navigate (`DrawEngine::reveal`), and a host-driven pan on top of that
would fight the engine's in-flight animation frame by frame rather than cooperate with it.

## Limits

- **IMPLEMENTATION DETAIL** — the reveal's screen-space padding (`REVEAL_PADDING`,
  `FLOWCHART_REVEAL_MS`) are fixed constants; a host with real chrome insets (the oracle's
  `offsets: { ui: true }`) would want to feed them in rather than approximate with a
  margin.
- Frames and groups are not flowchart-eligible, matching `is_flowchart_node`; a shape
  inside either loses flowchart mode the same way the oracle's does.
