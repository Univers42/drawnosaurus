# Remaining work

What is left to build, test or fix before the board matches the Excalidraw it is held to,
in the order we would do it. Written on 2026-09-26, after wave 14, with the registry at
`cd01892` and the engine at `4c41948`. The report behind it, with every open checklist line and the
registry's reason for it, is [`parity-report.html`](parity-report.html) in this directory
(open it in a browser; the filter box searches every line).

## Where we stand

| Measure                         | Value                                            |
| ------------------------------- | ------------------------------------------------ |
| Oracle                          | Excalidraw `1118751f` (`scripts/oracle-sha.txt`) |
| Checklist lines (`prompt/*.md`) | 1,112                                            |
| In scope                        | 930                                              |
| Covered by a named test         | 617 (66.3%)                                      |
| Built, but no test proves it    | 74                                               |
| Not built yet                   | 239                                              |
| Out of scope (not counted)      | 182                                              |

The live figure is whatever `make conformance` prints. Each item below names the checklist
lines it closes, so the number moves with the work.

## How to work an item

1. Branch from `develop` as `feature/<topic>` or `fix/<topic>`. Engine work gets a branch of
   the same name in `engine/` and a submodule bump in the root.
2. Read the oracle first: `make oracle` checks Excalidraw out at the pin into
   `third_party/excalidraw`. Cite what you port as `path@1118751f:lines`.
3. Red first. Write the failing test, then the code. Unit tests target the `.ts` modules
   beside `DrawSurface.svelte`; engine behaviour gets a `tests/ci_*.rs`; anything a person
   does with a mouse or keyboard gets an `e2e/*.spec.ts`.
4. In `packages/conformance/src/registry.ts`, turn the matching rules from `gap` to
   `covered` and name the new test files. A half-done rule is split, never overclaimed.
5. Gates, run yourself: engine `make quality` (set `COMPOSE_PROJECT_NAME` per worktree),
   then `make wasm`, `make quality`, `make conformance`, `make test-integration` and the
   full Playwright suite. Warnings are errors.
6. Release: engine branch, engine `develop`, engine `main`, each with the engine CI green;
   then root `develop` with CI green, then root `main` with **main's own CI run** green.
   Finally rebuild the main checkout: `make wasm`, `make up`, and `make stale` must say
   current.

Sizes are rough: **S** is under a day, **M** a few days, **L** a week or more.

---

## 0. Known bugs

Fix these before new features; each one is something a person can hit today.

| #   | Bug                                                                                                                                                                                                                           | Where                                                                                                                                                 | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 0.1 | The export dialog's **Transparent background** toggle and **Scale** chips do nothing. They are `$state` in the dialog and never reach `engine.exportPng()`, which takes no arguments. Hide them until 2.1 lands, or land 2.1. | `apps/web/src/lib/draw-chrome/DrawExportModal.svelte:13-27`, `engine/src/engine.ts:801-803`                                                           | S    |
| 0.2 | Vectorizing an image tombstones it and mints new ids for the trace, but arrows bound to the image keep pointing at the dead id.                                                                                               | `engine/crates/draw-engine/src/engine/vectorize.rs:205-278` (`commit_trace` at :365)                                                                  | S    |
| 0.3 | Board shortcuts fire while the vectorize dialog has focus. `onAppShortcut` only skips text fields, and the modal layer only handles Escape.                                                                                   | `DrawSurface.svelte:1614` (`onAppShortcut`), `DrawModals.svelte:63-78`; `isOwnedElsewhere` (`DrawSurface.svelte:643-648`) already solves it for paste | S    |
| 0.4 | A turned element inside a flipped group keeps its angle when the group is dragged through its anchor; the oracle negates it.                                                                                                  | `docs/reference/resize.md:131`, oracle `resizeElements.ts@1118751f:1417-1420`                                                                         | S    |

**To confirm, then fix or close.** These were reported in earlier waves, and nothing in
the code today proves them either way:

- A brand-new text label whose shape a peer takes while it is typed. The generic path
  (`engine/crates/draw-engine/src/engine/peers.rs:88-104`) should revert it like an
  existing label, but every test in `ci_text_edit.rs` uses an existing one. Write the test.
- Redo of a shape after a peer's order patch: does it come back at the bottom? No test in
  `ci_zorder.rs` covers redo after a remote reorder. Write the test.
- A loose (ungrouped) multi-selection's frame leaves an arrow's label outside it.
  `element_outline_bounds` (`scene/geometry.rs:259-293`) measures a line by its points
  only, which `docs/reference/text-model.md:285` records as deliberate. Check the oracle's
  `getCommonBounds` before deciding.
- `e2e/zoom.spec.ts` near line 146 once timed out in `openBoard` under load. Not seen
  since; watch for it.

---

## 1. Quick wins

Small, independent, and visible. Any order.

### 1.1 Tests for what is already built — S, 52 lines

These work in the app today; the registry will not count them until a test drives them.
No product code should be needed. If a test finds a bug, it moves to section 0.

| Area                    | What to drive                                                                                                                                   | Lines |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----: |
| Clipboard keys          | Ctrl/Cmd+C, X, V end to end in a browser: copy, cut, paste and check the scene                                                                  |     8 |
| Context menu            | Cut, Copy, Duplicate, Delete, Group, Ungroup, Lock, Unlock, Bring forward, Send backward, each from the element menu; Export from the main menu |    11 |
| Keys                    | Backspace deletes; Ctrl/Cmd+O opens the file picker                                                                                             |     2 |
| Middle mouse            | Drag with the middle button pans (`pointerInput.ts`, `button === 1`)                                                                            |     3 |
| Menus                   | Arrow keys move through both menus; the shortcut is printed beside each item                                                                    |     2 |
| Rotation and resize     | Rotate a sticky note, an image and a line; move a whole line; resize a frame and check what it contains                                         |     5 |
| Images                  | An image survives copy/paste and duplicate with its picture                                                                                     |     1 |
| Text                    | Clicking away (blur) commits an edit; caret and selection inside the editor                                                                     |     3 |
| Selection and transform | The selection outline; the selection survives its own transform; vertical 45° snap; z-order stays stable after a deletion                       |     4 |
| Align                   | Align top (`AlignMode::Top`)                                                                                                                    |     1 |
| Hit testing             | Hit a sticky note and an embed on their interiors                                                                                               |     2 |
| Geometry                | Projection and closest point asserted directly, not through bucket fill                                                                         |     2 |
| Style                   | `stroke_style` and `fill_style` through `apply_style` / `set_next_style`                                                                        |     2 |
| Freehand                | The rough look is actually applied to a freehand stroke                                                                                         |     1 |
| Grid                    | What the grid paints                                                                                                                            |     1 |
| Collaboration           | The Share dialog's people list and avatars                                                                                                      |     2 |
| Embeds and Mermaid      | Paste an embed URL through the modal; open the Mermaid dialog from the menu                                                                     |     2 |

The exact checklist lines are in the report's ledger under each section; filtering it by
"untested" finds most of them.

### 1.2 Paste plain text as text — S, 3 lines

Pasting text from another app does nothing today. `paste_json`
(`engine/crates/draw-engine/src/engine/clipboard.rs:359-392`) accepts only this app's own
JSON, and the chrome's paste handler in `DrawSurface.svelte` handles only images and sticky
JSON. Excalidraw makes one text element per line and wraps any line wider than
`max(min(visible width / 2, 800), 200)`. Oracle: `packages/excalidraw/clipboard.ts` and the
paste path in `packages/excalidraw/components/App.tsx`.

Done when: an e2e pastes two lines of plain text and finds two text elements at the
pointer; the `Text paste` / `Paste text` rules flip.

### 1.3 Recognise pasted Mermaid — S, 2 lines

A canvas paste that starts with Mermaid syntax should open `DrawMermaidModal.svelte` filled
in, instead of doing nothing. The detector is the first line of
`apps/web/src/lib/mermaid/mermaidParser.ts:38` (`graph|flowchart`). Oracle:
`packages/excalidraw/mermaid.ts`.

### 1.4 Small keys and modes — S each

| Item                       | Notes                                                                                                                                                    | Lines |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: |
| Ctrl/Cmd+Shift+L           | Bind to the existing `toggleLockSelection` (`menu.ts:18`); add it to `engine/src/host/keys.ts` and the help dialog                                       |     2 |
| Zen mode, Alt+Z            | Hide the chrome, keep the canvas. Host only. Oracle `actions/actionToggleZenMode.tsx`. `focusModeEnabled` in `DrawSurface.svelte` is a different feature |     2 |
| Shift+3                    | Excalidraw's viewport-relative fit                                                                                                                       |     1 |
| Recently used commands     | Rank the palette's recent commands first (`commandPalette.ts`)                                                                                           |     1 |
| Vectorize from the palette | Today only the context menu reaches it (`DrawContextMenu.svelte:97-100`)                                                                                 |     – |

---

## 2. Export and files — L, about 36 lines

The most visible gap for anyone who shares a board.

**2.1 Whole-scene PNG.** `engine.exportPng()` (`engine/src/engine.ts:801-803`) is
`canvas.toBlob()` of the visible canvas, so anything scrolled out of view is cut off.
Render the scene into an offscreen canvas framed by its bounds (`bounds.ts` in the contract
already mirrors the engine's), at 1×, 2× or 3×, with or without the background. This fixes
bug 0.1. Oracle: `packages/excalidraw/scene/export.ts:180-460` (`exportToCanvas`,
`exportToSvg`).

**2.2 What to export.** Selection only and a single frame, for both PNG and SVG. Nothing
threads the selection into either path today.

**2.3 Clipboard.** Copy as PNG and copy as SVG. SVG export already exists (`export/svg.rs`,
`ci_export.rs`) and only needs the clipboard plumbing.

**2.4 Round trip.** Embed the scene JSON in the PNG (a `tEXt` chunk) and the SVG (metadata),
so dropping the file back on the board restores it. Oracle: `packages/excalidraw/data/image.ts`.

**2.5 Background and theme.** SVG always paints a background rect (`scene_to_svg`); add
the option to leave it out, and a dark-theme export. Collaborator colours are not themed.

**2.6 Fonts in SVG.** `export/svg.rs:416,423` names the font family but embeds no
`@font-face`, so an SVG opened elsewhere falls back to a system font.

**2.7 `.excalidraw` import and export.** `elements_from_json` (`export/json.rs:27-29`)
refuses anything whose `type` is not `"osidraw"`. Map Excalidraw's element schema both
ways; the figure element exports as a closed line. Oracle: `packages/excalidraw/data/json.ts`,
`data/restore.ts`.

**2.8 Recovery.** Autosave falls back to a `localStorage` draft only. Add an IndexedDB
store and a crash-recovery prompt (3 lines).

Done when: the export specs cover each option; the §32, "Export tricks", "Files",
"Clipboard tricks" and §31 rules flip.

---

## 3. Arrows and lines — L, 8 lines

**3.1 Elbow arrows.** `ArrowType` has only `Sharp` and `Round`
(`engine/crates/draw-engine/src/engine/selection_style.rs:76-80`); the contract has no
elbow either. Orthogonal routing over the fixed-point bindings arrows already have. Oracle:
`packages/element/src/elbowArrow.ts`. The flowchart stories and templates are the obvious
first users; `docs/reference/flowchart.md` records the straight-connector compromise.

**3.2 Cycle the arrow type** by pressing the arrow tool's key again
(`App.tsx@1118751f:5695-5714`). Needs 3.1 for the third type.

**3.3 Cardinality arrowheads** for ER diagrams.

**3.4 Drag a label along its arrow.** Labels sit at the middle of the path
(`linear_label_center`); Excalidraw's `labelPosition` lets them slide.

**3.5 Remove the last point while placing a multi-point line.** Backspace calls
`deleteSelection()` unconditionally (`engine/src/host/keys.ts:155-158`); it should drop the
last point while `multi_linear` is active.

**3.6 Endpoint snapping** for a line's own endpoints while drawing or dragging.

---

## 4. Library — L, 18 lines

Nothing exists yet. Save a selection as an item, show items in a sidebar with previews,
drag or click to insert with ids regenerated and groups kept, persist per user, and add
"Add to library" to the context menu. The five templates (`apps/web/src/lib/templates`)
are a catalogue to start from, not a library. Oracle: `packages/excalidraw/data/library.ts`,
`actions/actionAddToLibrary.ts`, `components/LibraryMenu.tsx`.

Decide first: where items live. Per browser (IndexedDB) is what Excalidraw does; per owner
on the API needs a new collection and routes in `apps/api`.

---

## 5. Find and inspect — M each

**5.1 Scene search, 13 lines.** Search text, labels and frame names; step through matches;
highlight them. Oracle: `components/SearchMenu.tsx`, `actions/actionToggleSearchMenu.ts`.

**5.2 Links on elements, 15 lines.** The contract has no `link` field
(`packages/contract/src/element.ts`); "Edit link…" in the context menu is for embeds only
(`menu.ts:21`). Order: schema field, inspector row, link popup, click to open, keep it in
export. Oracle: `packages/element/src/elementLink.ts`, `actions/actionElementLink.ts`,
`components/hyperlink/Hyperlink.tsx`.

**5.3 Stats panel and numeric inputs, 9 lines.** `DrawInspector.svelte` has no x, y,
width, height or angle fields, and the selection summary carries style only. Oracle:
`components/Stats/`, `actions/actionToggleStats.tsx`.

---

## 6. Drawing precision — M, about 19 lines

| Item                                        | Today                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Alt draws from the centre                   | Resize has it (`from_center`, wave 7); the `Draft` branch of `pointer_move.rs:44-69` never reads Alt                                 |
| Shift snaps rotation to 15°                 | `rotate_element` (`selection/transform.rs:292-295`) takes the pointer only                                                           |
| Snap to other shapes while drawing/resizing | Object snap (`pointer_move.rs:619-647`) runs for moves only                                                                          |
| Ctrl releases the grid                      | `invert_snap` (`pointer_move.rs:628`) flips object snap, never the grid                                                              |
| Equal-spacing guides                        | Not built                                                                                                                            |
| Connection points and snap increments       | Not built; edge, centre, midpoint and 45° snapping are done                                                                          |
| Grid size                                   | Modelled, not exposed; the menu offers fixed sizes; rendering does not thin with zoom; export does not explicitly leave the grid out |
| Finer nudge                                 | Alt+Arrow is taken by flowchart navigation, so pick another modifier                                                                 |
| Tab on the canvas                           | Unclaimed; the oracle's Tab opens shape conversion                                                                                   |
| A "none" fill                               | `FillStyle` has Hachure, CrossHatch, Solid and Zigzag only                                                                           |

---

## 7. Selection and frames — M, about 13 lines

- **Alt+click deep select**: reach an element underneath another; also Alt while
  box-selecting. Hit testing returns the topmost hit only.
- **Subtractive lasso**: `LassoMode` is `Contain` or `Intersect`
  (`selection/lasso.rs:29-35`); add a remove modifier.
- **On-canvas marks** for a locked element and for a group; today only the context menu
  shows either.
- **Frame "select contents"**: selecting a frame selects only the frame.
- **Turn any shape into a flowchart node** before Ctrl+Arrow works on it.
- The marquee's single containment mode is deliberate (see "Not planned").

---

## 8. Images — M/L, 10 lines

- **Crop mode**: double-click to enter, drag the crop handles, Escape to leave. Needs a
  second rect on the element and a mode in the interaction state machine. Oracle:
  `packages/element/src/cropElement.ts`, `actions/actionCropEditor.tsx`.
- **Replace image** and a **broken-image** state.
- **A file store.** Pictures ride inline as data URLs (`packages/contract/src/element.ts:202`),
  so a board reaches MongoDB's 16 MB document ceiling at two or three large pictures
  (`packages/contract/src/limits.ts:61-65`). Move them to a store keyed by file id, as
  Excalidraw does. This touches the contract, the API, persistence and a migration, so it
  gets its own design note in `docs/reference/images.md` first.

---

## 9. Freehand and eraser — M, 9 lines

Streamline and speed thinning are in (`engine/crates/draw-engine/src/freehand.rs`,
`ci_freehand_stroke.rs`). Left:

- **Pen pressure**: read `PointerEvent.pressure` into the width for pens; keep speed
  thinning for mice.
- **Point simplification** when a stroke is committed. `render/path_data.rs::simplify`
  already exists for the lasso.
- **The eraser splits a stroke** instead of removing all of it (`engine/eraser.rs`).
- **Pen, touch and palm** are shared with section 10.

---

## 10. Touch and mobile — L, 13 lines

Pointer events are used everywhere, but there is no multi-touch: pinch zoom and two-finger
pan exist only as a trackpad pinch through the wheel event (`engine/src/host/wheel.ts:11`).
Needed: two-finger pan and pinch, long press, telling pen from touch from mouse, palm
rejection, larger touch handles, and a mobile layout for the toolbar and menus.

---

## 11. Collaboration and modes — M, about 8 lines

- **Follow any collaborator**, outside presentation mode too. `DrawFollowNotice` renders
  only for a presenting peer, and following tracks slides, not the presenter's live camera
  (`docs/reference/presentation.md:93-94`).
- **Show each person's active tool** in presence.
- **Read-only link.** Nothing in the contract or API knows a read-only viewer. The gateway
  already decides roles by entrance (`docker/gateway/Caddyfile`, `X-Drawnosaurus-Role`), so a
  view-only role fits there.
- **Per-property undo.** Undo restores a whole element, so undoing your colour change to an
  element a peer has since moved also moves it back. Excalidraw's deltas restore only the
  properties you changed.
- **Branching history** needs the same operation model.

---

## 12. Notes, embeds and Mermaid — S/M, about 8 lines

- **Sticky-note border colour.** The stroke row is repurposed as the text colour for notes
  (`docs/reference/sticky.md:38-41`); nothing draws an outline.
- **Embeds**: drag out a region to create one; loading and error states on the element
  (today only the modal shows an error, `DrawEmbedModal.svelte:70`); an export fallback;
  view-only behaviour.
- **Mermaid**: a preview before insert; diagram types beyond flowcharts (sequence, class,
  ER, state). Oracle: `components/TTDDialog/`.

---

## 13. Engine architecture — L, about 49 lines

`prompt/design.md` asks for these structures. None of them is visible to a user by itself,
but the named-action layer makes every later shortcut, menu item and palette entry cheaper.

- **Named actions** (§28, 25 lines). `commandPalette.ts` is a tested `Command[]` registry,
  but `onAppShortcut` (`DrawSurface.svelte:1614`) and the menus call the engine on their
  own. Make one action table that shortcuts, menus, the palette and buttons all dispatch
  through. Oracle: `packages/excalidraw/actions/register.ts`, `actions/types.ts`.
- **Transactions** (§29, 4 lines). A commit is one stamp at the end of a gesture
  (`push_history`); there is no start/update/commit/cancel API.
- **Performance budgets** (§49, 10 lines). Criterion benches exist
  (`engine/crates/draw-engine/benches/{editing,render,text}.rs`, `make bench`) but only
  report. A gate would read `target/criterion/*/estimates.json` against checked-in
  thresholds in its own CI job. Also: the drag-into-frame history step still keeps two id
  lists (`docs/reference/zorder.md:99-101`).
- **Geometry primitives** (§44). No vector, matrix or circle types, and no convexity test.
- **Element fields** (§1). `customData`, library membership and explicit visibility.
- **Vectorize's production build.** CI builds the web image but never runs it, and the
  browser suite runs `vite dev`, so the production worker bundle is checked by nothing.

---

## 14. Test harness work — M, 22 lines

These need a harness before the tests are cheap:

- **Painted output** (§42, 6 lines): snap guides, binding highlights, frame clips, peer
  cursors and hover are drawn (`wasm/paint.rs`) but only the state they read is asserted.
  Needs a way to read back what was painted, such as recording the canvas calls.
- **Accessibility audit** (§48, 5 lines): focus management, dialog focus traps,
  screen-reader labels, high contrast, reduced motion. An automated audit (for example
  axe-core in Playwright) is a new dev dependency; agree on it first.
- **The modifier matrix** (§51, 8 lines): each tool against Shift, Alt, Ctrl and their
  pairs, as one table-driven spec.
- **Host state** (§1, 3 lines): modal, sidebar and collaboration state held in Svelte.

---

## Not planned

Different on purpose, or not this project's to build:

- The board lives on the server and merges per element; `.osidraw` files are an export,
  not the source of truth. `appState` is not persisted, and pictures live on the element,
  not in a top-level `files` map (until 8 changes that).
- A marquee selects what it contains, never what it only clips, so a small drag across a
  large background shape leaves it alone.
- Select All includes locked elements so the context menu can unlock them; Excalidraw skips
  them.
- Alt+Arrow moves between flowchart nodes.
- The cheat sheet's `I` for images and its Ctrl+Shift+]/[ are wrong; the oracle's own
  bindings are used.
- Bold, italic and letter spacing: Excalidraw has none either.
- Hosted AI (text to diagram, wireframe to code), and a File/Edit/View menu bar that
  Excalidraw does not have either.
- Font preloading loads the Latin shard only; other scripts are laid out again when their
  shard arrives (`apps/web/src/lib/draw-chrome/fonts.ts:178-179`). Revisit only if a
  non-Latin board flickers visibly.

---

## CI

- **drawnosaurus** (`.github/workflows/ci.yml`): shellcheck, stale-WASM guard, WASM build,
  typecheck/lint/format, unit and integration tests, browser tests, image build and smoke
  test. Every image pulls from Docker Hub: `public.ecr.aws` meters anonymous pulls per
  source IP, GitHub's shared runners run out of it, and that failed main's run 36230407015.
- **draw-engine** (`engine/.github/workflows/ci.yml`): shellcheck, `quality`, and the release
  WASM build at the crate's wasm-bindgen pin. Until 2026-09-26 no push had ever started it;
  it runs on every push now. If a push shows no run, start one with
  `gh workflow run CI --repo Univers42/draw-engine --ref <branch>` and find out why.

## Regenerating the report

`make conformance` prints the headline. The report's per-line ledger comes from running
every checklist line through the registry. In the tooling container (`make shell`):

```sh
cat > /tmp/dump.mts <<'EOF'
import { readChecklists } from "/app/packages/conformance/src/checklist.ts";
import { ruleFor } from "/app/packages/conformance/src/registry.ts";
const out = readChecklists("/app/prompt").map((i) => {
  const r = ruleFor(i)!;
  return { src: i.source, section: i.section, line: i.line, text: i.text, status: r.status, why: r.why ?? "" };
});
process.stdout.write(JSON.stringify(out));
EOF
node --experimental-strip-types /tmp/dump.mts > items.json
```

Then update the figures and the ledger in `parity-report.html` from `items.json`.
