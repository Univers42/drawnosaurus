import type { ChecklistItem } from "./checklist.ts";

/**
 * What covers each line of `prompt/*.md`, or why nothing does yet.
 *
 * There are north of a thousand items across the two documents, so this is a list of
 * *rules* rather than a line-per-line table. A rule matches by section and optionally by
 * the item's text; the first one that matches wins. Every item must match some rule —
 * `conformance.test.ts` fails on anything that does not — so when the documents grow, the
 * new lines are a failing test rather than a silent omission.
 *
 * The honesty of this file rests on two checks rather than on good intentions:
 *
 *  - every file named in `tests` must exist and contain at least one test, so a rule
 *    cannot claim coverage that was renamed away or never written;
 *  - `gap` is a status, not an absence. An unimplemented feature is counted and printed,
 *    which is the difference between a roadmap and a blind spot.
 */

export type Status = "covered" | "gap" | "out-of-scope";

export interface Rule {
  /** Matched against `ChecklistItem.section`. */
  section: string | RegExp;
  /** Narrows to items whose text matches, so a mixed section can be split. */
  text?: RegExp;
  status: Status;
  /** Repo-relative test files. Required for `covered`, verified to exist. */
  tests?: readonly string[];
  /** Required for `gap` and `out-of-scope`: what is missing, or why it is not ours. */
  why?: string;
}

const ENGINE = "engine/crates/draw-engine/tests";
const WEB = "apps/web/src/lib";

/**
 * Order matters: the first matching rule wins, so narrow `text` rules come before the
 * section rule they carve out of.
 */
export const RULES: readonly Rule[] = [
  // ---------------------------------------------------------------- shortcuts
  {
    section: "⚡ Essential shortcuts",
    text: /Sticky note/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_shortcuts.rs`,
      `${WEB}/draw-chrome/tools.test.ts`,
      "e2e/stickyNote.spec.ts",
    ],
  },
  {
    section: "⚡ Essential shortcuts",
    text: /keyboard shortcuts \/ Help/,
    status: "covered",
    tests: ["apps/web/src/lib/draw-chrome/menu.test.ts"],
  },
  {
    section: "⚡ Essential shortcuts",
    text: /`I` — Image/,
    status: "out-of-scope",
    why: "The cheat sheet is wrong here. Excalidraw's own TOOLS table gives the image tool a digit and no letter, and the oracle is what this project is held to — see ci_shortcuts.rs.",
  },
  {
    section: "⚡ Essential shortcuts",
    status: "covered",
    tests: [`${ENGINE}/ci_shortcuts.rs`, "e2e/shortcuts.spec.ts"],
  },
  {
    section: "🧭 Navigation & canvas",
    text: /viewport mode/,
    status: "gap",
    why: "Shift+3. Excalidraw uses it for a viewport-relative fit; ours has no separate mode to fit to.",
  },
  {
    section: "🧭 Navigation & canvas",
    text: /Middle mouse \+ drag/,
    status: "gap",
    why: "pointerInput.ts treats a middle-button press the same as space (event.button === 1 || session.spaceHeld), but nothing dispatches a middle-button pointer event: no unit test for that branch, and no e2e drag with button: 'middle' anywhere in the suite.",
  },
  {
    section: "🧭 Navigation & canvas",
    status: "covered",
    tests: [
      `${ENGINE}/ci_zoom_wheel.rs`,
      `${ENGINE}/ci_camera.rs`,
      `${ENGINE}/ci_navigate.rs`,
      "engine/src/host/wheel.test.ts",
      "e2e/zoom.spec.ts",
      "e2e/wheelDeltaMode.spec.ts",
      "e2e/shortcuts.spec.ts",
    ],
  },
  {
    section: "Shapes",
    text: /disable snapping/,
    status: "gap",
    why: "Half done. Ctrl/Cmd now inverts snapping to objects for a move (ci_objects_snap.rs, e2e/objectsSnap.spec.ts). It does not yet release the grid: Excalidraw passes a null grid size to getGridPoint while it is held, so drawing and resizing on a snapping grid go free, and ours stay on the grid.",
  },
  {
    section: "Shapes",
    // Was swept up by the section rule below while nothing read Alt while drawing or resizing.
    text: /Alt\/Option \+ drag/,
    status: "gap",
    why: "Alt does not draw or resize from the centre: a new shape grows from where the drag began and a handle holds the opposite side (docs/reference/resize.md › Divergences). Excalidraw's shouldResizeFromCenter (resizeElements.ts@1118751f:621-727) and its drawing counterpart are not ported.",
  },
  // rect_from_drag's square parameter — a shape is free unless Shift squares it
  // (pointer_move.rs) — is pinned directly in draw_engine.rs's shape_drag_rect_from_drag,
  // not one of this rule's own named files.
  {
    section: "Shapes",
    text: /^`Shift \+ drag` — Constrain proportions/,
    status: "covered",
    tests: [`${ENGINE}/draw_engine.rs`],
  },
  {
    section: "Shapes",
    status: "covered",
    tests: [`${ENGINE}/ci_pointer.rs`, `${ENGINE}/ci_snapping.rs`, `${ENGINE}/ci_grid.rs`],
  },
  {
    section: "Lines & arrows",
    // The two halves of placing a path by hand. `Click repeatedly` and the gesture that
    // ends it were already swept up by the section rule below, which names none of the
    // tests for them — so the matrix called them covered while a click left nothing on
    // the board at all.
    text: /multi-point/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_line_multipoint.rs`,
      "e2e/lineMultipoint.spec.ts",
      // A click or a double click that ends an arrow on a shape, in a pack of them.
      `${ENGINE}/ci_binding_dense.rs`,
      "e2e/arrow-dense.spec.ts",
    ],
  },
  {
    section: "Lines & arrows",
    text: /Cycle\/change arrow type/,
    status: "gap",
    why: "The arrow type is changed from the panel's Arrow type row, sharp or curved (ci_next_style.rs, e2e/arrowType.spec.ts), but pressing the arrow tool's key again does not cycle it (App.tsx@1118751f:5695-5714), and the elbow type it cycles through needs the elbow-arrow work.",
  },
  {
    section: "Lines & arrows",
    // Ctrl/Cmd and Alt while binding. The section rule below used to claim both while
    // nothing read either key for binding at all.
    text: /Prevent automatic binding|fixed point|automatic binding position/,
    status: "covered",
    tests: [`${ENGINE}/ci_binding_anchor.rs`],
  },
  {
    section: "Lines & arrows",
    status: "covered",
    tests: [`${ENGINE}/ci_linear_anchor.rs`, `${ENGINE}/ci_binding.rs`, `${ENGINE}/ci_pointer.rs`],
  },
  {
    section: /^(🖱️ Selection|🔒 Locking)$/,
    text: /Shift \+ L`/,
    status: "gap",
    why: "No Ctrl/Cmd+Shift+L: lock and unlock are the context menu's one toggle (toggleLockSelection, ci_group_locks_frames.rs, menu.test.ts), with no key bound to it.",
  },
  {
    section: "🖱️ Selection",
    // Building a selection out of more than one thing, and seeing what is in it. Split
    // out of the section rule because that one names the single-element tests, and a
    // marquee, a shift-click and the chrome around the result are a different subject
    // with different failure modes — the engine had all three right while the painter
    // drew no outline around any of the members.
    text: /Shift \+ click|selection box|Select all/,
    status: "covered",
    tests: [`${ENGINE}/ci_multi_select.rs`, `${ENGINE}/ci_lasso.rs`, "e2e/multiSelect.spec.ts"],
  },
  {
    // "Special navigation depending on active editor/context" is flowchart mode: held on
    // a flowchart-eligible selection it previews a connected node
    // (`flowchart_create`/`flowchart_commit`); this app never uses Ctrl/Cmd+Arrow as a
    // nudge (`keys.ts` excludes it from the plain-arrow nudge explicitly), so the
    // section's own blanket rule below — which does not exercise this chord — is carved
    // around it.
    section: "🖱️ Selection",
    text: /Ctrl\/Cmd \+ Arrow/,
    status: "covered",
    tests: [`${ENGINE}/ci_flowchart.rs`, "engine/src/host/keys.test.ts", "e2e/flowchart.spec.ts"],
  },
  // A plain click selecting an element is real but absent from every file the section
  // rule below names: ci_pointer.rs drives it directly through the engine, and
  // grabSelected.spec.ts's selectByOutline() clicks a real shape in a real browser and
  // asserts the selection.
  {
    section: "🖱️ Selection",
    text: /^`Click` —/,
    status: "covered",
    tests: [`${ENGINE}/ci_pointer.rs`, "e2e/grabSelected.spec.ts"],
  },
  // Alt-drag duplication: ci_group_structure.rs drives begin_pointer/move_pointer with
  // the duplicate flag set and checks the copies land, and layer.spec.ts holds Alt down
  // for a real drag in a real browser and checks the element count. Neither file is
  // named below.
  {
    section: "🖱️ Selection",
    text: /^`Alt\/Option \+ drag` —/,
    status: "covered",
    tests: [`${ENGINE}/ci_group_structure.rs`, "e2e/layer.spec.ts"],
  },
  // copySelection/cutSelection are wired to Ctrl+C/Ctrl+X (keys.ts's handleModChords) and
  // Ctrl+V is deliberately left unhandled so the browser's own paste event carries it —
  // but no test dispatches Ctrl+C or Ctrl+X, and nothing drives an actual paste, so none
  // of the three round-trips through a test. Same gap as "27. Keyboard system"'s.
  {
    section: "🖱️ Selection",
    text: /^`Ctrl\/Cmd \+ [CXV]` —/,
    status: "gap",
    why: "implemented, untested — copySelection/cutSelection answer Ctrl+C/Ctrl+X and paste rides the native clipboard event, but no test dispatches Ctrl+C/Ctrl+X or completes a paste to confirm any of the three actually round-trips.",
  },
  {
    section: "🖱️ Selection",
    status: "covered",
    tests: [
      `${ENGINE}/ci_selection.rs`,
      `${ENGINE}/ci_edit.rs`,
      `${ENGINE}/ci_history.rs`,
      "engine/src/host/keys.test.ts",
      "e2e/shortcuts.spec.ts",
    ],
  },
  {
    section: "🎯 Advanced selection tricks",
    text: /Deep-select|deep-select|deep selection|containers\/frames/,
    status: "gap",
    why: "Alt+click to reach an element underneath another. Hit-testing returns the topmost hit only; there is no depth cursor.",
  },
  // `Enter` on a selected text opens its editor: keys.test.ts ›
  // "leaves Enter to the text editor when no path is being placed" dispatches the key and
  // asserts it calls `editSelectedText` — not one of the section rule's own named files.
  {
    section: "🎯 Advanced selection tricks",
    text: /`Enter` on a selected text element/,
    status: "covered",
    tests: ["engine/src/host/keys.test.ts"],
  },
  {
    section: "🎯 Advanced selection tricks",
    status: "covered",
    tests: [
      `${ENGINE}/ci_text.rs`,
      `${ENGINE}/ci_hover.rs`,
      `${ENGINE}/ci_text_edit.rs`,
      "e2e/textEditor.spec.ts",
    ],
  },
  {
    section: "🔤 Text",
    text: /Mermaid/,
    status: "covered",
    tests: [`${WEB}/mermaid/mermaid.test.ts`],
  },
  {
    section: "🔤 Text",
    text: /wrap text where appropriate/,
    status: "gap",
    why: "Pasting plain text makes no text element: the host hands it to pasteJson, which takes only element JSON (engine/src/host/keyboardInput.ts). Excalidraw makes one per line and wraps any wider than max(min(visible width / 2, 800), 200) (App.tsx:4978-5030). The wrapping that needs is ported (ci_text_wrap_oracle.rs); the paste is not.",
  },
  // `T` activates the text tool: ci_shortcuts.rs' oracle table drives it generically
  // through every tool's letter, not one of the section rule's own named files.
  {
    section: "🔤 Text",
    text: /Activate text tool/,
    status: "covered",
    tests: [`${ENGINE}/ci_shortcuts.rs`],
  },
  {
    section: "🔤 Text",
    status: "covered",
    tests: [
      `${ENGINE}/ci_text.rs`,
      `${ENGINE}/ci_text_edit.rs`,
      `${WEB}/draw-chrome/textEditor.test.ts`,
      "e2e/textEditor.spec.ts",
    ],
  },
  {
    section: "📐 Alignment & distribution",
    text: /bypass snapping/,
    status: "covered",
    tests: [`${ENGINE}/ci_objects_snap.rs`, "e2e/objectsSnap.spec.ts"],
  },
  // AlignMode has six variants (edit/align.rs) and ci_edit.rs exercises Left, Right,
  // CenterX and CenterY directly; ci_align_units.rs and ci_group_locks_frames.rs exercise
  // Bottom. Nothing anywhere calls align_selection/align_elements with AlignMode::Top.
  {
    section: "📐 Alignment & distribution",
    text: /^Align selected elements top$/,
    status: "gap",
    why: "AlignMode::Top exists and is wired up, but no test — unit or e2e — ever selects it; every align test uses Left, Right, CenterX, CenterY or Bottom.",
  },
  {
    section: "📐 Alignment & distribution",
    // Groups move as one block, spaced by equal gaps, and the inspector offers either
    // only when the engine says it would move something.
    status: "covered",
    tests: [
      `${ENGINE}/ci_edit.rs`,
      `${ENGINE}/ci_align_units.rs`,
      `${ENGINE}/ci_snapping.rs`,
      "e2e/groups.spec.ts",
    ],
  },
  // An element carries `locked` (the contract's schema), the context menu toggles it, and
  // a locked element is not pressed on, moved, lassoed or erased — only carried by its
  // group or frame. Select All still takes it, so the menu can unlock it.
  {
    section: "🗂️ Layers / ordering",
    text: /Lock element|Unlock element/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_group_locks_frames.rs`,
      `${ENGINE}/ci_hover.rs`,
      `${ENGINE}/ci_lasso.rs`,
      `${ENGINE}/ci_eraser.rs`,
      `${WEB}/draw-chrome/menu.test.ts`,
    ],
  },
  {
    section: "🗂️ Layers / ordering",
    text: /Shift \+ [[\]]`/,
    status: "out-of-scope",
    why: "The cheat sheet is wrong here. Excalidraw binds Ctrl+Shift+] / [ to bring to FRONT / send to BACK on Windows and Linux (actionZindex.tsx), and a step forward / backward to Ctrl+] / [ — both bound as the oracle has them, see keys.test.ts and e2e/zorder.spec.ts.",
  },
  {
    section: "🗂️ Layers / ordering",
    status: "covered",
    tests: [
      `${ENGINE}/ci_edit.rs`,
      `${ENGINE}/ci_zorder.rs`,
      "engine/src/host/keys.test.ts",
      "e2e/zorder.spec.ts",
    ],
  },
  {
    section: "🔒 Locking",
    text: /deep-selection/,
    status: "gap",
    why: "No deep selection reaches a locked element: a click, a marquee and a lasso pass it by, and only Select All takes it — so the context menu can unlock it, where Excalidraw's Select All skips it (actionSelectAll.ts@1118751f:32-38).",
  },
  {
    section: "🔒 Locking",
    status: "out-of-scope",
    why: "Workflows made of Lock element, which is classified under Layers / ordering rather than twice.",
  },
  {
    section: "🖼️ Images",
    text: /`I` — Image tool/,
    status: "out-of-scope",
    why: "The same cheat-sheet error as under Essential shortcuts: Excalidraw's TOOLS table gives the image tool a digit (9) and no letter — see ci_shortcuts.rs.",
  },
  {
    section: "🖼️ Images",
    text: /crop|Crop/,
    status: "gap",
    why: "No crop mode. Images resize and move; cropping needs a second rect on the element and a mode in the interaction state machine.",
  },
  {
    section: "🖼️ Images",
    text: /flip\/rotation controls/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_flip.rs`,
      `${ENGINE}/ci_image.rs`,
      `${ENGINE}/ci_handles.rs`,
      "e2e/flip.spec.ts",
    ],
  },
  {
    section: "🖼️ Images",
    status: "covered",
    tests: [`${ENGINE}/ci_image.rs`, `${WEB}/draw-chrome/imageFile.test.ts`, "e2e/image.spec.ts"],
  },
  // shortkey.md's own Frames line never mentions renaming by name — that is the design
  // doc's "Rename frame" line, split out below under "12. Frames".
  {
    section: "🧩 Frames",
    text: /Export frames/,
    status: "gap",
    why: "Export has no per-frame mode.",
  },
  // The chord itself is pinned in the shortcuts oracle, not here — draw_frame in
  // ci_frame.rs activates the tool directly (`set_tool`), never through a keypress.
  {
    section: "🧩 Frames",
    text: /^`F` — Frame tool$/,
    status: "covered",
    tests: [`${ENGINE}/ci_shortcuts.rs`],
  },
  // a_frame_and_its_duplicated_children_stay_in_one_run_above_it (ci_duplicate.rs) drags a
  // frame and its child through duplicate_selection and checks both copies land — not one
  // of this rule's own named files.
  {
    section: "🧩 Frames",
    text: /^Duplicate a frame/,
    status: "covered",
    tests: [`${ENGINE}/ci_duplicate.rs`],
  },
  {
    section: "🧩 Frames",
    status: "covered",
    // ci_group_locks_frames.rs: what is drawn or pasted inside a frame joins it and moves
    // with it; groups join and leave whole.
    tests: [`${ENGINE}/ci_frame.rs`, `${ENGINE}/ci_group_locks_frames.rs`],
  },
  {
    section: "🔗 Element linking",
    status: "gap",
    why: "No link on an element. Schema field, inspector row, click handling and export preservation, in that order.",
  },
  // Sharp or curved, and the heads: the panel's rows, which with nothing selected set the
  // next arrow's (docs/reference/console.md).
  {
    section: "➡️ Advanced arrows",
    text: /sharp arrows|curved arrows|Change arrowhead type/,
    status: "covered",
    tests: [`${ENGINE}/ci_next_style.rs`, `${ENGINE}/ci_style.rs`, "e2e/arrowType.spec.ts"],
  },
  {
    section: "➡️ Advanced arrows",
    text: /[Ee]lbow|cardinality/,
    status: "gap",
    why: "Elbow arrows are a milestone of their own: orthogonal routing over the fixed-point bindings arrows already have. Cardinality arrowheads wait on it.",
  },
  // An arrow's label: typed on the arrow, wrapped at Excalidraw's width, centred on the
  // path's middle, the stroke cut under it, and re-wrapped/re-centred whenever the arrow's
  // own length changes — a point dragged directly or a bound shape moving it — since an
  // arrow has no resize gesture of its own to hang that on
  // (docs/reference/text-model.md › Layout).
  {
    section: "➡️ Advanced arrows",
    text: /label/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_text_model.rs`,
      `${ENGINE}/ci_export.rs`,
      "e2e/textEditRequest.spec.ts",
      "e2e/arrowLabel.spec.ts",
    ],
  },
  {
    section: "➡️ Advanced arrows",
    status: "covered",
    tests: [
      `${ENGINE}/ci_binding.rs`,
      `${ENGINE}/ci_binding_overlap.rs`,
      `${ENGINE}/ci_binding_dense.rs`,
      `${ENGINE}/ci_linear_anchor.rs`,
      `${ENGINE}/ci_style.rs`,
      "e2e/arrow-dense.spec.ts",
    ],
  },
  {
    // Ctrl/Cmd+Arrow: previews a cluster off the selected node, held outside the scene
    // until the modifier is released, which commits it as one step
    // (`flowchart.rs` › `flowchart_create`/`flowchart_commit`, `keys.ts`).
    section: "🔄 Flowcharts",
    text: /create connected nodes/,
    status: "covered",
    tests: [`${ENGINE}/ci_flowchart.rs`, "engine/src/host/keys.test.ts", "e2e/flowchart.spec.ts"],
  },
  {
    // Turning an arbitrary element (a line, a frame, an image) into something flowchart
    // mode will grow from — distinct from starting a cluster off a shape that already
    // qualifies (`is_flowchart_node`), which is covered above.
    section: "🔄 Flowcharts",
    text: /Convert a generic shape/,
    status: "gap",
    why: "Flowchart mode works from a rectangle, diamond, ellipse or sticky note as the oracle's own is_flowchart_node does; there is no conversion of an arbitrary element into one of those first.",
  },
  {
    // Alt+Arrow: same-level cycling with a fallback to any unvisited linked node
    // (`FlowchartNavigator::explore`).
    section: "🔄 Flowcharts",
    text: /keyboard navigation to move between flowchart/,
    status: "covered",
    tests: [`${ENGINE}/ci_flowchart.rs`, "e2e/flowchart.spec.ts"],
  },
  {
    // The commit's own arrow, bound at both ends (`binding_arrow`) — not the general
    // binding system, which "18. Binding system" already covers.
    section: "🔄 Flowcharts",
    text: /Connect nodes with bound arrows/,
    status: "covered",
    tests: [`${ENGINE}/ci_flowchart.rs`, "e2e/flowchart.spec.ts"],
  },
  {
    // Ctrl+D duplicates whatever is selected by kind alone; a flowchart node is a
    // rectangle/diamond/ellipse, so it needs no code of its own to duplicate.
    section: "🔄 Flowcharts",
    text: /Duplicate flowchart nodes/,
    status: "covered",
    tests: [`${ENGINE}/ci_duplicate.rs`],
  },
  {
    // A bound arrow follows the shape it is anchored to on every move — the general
    // binding system ("18. Binding system"), exercised here on shapes a flowchart
    // cluster produced same as any other.
    section: "🔄 Flowcharts",
    text: /preserving connections/,
    status: "covered",
    tests: [`${ENGINE}/ci_binding.rs`, `${ENGINE}/ci_arrow_drag.rs`, "e2e/arrowDrag.spec.ts"],
  },
  {
    section: "🔄 Flowcharts",
    text: /elbow arrows/,
    status: "out-of-scope",
    why: "This engine draws no elbow-routed arrows at all (engine.ts's own doc comment) — a flowchart binding is a straight line, same as every other bound arrow here. See docs/reference/flowchart.md.",
  },
  {
    section: "🧠 Autoshape / Smart drawing",
    status: "covered",
    tests: [`${ENGINE}/ci_recognize.rs`],
  },
  {
    section: "🪣 Bucket fill",
    status: "covered",
    tests: [`${ENGINE}/ci_bucket_fill.rs`, "e2e/bucket.spec.ts"],
  },
  // `N` activates the sticky-note tool: ci_shortcuts.rs' oracle table, not one of the
  // section rule's own named files.
  {
    section: "📝 Sticky notes",
    text: /`N` — Sticky note/,
    status: "covered",
    tests: [`${ENGINE}/ci_shortcuts.rs`],
  },
  // A workflow made of Create and Type directly into the note, both covered by the
  // section rule below — not a feature of its own.
  {
    section: "📝 Sticky notes",
    text: /brainstorming/,
    status: "out-of-scope",
    why: "A workflow made of Create and Type directly into the note, already covered by the section rule below.",
  },
  {
    section: "📝 Sticky notes",
    status: "covered",
    tests: [`${ENGINE}/ci_sticky.rs`, "e2e/stickyNote.spec.ts"],
  },
  {
    section: "🔴 Laser pointer",
    text: /[Cc]ollaborator/,
    status: "covered",
    // The engine already drew and faded a per-peer trail, and painted it
    // (`engine/peers.rs` › `peer_laser`, `ci_laser.rs`) — the transient channel this once
    // called out as missing. What was missing was the host ever calling it: the `cursor`
    // frame carried no tool or button state, so a peer's laser never reached the wire.
    tests: [
      `${WEB}/realtime/peerLaser.test.ts`,
      `${WEB}/realtime/realtime.test.ts`,
      "e2e/peers.spec.ts",
    ],
  },
  {
    section: "🔴 Laser pointer",
    text: /Use during presentations/,
    status: "covered",
    // Presentation mode forces the laser tool for the length of the show — see
    // `presentation.ts` and `DrawSurface.svelte`'s `enterPresent`.
    tests: [`${WEB}/draw-chrome/presentation.test.ts`, "e2e/presentation.spec.ts"],
  },
  { section: "🔴 Laser pointer", status: "covered", tests: [`${ENGINE}/ci_laser.rs`] },
  // Same gap as "🧭 Navigation & canvas"'s: pointerInput.ts treats a middle-button press
  // like space, but nothing dispatches a middle-button pointer event to exercise it.
  {
    section: "✋ Hand / panning",
    text: /^Middle mouse drag/,
    status: "gap",
    why: "implemented, untested — pointerInput.ts treats a middle-button press the same as space, but no test dispatches one.",
  },
  {
    section: "✋ Hand / panning",
    status: "covered",
    tests: [`${ENGINE}/ci_pointer.rs`, "e2e/shortcuts.spec.ts"],
  },
  {
    section: "🧱 Web embeds",
    text: /^Activate Web Embed$/,
    status: "covered",
    // the_embed_is_reachable_by_its_own_key asserts 'w'/'W' select DrawTool::Embed.
    tests: [`${ENGINE}/ci_shortcuts.rs`],
  },
  {
    section: "🧱 Web embeds",
    text: /^Drag to create an embed region$/,
    status: "gap",
    why: "not implemented — embeds are placed through a URL-entry modal (DrawEmbedModal.svelte) at a fixed point; every test inserts via window.__drawEngine.insertEmbed directly, and there is no drag-to-create-a-region gesture anywhere.",
  },
  {
    section: "🧱 Web embeds",
    text: /^Paste supported embed URLs$/,
    status: "gap",
    why: "implemented, untested — the host allow-list and URL resolution are thoroughly tested (ci_embed.rs), but nothing pastes a URL through the modal or onto the canvas to trigger creation; every test calls insertEmbed directly.",
  },
  {
    section: "🧱 Web embeds",
    status: "covered",
    tests: [`${ENGINE}/ci_embed.rs`, `${WEB}/draw-chrome/embed.test.ts`, "e2e/embed.spec.ts"],
  },
  {
    section: "🧙 Magic Frame / Wireframe → Code",
    status: "out-of-scope",
    why: "A hosted AI service, not an engine feature. Nothing in the motor can implement it.",
  },
  {
    section: "🧜 Mermaid",
    text: /^Open Mermaid/,
    status: "gap",
    why: "implemented, untested — DrawMainMenu opens DrawMermaidModal.svelte, but no test exercises the menu action or the modal opening.",
  },
  {
    section: "🧜 Mermaid",
    text: /^Preview the generated diagram$/,
    status: "gap",
    why: "not implemented — DrawMermaidModal.svelte parses and inserts directly on its Insert button; there is no preview step shown before committing to the board.",
  },
  {
    section: "🧜 Mermaid",
    text: /^Supported diagram types include/,
    status: "gap",
    why: "overclaimed — only flowchart syntax is parsed (mermaidParser.ts's parseMermaidFlowchart); sequence, class, entity-relationship and state diagrams are not supported.",
  },
  {
    section: "🧜 Mermaid",
    text: /Paste Mermaid directly/,
    status: "gap",
    why: "not implemented as auto-detection — Mermaid syntax must be typed or pasted inside the manually-opened modal; a canvas-level paste does not detect or trigger it.",
  },
  {
    section: "🧜 Mermaid",
    status: "covered",
    tests: [`${WEB}/mermaid/mermaid.test.ts`],
  },
  {
    section: "🤖 AI / diagram generation",
    status: "out-of-scope",
    why: "A hosted AI service. The Mermaid import it would feed is implemented and tested.",
  },
  {
    section: "🔎 Search",
    status: "gap",
    why: "No scene search. Needs a text index over elements, result navigation and a highlight pass in the interactive layer.",
  },
  {
    section: "⚡ Command Palette",
    text: /recently used/i,
    status: "gap",
    why: "The registry ranks by fuzzy match alone; there is no usage history to give a recently-run command a boost the way the oracle's own palette does.",
  },
  {
    section: "⚡ Command Palette",
    status: "covered",
    // buildCommands (commandPalette.ts) turns real host actions — tools, view/zoom,
    // theme, grid/snap, Present, export, every style preset — into searchable commands;
    // DrawCommandPalette.svelte is the thin dialog over it. Track B, Part 1.
    tests: [`${WEB}/draw-chrome/commandPalette.test.ts`, "e2e/keyboardDiagram.spec.ts"],
  },
  {
    section: "🔲 Grid",
    text: /custom grid spacing|disable snapping/,
    status: "gap",
    why: "Spacing is offered as a fixed set of sizes in the menu, not a custom value. Ctrl/Cmd inverts snapping to objects but does not yet release the grid — see the Shapes rule above.",
  },
  {
    section: "🔲 Grid",
    status: "covered",
    tests: [`${ENGINE}/ci_grid.rs`, "e2e/shortcuts.spec.ts"],
  },
  {
    section: "🌙 Interface modes",
    text: /Zen mode|zen/i,
    status: "gap",
    why: "No zen mode. It is a host concern — hide the chrome — and needs nothing from the engine.",
  },
  {
    section: "🌙 Interface modes",
    text: /presentation-style workflows/,
    status: "covered",
    tests: [`${WEB}/draw-chrome/presentation.test.ts`, "e2e/presentation.spec.ts"],
  },
  {
    section: "🌙 Interface modes",
    status: "covered",
    tests: [`${WEB}/draw-chrome/theme.test.ts`],
  },
  {
    section: "📊 Stats / element information",
    status: "gap",
    why: "No stats panel. The numbers all exist on the element; this is an inspector surface and an edit path for them.",
  },
  {
    section: "📚 Library",
    text: /Reuse diagrams\/components\/templates/,
    status: "gap",
    why: "Five fixed starter boards exist now (`apps/web/src/lib/templates`, `DrawTemplatesModal.svelte`, `docs/reference/templates.md`, `e2e/templates.spec.ts`) — a catalog to start a board from, not a library: nothing lets a viewer save their own diagram or component and reuse it later.",
  },
  {
    section: "📚 Library",
    status: "gap",
    why: "No library. Needs item storage, preview rendering, id regeneration on insert and group preservation.",
  },
  {
    section: "📋 Clipboard tricks",
    text: /PNG|SVG|Google Docs|single element/,
    status: "gap",
    why: "Copy-as-image and rich external paste. SVG export exists (ci_export.rs) but is not wired to the clipboard.",
  },
  {
    section: "📋 Clipboard tricks",
    text: /Ctrl\/Cmd \+ C`.*Copy|Ctrl\/Cmd \+ X`.*Cut/,
    status: "gap",
    why: "implemented, untested — the C/X keys call copySelection/cutSelection and write to the clipboard (engine/src/host/keys.ts:139-148), but keys.test.ts only stubs copySelection/cutSelection in its mock session and never dispatches Ctrl+C or Ctrl+X to assert either is called; ci_edit.rs has no clipboard tests.",
  },
  {
    section: "📋 Clipboard tricks",
    text: /^Paste images directly$/,
    status: "covered",
    // "pasting an image places it, rather than the shapes copied earlier".
    tests: ["e2e/image.spec.ts"],
  },
  {
    section: "📋 Clipboard tricks",
    text: /^Paste text directly$/,
    status: "gap",
    why: "not implemented — same gap as design.md's Text paste: arbitrary clipboard text never becomes a text element (engine/src/host/keyboardInput.ts falls back to re-pasting the internal clipboard, which fails to parse plain text).",
  },
  {
    section: "📋 Clipboard tricks",
    text: /Paste Mermaid syntax to trigger Mermaid handling/,
    status: "gap",
    why: "not implemented as an auto-trigger — Mermaid syntax must be typed or pasted inside the manually-opened DrawMermaidModal; a canvas-level paste never detects or opens it (same gap as prompt/shortkey.md:321).",
  },
  {
    section: "📋 Clipboard tricks",
    status: "covered",
    tests: [`${ENGINE}/ci_edit.rs`, "engine/src/host/keys.test.ts"],
  },
  {
    section: "💾 Files",
    text: /PNG|read-only link/,
    status: "gap",
    why: "No PNG export and no read-only share link. SVG and JSON are done.",
  },
  // The binding is real; only the shortcut itself is unexercised — Save/export and
  // Import are covered through their underlying JSON pipeline below.
  {
    section: "💾 Files",
    text: /Ctrl\/Cmd \+ O` — Open\/load a scene/,
    status: "gap",
    why: "implemented, untested — DrawSurface.svelte's onAppShortcut binds mod+O to open the file picker (mainMenu.openFile()), but no test presses Ctrl/Cmd+O or drives the open flow.",
  },
  {
    section: "💾 Files",
    text: /editable source of truth/,
    status: "out-of-scope",
    why: "This app's source of truth is the board persisted server-side via autosave and MongoDB (CLAUDE.md's Autosave section); local files are .osidraw, not .excalidraw, and are only an export/import round-trip.",
  },
  {
    section: "💾 Files",
    status: "covered",
    tests: [`${ENGINE}/ci_export.rs`, `${ENGINE}/ci_persistence.rs`],
  },
  {
    section: "🔍 Export tricks",
    text: /PNG/,
    status: "gap",
    why: "No PNG export path. Planned as a server-side raster so it does not depend on a browser canvas.",
  },
  {
    section: "🔍 Export tricks",
    text: /frames/,
    status: "gap",
    why: "No per-frame export mode.",
  },
  {
    section: "🔍 Export tricks",
    text: /^Export selection$/,
    status: "gap",
    why: "No selection-scoped export anywhere: the export dialog and both engine.exportSvg/exportPng always export the whole scene.",
  },
  {
    section: "🔍 Export tricks",
    text: /^Copy selection as SVG$/,
    status: "gap",
    why: "SVG export exists (ci_export.rs) but nothing wires it to the clipboard — same missing plumbing as the Clipboard tricks section's 'copy as image' gap.",
  },
  {
    section: "🔍 Export tricks",
    text: /^Include\/exclude background depending on export settings$/,
    status: "gap",
    why: "scene_to_svg always renders a background rect; no option anywhere omits it.",
  },
  { section: "🔍 Export tricks", status: "covered", tests: [`${ENGINE}/ci_export.rs`] },
  {
    section: "👥 Collaboration",
    text: /Follow another|undo\/redo/,
    status: "gap",
    why: "Follow-mode and multiplayer-aware history. Presence, cursors and last-write-wins element sync are done. Presentation mode added a narrower follow — a peer's camera trailing a presenter's slide, in `presentation.ts` / `realtimeClient.ts`'s `present` message — but not the general case this line names: following anyone's view at any time.",
  },
  {
    section: "👥 Collaboration",
    text: /laser pointer during collaborative presentations/,
    status: "covered",
    tests: [
      `${WEB}/draw-chrome/presentation.test.ts`,
      `${WEB}/realtime/realtime.test.ts`,
      "e2e/presentation.spec.ts",
    ],
  },
  {
    section: "👥 Collaboration",
    status: "covered",
    tests: [
      `${WEB}/realtime/realtime.test.ts`,
      `${WEB}/realtime/roomCrypto.test.ts`,
      `${WEB}/draw-chrome/share.test.ts`,
      "e2e/share.spec.ts",
      `${ENGINE}/ci_remote_patch.rs`,
    ],
  },

  // ------------------------------------------------- shortkey.md, closing sections
  {
    section: "Presentations",
    text: /Use frames as slides|Zoom to the relevant frame|Use Laser Pointer|Use Live Collaboration for remote presentations/,
    status: "covered",
    // Present mode: `slidesFromScene` takes the board's frames as slides, `fitCamera`
    // zooms to each, the tool is forced to the laser, and — Part 2 — `present`/
    // `present-end` let a peer's Follow track it live.
    tests: [
      `${WEB}/draw-chrome/presentation.test.ts`,
      `${WEB}/draw-chrome/camera.test.ts`,
      `${WEB}/realtime/realtime.test.ts`,
      "e2e/presentation.spec.ts",
    ],
  },
  {
    section:
      /^(🧪 Hidden|⭐ Muscle-memory|🚀 High-productivity|Fast diagramming|Architecture diagrams|UI wireframing|Presentations|Brainstorming|🧠 "I don't remember|🔥 Current-feature)/,
    status: "out-of-scope",
    why: "A recap of features listed earlier in the same document, or a workflow made of them. Classified where each feature is first named rather than twice.",
  },

  // ---------------------------------------------------------------- design.md
  {
    section: "1. Core architecture",
    text: /locked state/,
    status: "covered",
    tests: [`${ENGINE}/ci_group_locks_frames.rs`, `${ENGINE}/ci_hover.rs`],
  },
  // What the next element is drawn with, carved out of the section rule, which claimed the
  // next arrowhead while choosing one with nothing selected did nothing.
  {
    section: "1. Core architecture",
    text: /Current font|Current arrowhead/,
    status: "covered",
    tests: [`${ENGINE}/ci_next_style.rs`, "e2e/arrowType.spec.ts", "e2e/fontSize.spec.ts"],
  },
  // A text bound into a shape, given back, or wrapped in a new one — the context menu's
  // bound-text actions (actionBoundText.tsx@1118751f).
  {
    section: "1. Core architecture",
    text: /Element container relationships/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_bound_text_actions.rs`,
      `${ENGINE}/ci_text_model.rs`,
      "e2e/boundText.spec.ts",
    ],
  },
  {
    section: "1. Core architecture",
    text: /custom data|library|visibility/i,
    status: "gap",
    why: "Three fields the element schema does not carry yet: customData, library membership, explicit visibility.",
  },
  {
    section: "1. Core architecture",
    text: /Collaboration state|Sidebar state|Modal\/menu state/,
    status: "gap",
    why: "Host-side editor state that lives in Svelte rather than in the engine, and is not covered by a test.",
  },
  // Not persisted at all, by design: the `.osidraw` envelope (packages/contract/src/board.ts)
  // carries only `type`/`version`/`elements` — see CLAUDE.md's boundary rule. The section rule
  // below claimed both from the same four files that never mention either concept.
  {
    section: "1. Core architecture",
    text: /^appState$/,
    status: "out-of-scope",
    why: "Editor/appState never crosses the boundary — only the elements array is persisted. appState lives in the host and the in-memory engine, not the saved document.",
  },
  {
    section: "1. Core architecture",
    text: /^files$/,
    status: "out-of-scope",
    why: "An image carries its own base64 picture inline on the element (packages/contract/tests/element.test.ts › \"an image's picture\") rather than a separate top-level files map keyed by fileId, as Excalidraw's format has.",
  },
  // The "current style" patch pipeline (DrawElementStylePatch, applied by apply_style /
  // set_next_style) is exercised for color, width and opacity in ci_style.rs, which the
  // section rule below already names. Roughness and roundness go through the same struct but
  // are only ever asserted in ci_style_patch.rs; stroke style and fill style are not asserted
  // being *set* anywhere — ci_selection_style.rs only reads them back for the inspector.
  {
    section: "1. Core architecture",
    text: /Current stroke style|Current fill style/,
    status: "gap",
    why: "implemented, untested — DrawElementStylePatch carries stroke_style and fill_style, but no test patches either field through apply_style or set_next_style.",
  },
  {
    section: "1. Core architecture",
    text: /Current roughness|Current roundness/,
    status: "covered",
    tests: [`${ENGINE}/ci_style_patch.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^Active tool$/,
    status: "covered",
    // Tool switching and its effects (hand pans, eraser deletes, select clicks, drawing
    // resets to select) — the section rule below never names the file that exercises it.
    tests: [`${ENGINE}/ci_pointer.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^Hovered elements$/,
    status: "covered",
    tests: [`${ENGINE}/ci_hover.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^Editing element$/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_edit.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^Current group$/,
    status: "covered",
    tests: [`${ENGINE}/ci_group_editing.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^Current frame$|Element frame membership/,
    status: "covered",
    tests: [`${ENGINE}/ci_frame.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^Grid state$/,
    status: "covered",
    tests: [`${ENGINE}/ci_grid.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^Snap state$/,
    status: "covered",
    tests: [`${ENGINE}/ci_snapping.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^Binding state$|Element binding relationships/,
    status: "covered",
    tests: [`${ENGINE}/ci_binding.rs`, `${ENGINE}/ci_binding_anchor.rs`],
  },
  {
    section: "1. Core architecture",
    text: /^View-only state$/,
    status: "gap",
    why: "No read-only/view-only mode exists in the engine or the host UI — every peer who can open a board can edit it.",
  },
  {
    section: "1. Core architecture",
    text: /Dark\/light theme/,
    status: "covered",
    tests: [`${WEB}/draw-chrome/theme.test.ts`],
  },
  {
    section: "1. Core architecture",
    text: /^Scroll\/pan$/,
    status: "covered",
    tests: [`${ENGINE}/ci_scroll.rs`],
  },
  {
    section: "1. Core architecture",
    status: "covered",
    tests: [
      `${ENGINE}/ci_persistence.rs`,
      `${ENGINE}/ci_style.rs`,
      `${ENGINE}/ci_edit.rs`,
      "packages/contract/tests/element.test.ts",
    ],
  },
  // groupIds is exercised by the grouping engine tests, seed by the shape-cache tests that key
  // on it for deterministic rough rendering — neither of the section rule's two named files
  // asserts either field.
  {
    section: "2. Element system",
    status: "covered",
    tests: [`${ENGINE}/ci_edit.rs`, `${ENGINE}/ci_shape_cache.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /Lock/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_group_locks_frames.rs`,
      `${ENGINE}/ci_hover.rs`,
      `${ENGINE}/ci_lasso.rs`,
      `${ENGINE}/ci_eraser.rs`,
      `${WEB}/draw-chrome/menu.test.ts`,
    ],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /Snap to nearby objects/,
    status: "gap",
    why: "Snapping to objects, and its Ctrl/Cmd inversion, applies to moving a selection only (ci_objects_snap.rs). Drawing and resizing snap to the grid but not to other elements, where Excalidraw's snapNewElement and snapResizingElements (App.tsx:13375, :13499) do.",
  },
  // The section rule below claimed a creation gesture that grows from the pointer-down
  // point, not from a centre, while nothing reads Alt (or any modifier) during a draft
  // drag — the same missing shouldResizeFromCenter counterpart the "Shapes" gap above
  // already records for resizing.
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^(Click \+ drag from center|Alt\/Option centered creation)$/,
    status: "gap",
    why: "A new shape always grows from where the drag began, never from its centre. Alt is read during a resize (ci_selection.rs) but not while drawing (docs/reference/resize.md › Divergences; pointer_move.rs's Draft branch never reads alt_held).",
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^(Shift constrained square|Shift → circle)$/,
    status: "covered",
    tests: [`${ENGINE}/draw_engine.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Snap to grid$/,
    status: "covered",
    tests: [`${ENGINE}/ci_grid.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Drag cancellation$/,
    status: "covered",
    tests: [`${ENGINE}/ci_history_selection.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Move$/,
    status: "covered",
    tests: [`${ENGINE}/ci_version_stamps.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Duplicate$/,
    status: "covered",
    tests: [`${ENGINE}/ci_duplicate.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Copy\/paste$/,
    status: "covered",
    tests: [`${ENGINE}/ci_persistence.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^(Change )?[Rr]oughness$/,
    status: "covered",
    tests: [`${ENGINE}/ci_style_patch.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Change roundness$/,
    status: "covered",
    tests: [`${ENGINE}/ci_style_patch.rs`],
  },
  // Intersection testing itself (marquee vs. rotated box) is already in the section
  // rule's own ci_hit_rotated.rs, so it needs no carve-out; ci_bucket_fill.rs's
  // "intersect" hits are segment math for the flood fill, a different claim entirely.
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Selection outline$/,
    status: "gap",
    why: "Implemented, untested: no test asserts the selection highlight's own outline geometry as distinct from the bounding-box tests already covering this section — ci_hit_fill.rs's \"outline band\" is hit-testing a hollow shape, a different claim.",
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Connector attachment( points)?$/,
    status: "covered",
    tests: [`${ENGINE}/ci_binding.rs`, `${ENGINE}/draw_binding.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /^Text\/container behavior$/,
    status: "covered",
    tests: [`${ENGINE}/ci_text.rs`, `${ENGINE}/ci_text_model.rs`],
  },
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_pointer.rs`,
      `${ENGINE}/ci_selection.rs`,
      `${ENGINE}/ci_handles.rs`,
      `${ENGINE}/ci_hit_rotated.rs`,
      `${ENGINE}/ci_geometry.rs`,
      `${ENGINE}/ci_style.rs`,
    ],
  },
  // `a_line_never_binds_to_a_shape` — deliberately, correctly, and tested: only Arrow
  // binds, matching the oracle. Creation and point-adding are the rest of this file.
  {
    section: "6. Line",
    text: /^Click-drag creation$|^Multi-point lines$|^Add point$|^Binding$/,
    status: "covered",
    tests: [`${ENGINE}/ci_line_multipoint.rs`],
  },
  {
    section: "6. Line",
    text: /^Remove point$/,
    status: "gap",
    why: "Not implemented — no backspace/undo-last-point exists while placing a multi-point line (multi_linear.rs).",
  },
  {
    section: "6. Line",
    text: /^Move entire line$|^Rotate$/,
    status: "gap",
    why: "Implemented, untested: no test moves or rotates a Line-kind (multi-point) element specifically and checks its points.",
  },
  // A polyline's corner-handle resize and its individual point handles, from the general
  // handle suite rather than this section's own files.
  {
    section: "6. Line",
    text: /^Move individual points$|^Resize$/,
    status: "covered",
    tests: [`${ENGINE}/ci_handles.rs`],
  },
  {
    section: "6. Line",
    text: /^Start\/end arrows$/,
    status: "covered",
    tests: [`${ENGINE}/ci_style.rs`],
  },
  {
    section: "6. Line",
    text: /^Hit testing$/,
    status: "covered",
    tests: [`${ENGINE}/ci_hit_fill.rs`],
  },
  // Dragging a midpoint handle splits the segment; removing a middle point is its
  // inverse — both are inline tests in the module itself.
  {
    section: "6. Line",
    text: /^Point insertion$|^Point deletion$/,
    status: "covered",
    tests: ["engine/crates/draw-engine/src/selection/linear.rs"],
  },
  // Not to be confused with the 45°-angle constrain the section rule below's ci_snapping.rs
  // genuinely tests (constrain_to_angle) — this is a line's own endpoint snapping to a
  // *nearby element*, and nothing in the crate computes that; a line does not even bind
  // (see the rule above), let alone snap short of binding.
  {
    section: "6. Line",
    text: /^Endpoint snapping$/,
    status: "gap",
    why: "No snap-to-object exists for a line's own endpoint while drawing or dragging it; only the move-selection alignment guides (ci_snapping.rs) and the 45° draw constraint (draw_binding.rs) exist.",
  },
  {
    section: "6. Line",
    status: "covered",
    tests: [`${ENGINE}/ci_linear_anchor.rs`, `${ENGINE}/ci_snapping.rs`, `${ENGINE}/ci_binding.rs`],
  },
  {
    section: "7. Arrow",
    text: /[Ee]lbow|label positioning/,
    status: "gap",
    why: "Elbow arrows: see the Advanced arrows rules. Label positioning: a label sits on the middle of its arrow's path (linear_label_center, getBoundTextElementCenter), but cannot be dragged along it — Excalidraw's labelPosition (linearElementEditor.ts@1118751f:1962-2030) is not ported.",
  },
  {
    section: "7. Arrow",
    text: /Arrowhead|Straight arrows|Curved arrows/,
    status: "covered",
    tests: [`${ENGINE}/ci_next_style.rs`, `${ENGINE}/ci_style.rs`, "e2e/arrowType.spec.ts"],
  },
  {
    section: "7. Arrow",
    text: /label\/text/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_model.rs`, `${ENGINE}/ci_export.rs`, "e2e/textEditRequest.spec.ts"],
  },
  {
    section: "7. Arrow",
    status: "covered",
    tests: [`${ENGINE}/ci_binding.rs`, `${ENGINE}/ci_linear_anchor.rs`, `${ENGINE}/ci_style.rs`],
  },
  {
    section: "8. Freedraw / pencil",
    text: /[Pp]ressure|stylus|[Pp]alm|[Tt]ouch|[Ss]tabiliz|[Ss]moothing|interpolation|pen vs/,
    status: "gap",
    why: "No perfect-freehand pipeline: pressure, stabilisation and variable width all come with it, and so does pen/touch discrimination.",
  },
  {
    section: "8. Freedraw / pencil",
    text: /^Point simplification$/,
    status: "gap",
    why: "not implemented — points are only streamlined (jitter-smoothed via freehand::streamline, engine/src/engine/pointer_move.rs) as they arrive; there is no point-count reduction pass.",
  },
  {
    section: "8. Freedraw / pencil",
    text: /^Rough rendering$/,
    status: "gap",
    why: "No test asserts a hand-drawn look for freedraw specifically — ci_render_drawable.rs (not named by the section rule) only checks that element_drawable does not panic for every kind including Freedraw, never that the result looks rough.",
  },
  {
    section: "8. Freedraw / pencil",
    text: /^Erasing$/,
    status: "covered",
    // a_freehand_stroke_is_erased_by_its_ink_not_its_box tests exactly this.
    tests: [`${ENGINE}/ci_eraser.rs`],
  },
  {
    section: "8. Freedraw / pencil",
    text: /^Hit testing$/,
    status: "covered",
    // content_elements_are_never_hollow hit-tests a Freedraw element's middle.
    tests: [`${ENGINE}/ci_hit_fill.rs`],
  },
  {
    section: "8. Freedraw / pencil",
    text: /^Transform$/,
    status: "covered",
    // stroke_at builds a Freedraw element whose points are scaled under a group resize.
    tests: [`${ENGINE}/ci_group_resize.rs`],
  },
  {
    section: "8. Freedraw / pencil",
    text: /^Undo$/,
    status: "covered",
    // ci_history.rs (named below) never mentions freedraw; undoing_a_pencil_stroke_selects_nothing
    // (ci_history_selection.rs) is the real test.
    tests: [`${ENGINE}/ci_history_selection.rs`],
  },
  {
    section: "8. Freedraw / pencil",
    status: "covered",
    tests: [`${ENGINE}/ci_pointer.rs`, `${ENGINE}/ci_recognize.rs`, `${ENGINE}/ci_history.rs`],
  },
  // Both alignments, carved out of the gap below. They were listed with the rest of text
  // formatting as waiting on font metrics, which turned out to be true of the others but
  // not of these: alignment is where the anchor goes and where the label sits, and both
  // are arithmetic over a width the engine already measures.
  {
    section: "9. Text",
    text: /[Aa]lignment/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_align.rs`, "e2e/textAlign.spec.ts"],
  },
  // The editor the engine asks the host to open, laid over the text by the session the
  // engine keeps while it is typed: its box, font, size and wrap come from the session's
  // layout, read again after every keystroke and camera move.
  {
    section: "9. Text",
    text: /Text editing mode|Font size|Double click edit/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_text.rs`,
      `${ENGINE}/ci_text_model_compat.rs`,
      `${ENGINE}/ci_text_edit.rs`,
      `${ENGINE}/ci_next_style.rs`,
      "e2e/textEditRequest.spec.ts",
      "e2e/textEditor.spec.ts",
      "e2e/fontSize.spec.ts",
    ],
  },
  // Laid out as Excalidraw lays it out (docs/reference/text-model.md › Layout): a label
  // wrapped inside its shape's text box and the shape grown to hold it, an arrow's label at
  // the oracle's width with the stroke cut under it, free text sized to its lines, and
  // each family's own line height drawn, measured and exported.
  {
    section: "9. Text",
    text: /Text inside shapes|inside arrows|Auto-resize|[Ll]ine height/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_text_model.rs`,
      `${ENGINE}/ci_export.rs`,
      "e2e/textLayout.spec.ts",
      "e2e/textEditRequest.spec.ts",
    ],
  },
  // Wrapping. The wrap is Excalidraw's textWrapping.ts ported line for line
  // (docs/reference/text.md), every layout wraps from originalText, and a resize handle lays
  // text out on every move of its drag (docs/reference/resize.md › Text and labels).
  {
    section: "9. Text",
    text: /Wrapping/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_text_wrap_oracle.rs`,
      `${ENGINE}/ci_text_box.rs`,
      `${ENGINE}/ci_text_model.rs`,
      `${ENGINE}/ci_text_resize.rs`,
      "e2e/textResize.spec.ts",
    ],
  },
  // A text's east or west side fixes its width and wraps it there, and widening it unwraps;
  // "Enable text auto-resizing" in the context menu, or Grow in the panel's Text wrap row,
  // gives it its own width back (actionTextAutoResize.ts@1118751f). Excalidraw's reset
  // handle beside a fixed-width text is not drawn: docs/reference/resize.md records it.
  {
    section: "9. Text",
    text: /Fixed-width/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_text_resize.rs`,
      `${ENGINE}/ci_text_model.rs`,
      `${WEB}/draw-chrome/menu.test.ts`,
      `${WEB}/draw-chrome/inspector.test.ts`,
      "e2e/textResize.spec.ts",
    ],
  },
  // Drawn, measured and exported in its family, and chosen from the panel's font picker,
  // its face loaded first. Liberation Sans is not shipped: the file Excalidraw ships is
  // Liberation 1.05, under Red Hat's GPL v2 font-exception licence, not the OFL of 2.00
  // and later (apps/web/static/fonts/LICENSES.md) — and the oracle's picker never lists
  // it either; a text in it is drawn in the fallback (docs/reference/console.md › Gaps).
  {
    section: "9. Text",
    text: /Font family/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_text_model.rs`,
      `${ENGINE}/ci_next_style.rs`,
      `${WEB}/draw-chrome/fonts.test.ts`,
      "e2e/textLayout.spec.ts",
      "e2e/fontPicker.spec.ts",
    ],
  },
  {
    section: "9. Text",
    text: /IME support/,
    status: "covered",
    tests: [`${WEB}/draw-chrome/textEditor.test.ts`, "e2e/textEditor.spec.ts"],
  },
  {
    section: "9. Text",
    text: /Bold|Italic|[Ll]etter spacing/,
    status: "gap",
    why: "Excalidraw has none of them either.",
  },
  // A single click with the Text tool — the section rule below names only the files that
  // cover the double-click path (existing shapes, existing text).
  {
    section: "9. Text",
    text: /^Click to create$/,
    status: "covered",
    tests: [`${ENGINE}/ci_pointer.rs`],
  },
  // Below TEXT_BOX_MIN_DRAG a click auto-sizes; a real drag fixes the width to the column
  // dragged out (`end_text`, pointer_end.rs) — asserted in ci_text_box.rs, not either file
  // the section rule names.
  {
    section: "9. Text",
    text: /^Drag to create constrained text$/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_box.rs`],
  },
  {
    section: "9. Text",
    text: /^(Color|Opacity)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_style.rs`],
  },
  {
    section: "9. Text",
    text: /^Blur$/,
    status: "gap",
    why: "implemented, untested — commit_text_edit takes a via_keyboard flag and the false (blur) branch is real, but no test ever calls it that way; every test that ends an edit does so via Escape, Enter or a direct API call.",
  },
  // The editor is a plain textarea (textEditor.test.ts's own "is a textarea..." case), so
  // caret placement and in-editor text selection are the browser's native behaviour — real,
  // but nothing in this project's own tests asserts a caret position or a text selection.
  {
    section: "9. Text",
    text: /^(Cursor|Selection)$/,
    status: "gap",
    why: "implemented, untested — the editor is a native textarea, so caret and selection behaviour comes from the browser; no test asserts either directly.",
  },
  {
    section: "9. Text",
    text: /^Resize$/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_resize.rs`],
  },
  {
    section: "9. Text",
    text: /^Rotate$/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_model.rs`],
  },
  // A label's own frame membership, kept separate from its container's (a_bound_label_is_not
  // _captured_on_its_own) — neither file below is about frames.
  {
    section: "9. Text",
    text: /^Text inside frames$/,
    status: "covered",
    tests: [`${ENGINE}/ci_frame.rs`],
  },
  {
    section: "9. Text",
    status: "covered",
    tests: [
      `${ENGINE}/ci_text.rs`,
      `${ENGINE}/ci_text_edit.rs`,
      `${WEB}/draw-chrome/textEditor.test.ts`,
      "e2e/textEditor.spec.ts",
    ],
  },
  {
    section: "10. Images",
    text: /Crop|Replace image|Broken-image|WebP/,
    status: "gap",
    why: "Cropping, replacement and a broken-image state. Decode currently accepts what the browser accepts, which is not asserted per format.",
  },
  {
    section: "10. Images",
    text: /Image IDs|Image file store/,
    status: "gap",
    why: "The picture rides on the element as a data: URL rather than in a file store keyed by id. Everything works through it, but a board is one Mongo document, so two or three large pictures reach the 16MB ceiling — now refused with a 413 (apps/api/tests/integration/images.test.ts) rather than a 500. See docs/reference/images.md.",
  },
  {
    section: "10. Images",
    text: /^Rotate$/,
    status: "gap",
    why: "Rotation is a generic transform-engine feature (ci_handles.rs), but no test rotates an inserted image specifically to confirm it behaves the same way.",
  },
  {
    section: "10. Images",
    text: /^Copy\/paste$/,
    status: "gap",
    why: "implemented, untested — duplicating or copying an existing image element is never exercised with an image; ci_duplicate.rs and ci_persistence.rs's copy/paste tests use rectangles only, so the data URL is never checked to survive.",
  },
  {
    section: "10. Images",
    status: "covered",
    tests: [
      `${ENGINE}/ci_image.rs`,
      `${WEB}/draw-chrome/imageFile.test.ts`,
      "e2e/image.spec.ts",
      "apps/api/tests/integration/images.test.ts",
    ],
  },
  // stroke_color on a note is repurposed as the date footer's ink (paint_sticky in
  // wasm/paint.rs fills the footer text with it) — nothing paints a border with it. A
  // sticky note has a background paper and a fixed drop-shadow, never a colored outline.
  {
    section: "11. Sticky notes",
    text: /^Border color$/,
    status: "gap",
    why: "not implemented — a note's stroke_color is the date footer's ink, not a border; nothing renders an outline in it.",
  },
  // angle is a plain field a note shares with every element, and ci_sticky.rs's
  // a_turned_note_grows_from_its_top_edge sets it directly to check the resize math
  // around a pre-rotated note — no test drives the rotation handle on a sticky note.
  {
    section: "11. Sticky notes",
    text: /^Rotate$/,
    status: "gap",
    why: "implemented, untested — a note rotates like any element (angle field, resize math accounts for it), but no test drags its rotation handle.",
  },
  {
    section: "11. Sticky notes",
    status: "covered",
    tests: [
      `${ENGINE}/ci_sticky.rs`,
      "e2e/stickyNote.spec.ts",
      `${WEB}/draw-chrome/shapeActions.test.ts`,
      `${WEB}/draw-chrome/inspector.test.ts`,
      `${WEB}/notes/stickyNotes.test.ts`,
      "packages/contract/tests/element.test.ts",
      "apps/api/tests/integration/boards.test.ts",
    ],
  },
  // Same rename, the design doc's own line for it.
  {
    section: "12. Frames",
    text: /Rename/,
    status: "covered",
    tests: [`${ENGINE}/ci_frame.rs`, "e2e/frames.spec.ts"],
  },
  {
    section: "12. Frames",
    text: /Export frame|Frame navigation/,
    status: "gap",
    why: "See the Frames rule: export has no frame mode, and nothing navigates frame to frame.",
  },
  // Resize handles are not excluded for DrawElementType::Frame, so dragging one works the
  // same as any rectangle-shaped element — but no test drags a frame's own handle and
  // checks its children re-clip against the new bounds.
  {
    section: "12. Frames",
    text: /^Resize frame$/,
    status: "gap",
    why: "implemented, untested — a frame resizes through the generic handle path, but no test drags one and checks membership re-clips.",
  },
  // No action selects a frame's children as a set — clicking the frame's border selects
  // only the frame (a_frame_is_grabbed_by_its_border_and_not_through_its_middle).
  {
    section: "12. Frames",
    text: /^Select contents$/,
    status: "gap",
    why: "not implemented — selecting a frame selects the frame itself; nothing selects what is inside it as a set.",
  },
  {
    section: "12. Frames",
    // Frame ordering — what is drawn, pasted or dragged into a frame, or taken in by one
    // drawn or resized, goes directly below it — is pinned in ci_zorder.rs.
    status: "covered",
    tests: [
      `${ENGINE}/ci_frame.rs`,
      `${ENGINE}/ci_group_locks_frames.rs`,
      `${ENGINE}/ci_zorder.rs`,
    ],
  },
  {
    section: "13. Embeds",
    text: /Loading state|Error state|Export fallback|View-only/,
    status: "gap",
    why: "Embed lifecycle states. URL recognition, the allow-list and geometry are done.",
  },
  {
    section: "13. Embeds",
    status: "covered",
    tests: [`${ENGINE}/ci_embed.rs`, `${WEB}/draw-chrome/embed.test.ts`, "e2e/embed.spec.ts"],
  },
  {
    section: "14. Selection engine",
    text: /Select locked/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_group_locks_frames.rs`,
      `${ENGINE}/ci_hover.rs`,
      `${ENGINE}/ci_lasso.rs`,
      `${ENGINE}/ci_eraser.rs`,
      `${WEB}/draw-chrome/menu.test.ts`,
    ],
  },
  {
    section: "14. Selection engine",
    text: /Locked indicators/,
    status: "gap",
    why: "Nothing on the canvas marks a locked element; only the context menu, which offers Unlock (menu.test.ts).",
  },
  {
    section: "14. Selection engine",
    text: /^(Click element|Click empty canvas)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_pointer.rs`],
  },
  {
    section: "14. Selection engine",
    text: /^Shift-click (add|remove)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_multi_select.rs`],
  },
  // A marquee always tests containment, never overlap — a_marquee_that_merely_clips_a_shape
  // _leaves_it is the point of the rule, so a left-to-right drag and the shift-additive case
  // are both real, just not in any of the four files the section rule names.
  {
    section: "14. Selection engine",
    text: /^(Drag left → right|Containment mode|Shift additive selection)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_multi_select.rs`],
  },
  {
    section: "14. Selection engine",
    text: /^Drag right → left$/,
    status: "gap",
    why: "A marquee has no direction: dragging it either way tests the same containment (ci_multi_select.rs). There is no separate right-to-left gesture.",
  },
  {
    section: "14. Selection engine",
    text: /^Intersection mode$/,
    status: "gap",
    why: "Deliberately not ported — Excalidraw's getElementsWithinSelection is containment-only here so a small marquee across a big background shape does not sweep it up too (ci_multi_select.rs comment on a_marquee_that_merely_clips_a_shape_leaves_it).",
  },
  {
    section: "14. Selection engine",
    text: /^Group indicators$/,
    status: "gap",
    why: "No visual marker distinguishes a selected group from a selected single element; same gap as Locked indicators above.",
  },
  // Only the "add" half is real: a lasso's `base` is either the whole existing selection
  // (Shift held) or empty (`engine/pointer.rs`'s Lasso branch) — there is no subtractive
  // path, so "remove" was never exercised by ci_lasso.rs's additive-only test.
  {
    section: "14. Selection engine",
    text: /^Add\/remove modifiers$/,
    status: "gap",
    why: "Add is real (ci_lasso.rs's an_additive_loop_keeps_what_was_already_selected); there is no remove/subtractive modifier for the lasso at all.",
  },
  {
    section: "14. Selection engine",
    status: "covered",
    tests: [
      `${ENGINE}/ci_selection.rs`,
      `${ENGINE}/ci_lasso.rs`,
      `${ENGINE}/ci_handles.rs`,
      `${ENGINE}/ci_hit_fill.rs`,
    ],
  },
  {
    section: "15. Transform engine",
    // Was a gap while nothing read Alt during a resize. Every handle now scales about the
    // frame's own centre while Alt is held — one element or a selection, composed with
    // Shift's aspect lock (shouldResizeFromCenter, resizeElements.ts@1118751f:621-727,
    // 1052-1059).
    text: /Alt center scaling/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_selection.rs`,
      `${ENGINE}/ci_group_resize.rs`,
      `${ENGINE}/ci_text_resize.rs`,
      "e2e/resizeCenter.spec.ts",
    ],
  },
  // A plain drag translates one element, and the same gesture on a multi-selection member
  // carries the rest along — neither file the section rule names below drives a drag at all.
  {
    section: "15. Transform engine",
    text: /^(Mouse drag|Multi-selection movement)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_multi_select.rs`],
  },
  // Keyboard translation: the host maps the key to a delta (1px, 10px with Shift) and the
  // engine bumps the version for it — neither half is in the section rule's file list.
  {
    section: "15. Transform engine",
    text: /^(Arrow keys|Shift movement)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_version_stamps.rs`, "engine/src/host/keys.test.ts"],
  },
  {
    section: "15. Transform engine",
    text: /^Fine movement$/,
    status: "gap",
    why: "No modifier gives a smaller nudge than the plain 1px arrow-key step. Alt+Arrow is taken for flowchart navigation instead (engine/src/host/keys.test.ts).",
  },
  {
    section: "15. Transform engine",
    text: /^Negative dimensions normalization$/,
    status: "covered",
    tests: [`${ENGINE}/ci_geometry.rs`],
  },
  {
    section: "15. Transform engine",
    text: /^(Angle snapping|Shift angle locking)$/,
    status: "gap",
    why: "rotate_element (selection/transform.rs) takes only the pointer position — no modifier or snap increment reaches it, so a rotation is never quantised.",
  },
  // Rotating a multi-element selection together — the concrete case is bound arrows staying
  // attached through the turn, which needs every member to have turned, not just one shape.
  {
    section: "15. Transform engine",
    text: /^Multi-selection rotation$/,
    status: "covered",
    tests: [`${ENGINE}/ci_binding_anchor.rs`],
  },
  {
    section: "15. Transform engine",
    text: /^Frames$/,
    status: "covered",
    tests: [`${ENGINE}/ci_frame.rs`],
  },
  {
    section: "15. Transform engine",
    text: /^Attached labels$/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_model.rs`],
  },
  {
    section: "15. Transform engine",
    text: /^Selection$/,
    status: "gap",
    why: "implemented, untested — nothing asserts a selection survives its own transform rather than merely appearing to, since every resize/rotate test re-reads the element by id rather than checking selection state afterward.",
  },
  {
    section: "15. Transform engine",
    status: "covered",
    tests: [
      `${ENGINE}/ci_selection.rs`,
      `${ENGINE}/ci_handles.rs`,
      `${ENGINE}/ci_hit_rotated.rs`,
      `${ENGINE}/ci_binding.rs`,
      `${ENGINE}/ci_history.rs`,
      // Text, containers and attached labels as a resize reaches them.
      `${ENGINE}/ci_text_resize.rs`,
      `${ENGINE}/ci_group_resize.rs`,
      "e2e/textResize.spec.ts",
    ],
  },
  {
    section: "16. Grouping",
    // Was a gap reading "groups are flat", which stopped being true when `group_id`
    // became `group_ids`. The array *is* the hierarchy, and `selected_group_for` walks
    // it; double click enters, Escape and a click outside leave.
    text: /Nested|Enter group|Exit group|Select group/,
    status: "covered",
    tests: [`${ENGINE}/ci_groups_nested.rs`, `${ENGINE}/ci_group_editing.rs`, "e2e/groups.spec.ts"],
  },
  {
    section: "16. Grouping",
    status: "covered",
    tests: [
      `${ENGINE}/ci_edit.rs`,
      `${ENGINE}/ci_groups_nested.rs`,
      `${ENGINE}/ci_group_structure.rs`,
      `${ENGINE}/ci_group_locks_frames.rs`,
      "e2e/groups.spec.ts",
    ],
  },
  // Deletion tombstones an element in place rather than removing it from the array
  // (z-order is array position, CLAUDE.md), so the rest are stable by construction — but
  // no test deletes from a stack and checks the survivors keep their relative order.
  {
    section: "17. Z-order",
    text: /^Stable ordering after deletion$/,
    status: "gap",
    why: "implemented, untested — deletion tombstones in place rather than reindexing, so order should be stable by construction, but no test asserts it.",
  },
  {
    section: "17. Z-order",
    // Frames, groups, labels and the entered group as the oracle's own zindex.test.tsx
    // pins them; undo and redo of a reorder in ci_version_stamps.rs. Paste ordering: on
    // top, or directly below the frame it lands in, as what is drawn or dragged into one
    // goes (ci_zorder.rs, frame.ts@1118751f:521-635). Ctrl+D: each copy lands directly
    // above its own run — a group, a frame's children, a container's label — rather than
    // on top of the board (ci_duplicate.rs, duplicate.ts@1118751f:322-436).
    status: "covered",
    tests: [
      `${ENGINE}/ci_edit.rs`,
      `${ENGINE}/ci_group_structure.rs`,
      `${ENGINE}/ci_zorder.rs`,
      `${ENGINE}/ci_duplicate.rs`,
      `${ENGINE}/ci_version_stamps.rs`,
      "e2e/zorder.spec.ts",
    ],
  },
  {
    section: "18. Binding system",
    // Which shape wins, the suggestion before anything is drawn, and an end that turns
    // with its shape — the last claimed by the section rule while the attachment ignored
    // the turn entirely.
    text: /priority|suggestion|visuali|rotating target/i,
    status: "covered",
    tests: [`${ENGINE}/ci_binding_anchor.rs`, `${ENGINE}/ci_binding_dense.rs`],
  },
  {
    section: "18. Binding system",
    // Carved out of the section rule, which named tests that never exercised it. Moving a
    // bound arrow on its own used to be impossible — each frame re-resolved its ends onto
    // its shapes and put it back — so "unbind" was claimed covered while the gesture that
    // performs it did nothing at all.
    text: /^Unbind$|^Rebind$/,
    status: "covered",
    tests: [`${ENGINE}/ci_arrow_drag.rs`, "e2e/arrowDrag.spec.ts"],
  },
  {
    section: "18. Binding system",
    status: "covered",
    tests: [
      `${ENGINE}/ci_binding.rs`,
      `${ENGINE}/ci_binding_overlap.rs`,
      `${ENGINE}/ci_binding_dense.rs`,
    ],
  },
  {
    section: "19. Snapping",
    text: /Equal spacing|Configurable increments|Configurable grid|Connection points/,
    status: "gap",
    why: "Equal-spacing guides and configurable increments. Edge, centre, midpoint and 45° snapping are done.",
  },
  // constrain_to_angle (interaction/linear_drag.rs) rounds a drag to the nearest 45° step.
  // draw_binding.rs's shift_snaps_to_45 exercises the horizontal case (dy rounds to 0 for
  // a shallow drag) and the 45° case (dx == dy for a near-diagonal one); nothing feeds it a
  // near-vertical drag to exercise the 90° case.
  {
    section: "19. Snapping",
    text: /^Horizontal$/,
    status: "covered",
    tests: [`${ENGINE}/draw_binding.rs`],
  },
  {
    section: "19. Snapping",
    text: /^Vertical$/,
    status: "gap",
    why: "Implemented (constrain_to_angle snaps to any 45° multiple, 90° included), but no test feeds it a near-vertical drag — draw_binding.rs's shift_snaps_to_45 only exercises the horizontal and 45° cases.",
  },
  // Where an arrow lands on a bindable shape: attach_point_box_direction and
  // element_center_calculation are the edge and centre halves, neither named below.
  {
    section: "19. Snapping",
    text: /^(Shape edges|Shape centers)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_binding.rs`],
  },
  {
    section: "19. Snapping",
    status: "covered",
    tests: [
      `${ENGINE}/ci_snapping.rs`,
      `${ENGINE}/ci_grid.rs`,
      `${ENGINE}/ci_objects_snap.rs`,
      "e2e/objectsSnap.spec.ts",
    ],
  },
  // The property itself, not the fill types enumerated below: apply_style with fill_style
  // is only exercised by the bucket-fill path (a_fill_style_that_was_actually_chosen_is_
  // honoured) — ci_style.rs and ci_style_patch.rs never patch it.
  {
    section: "20. Fill and stroke system",
    text: /^Fill style$/,
    status: "covered",
    tests: [`${ENGINE}/ci_bucket_fill.rs`],
  },
  // Never patched in ci_style.rs/ci_style_patch.rs either, but copy/paste-styles
  // round-trips it (the_shape_styles_transfer) and it changes the exported dasharray
  // (scene_to_svg_stroke_style_dashed/_dotted).
  {
    section: "20. Fill and stroke system",
    text: /^Stroke style$/,
    status: "covered",
    tests: [`${ENGINE}/ci_selection_style.rs`, `${ENGINE}/ci_export.rs`],
  },
  {
    section: "20. Fill and stroke system",
    text: /^None$/,
    status: "gap",
    why: "FillStyle has no None/no-pattern variant — only Hachure, CrossHatch, Solid and Zigzag (scene/element.rs); the inspector's FILL_STYLES picker only offers Hachure/Cross/Solid.",
  },
  // The two non-default stroke styles each pin their own SVG dasharray by name; Solid is
  // the default exercised implicitly everywhere else in the suite.
  {
    section: "20. Fill and stroke system",
    text: /^(Dashed|Dotted)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export.rs`],
  },
  {
    section: "20. Fill and stroke system",
    status: "covered",
    tests: [
      `${ENGINE}/ci_style.rs`,
      `${ENGINE}/ci_style_patch.rs`,
      `${ENGINE}/ci_render_drawable.rs`,
      `${WEB}/draw-chrome/inspector.test.ts`,
    ],
  },
  // Seed determinism and stroke-to-stroke variability live in the shape generator's own
  // inline tests, not in this section's named files.
  {
    section: "21. Rough / hand-drawn renderer",
    text: /^Deterministic random seed$|^Stroke variability$/,
    status: "covered",
    tests: ["engine/crates/draw-engine/src/render/shape.rs"],
  },
  // The shape cache is the redraw-consistency and performance story: same fingerprint,
  // same cached Drawable, no regeneration.
  {
    section: "21. Rough / hand-drawn renderer",
    text: /^Consistent redraws$|^Performance optimization$/,
    status: "covered",
    tests: ["engine/crates/draw-engine/src/render/cache.rs", `${ENGINE}/ci_shape_cache.rs`],
  },
  {
    section: "21. Rough / hand-drawn renderer",
    text: /^Roughness levels$/,
    status: "covered",
    tests: ["engine/crates/draw-engine/src/render/opts.rs"],
  },
  {
    section: "21. Rough / hand-drawn renderer",
    status: "covered",
    tests: [`${ENGINE}/ci_render_drawable.rs`, `${ENGINE}/ci_export.rs`],
  },
  {
    section: "22. Canvas navigation",
    text: /Pinch|Touch pan/,
    status: "gap",
    why: "Pinch and touch pan need the gesture work in §23.",
  },
  {
    section: "22. Canvas navigation",
    text: /^Middle mouse$/,
    status: "gap",
    why: "Same gap as shortkey.md's Navigation & canvas rule: pointerInput.ts's button===1 branch has no test, unit or e2e.",
  },
  // Real drag, real camera assertion — just not named by this rule.
  {
    section: "22. Canvas navigation",
    text: /^Space \+ drag$/,
    status: "covered",
    tests: ["e2e/shortcuts.spec.ts"],
  },
  {
    section: "22. Canvas navigation",
    text: /^Hand tool$/,
    status: "covered",
    // pointer_hand_tool_pans_camera sets DrawTool::Hand, drags, and asserts the camera
    // moved by the drag delta.
    tests: [`${ENGINE}/ci_pointer.rs`],
  },
  {
    section: "22. Canvas navigation",
    text: /^Zoom (in|out)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_style.rs`, "e2e/shortcuts.spec.ts"],
  },
  {
    section: "22. Canvas navigation",
    text: /^100%$/,
    status: "covered",
    tests: [`${ENGINE}/ci_style.rs`, "e2e/shortcuts.spec.ts"],
  },
  {
    section: "22. Canvas navigation",
    status: "covered",
    tests: [
      `${ENGINE}/ci_camera.rs`,
      `${ENGINE}/ci_zoom_wheel.rs`,
      `${ENGINE}/ci_navigate.rs`,
      "e2e/zoom.spec.ts",
    ],
  },
  {
    section: "23. Touch / mobile",
    status: "gap",
    why: "Pointer events are used throughout, but nothing distinguishes touch or pen, there is no gesture recognition, and the chrome has no mobile layout.",
  },
  // a_freehand_stroke_is_erased_by_its_ink_not_its_box tests hit-testing precision against
  // a stroke's shape, but the stroke is always taken whole — nothing splits one into the
  // segments a sweep did not cross.
  {
    section: "24. Eraser",
    text: /^Delete partially intersected freehand paths$/,
    status: "gap",
    why: "not implemented — a swept freehand stroke is deleted whole; nothing splits it into the parts the eraser missed.",
  },
  {
    section: "24. Eraser",
    status: "covered",
    tests: [
      `${ENGINE}/ci_eraser.rs`,
      "e2e/eraser.spec.ts",
      `${WEB}/eraser/eraserTrail.test.ts`,
      `${ENGINE}/ci_pointer.rs`,
      `${ENGINE}/ci_history.rs`,
    ],
  },
  {
    section: "25. Laser pointer",
    text: /[Cc]ollaboration/,
    status: "covered",
    tests: [
      `${WEB}/realtime/peerLaser.test.ts`,
      `${WEB}/realtime/realtime.test.ts`,
      "e2e/peers.spec.ts",
    ],
  },
  { section: "25. Laser pointer", status: "covered", tests: [`${ENGINE}/ci_laser.rs`] },
  {
    section: "26. Autoshape / flowchart logic",
    text: /[Ff]lowchart|connection points|Automatic arrow/,
    status: "covered",
    tests: [`${ENGINE}/ci_flowchart.rs`, "e2e/flowchart.spec.ts"],
  },
  {
    section: "26. Autoshape / flowchart logic",
    status: "covered",
    tests: [`${ENGINE}/ci_recognize.rs`],
  },
  {
    section: "27. Keyboard system",
    text: /Tab/,
    status: "gap",
    why: "Tab does nothing on the canvas. The oracle's own Tab opens the shape-conversion popup (App.tsx), not flowchart navigation — that is Alt+Arrow, covered under Flowcharts. This one is still unclaimed.",
  },
  // Shift-click is a pointer gesture, not a keydown, so it is absent from keys.test.ts —
  // the additive/subtractive click the section rule below never actually exercises.
  {
    section: "27. Keyboard system",
    text: /^Shift-click$/,
    status: "covered",
    tests: [`${ENGINE}/ci_multi_select.rs`],
  },
  // copySelection/cutSelection exist (keys.ts's handleModChords) and Ctrl+V is proven
  // deliberately unhandled so the browser's own paste event carries it — but no test
  // dispatches Ctrl+C or Ctrl+X, and nothing drives an actual paste to confirm the round
  // trip through the clipboard. "does not steal Ctrl+V" is non-interference, not a paste.
  {
    section: "27. Keyboard system",
    text: /^Cmd\/Ctrl\+[CXV]$/,
    status: "gap",
    why: "implemented, untested — copySelection/cutSelection are wired to Ctrl+C/Ctrl+X and paste rides the native clipboard event, but no test dispatches Ctrl+C/Ctrl+X or completes a paste to confirm any of the three actually round-trips.",
  },
  {
    section: "27. Keyboard system",
    text: /^Backspace$/,
    status: "gap",
    why: 'Implemented, untested: handlePlainKeys treats Backspace exactly like Delete (`event.key === "Delete" || event.key === "Backspace"`, keys.ts), but keys.test.ts only ever dispatches "Delete".',
  },
  {
    section: "27. Keyboard system",
    status: "covered",
    tests: [`${ENGINE}/ci_shortcuts.rs`, "engine/src/host/keys.test.ts", "e2e/shortcuts.spec.ts"],
  },
  {
    section: "28. Command/action architecture",
    status: "gap",
    why: "The engine exposes methods, not named actions. Nothing addressable by name means no command palette and no single place a shortcut, a menu item and a button agree on — design.md is right that this is the load-bearing one.",
  },
  // A typing session is one step, stamped once, at its commit — styles written while it
  // is typed included; undo waits for it.
  {
    section: "29. Undo / redo",
    text: /Text editing transactions/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_edit.rs`, "e2e/fontSize.spec.ts"],
  },
  {
    section: "29. Undo / redo",
    text: /Branch|Collaboration-aware/,
    status: "gap",
    why: "History is a linear snapshot stack; branching needs the operation model from §41. Undo is partly collaboration-aware: it restores only the elements its own step changed and goes out as a new edit, so it no longer reverts a peer's work elsewhere (ci_version_stamps.rs). It is whole-element, though — undoing your change to an element a peer has since edited restores all of it, where Excalidraw's deltas restore only the properties you changed.",
  },
  // No explicit transaction object exists anywhere in the engine (grep finds none):
  // a commit is stamped once, whole, at the end of a gesture (push_history,
  // CLAUDE.md's "Server: element-level last-write-wins"), not opened, updated and closed
  // through a named API a caller could start, update, commit or cancel piecemeal.
  {
    section: "29. Undo / redo",
    text: /^Transaction (start|update|commit|cancel)$/,
    status: "gap",
    why: "not implemented as an explicit API — a commit is one stamp at the end of a gesture (push_history), not a transaction object with separate start/update/commit/cancel calls.",
  },
  {
    section: "29. Undo / redo",
    status: "covered",
    tests: [
      `${ENGINE}/ci_history.rs`,
      `${ENGINE}/ci_history_selection.rs`,
      `${ENGINE}/ci_version_stamps.rs`,
      "e2e/versionStamps.spec.ts",
      "e2e/console.spec.ts",
    ],
  },
  {
    section: "30. Clipboard",
    text: /Image paste|image\/png/,
    status: "covered",
    tests: ["e2e/image.spec.ts"],
  },
  {
    section: "30. Clipboard",
    text: /External paste|text\/html/,
    status: "gap",
    why: "Internal copy/paste round-trips with id regeneration, and a pasted image file is placed; other rich external formats are not read.",
  },
  // ci_edit.rs (named below) has zero copy/cut/paste tests — it is entirely z-order, align,
  // distribute, flip and grouping. The real coverage is ci_persistence.rs:
  // copy_selection_single_element_serializes, copy_and_paste_remaps_ids (ID regeneration),
  // copy_and_paste_preserves_internal_connector_bindings (binding reconstruction),
  // cut_selection_returns_json_and_deletes. Cross-document paste is exercised by ci_live.rs's
  // a_delta_lists_what_it_adds_in_stacking_order, which pastes JSON exported from an unrelated
  // engine instance.
  {
    section: "30. Clipboard",
    text: /^Copy$|^Cut$|^Paste$|Cross-document paste|ID regeneration|Binding reconstruction/,
    status: "covered",
    tests: [`${ENGINE}/ci_persistence.rs`, `${ENGINE}/ci_live.rs`],
  },
  {
    section: "30. Clipboard",
    text: /^Duplicate$/,
    status: "covered",
    tests: [`${ENGINE}/ci_duplicate.rs`],
  },
  {
    section: "30. Clipboard",
    text: /^Text paste$/,
    status: "gap",
    why: "not implemented — paste_json (engine/crates/draw-engine/src/engine/clipboard.rs) only accepts this app's own osidraw JSON; arbitrary clipboard text fails to parse and falls back to re-pasting the last internal copy (or nothing), never becoming a text element the way Excalidraw's paste does.",
  },
  {
    section: "31. Persistence",
    text: /IndexedDB|crash recovery|localStorage preferences/,
    status: "gap",
    why: "Autosave goes to the API and a localStorage draft is the fallback; there is no IndexedDB store and no crash-recovery prompt.",
  },
  // recoverStripped repairs what a server round-trip drops (a frame's name, what frame an
  // element is in, a picture) — apps/web/src/lib/autosave/recover.test.ts, not one of this
  // rule's own named files.
  {
    section: "31. Persistence",
    text: /^recovery$/,
    status: "covered",
    tests: [`${WEB}/autosave/recover.test.ts`],
  },
  // elements_from_json checks the type tag before anything else (export/json.rs) and
  // refuses everything but "osidraw" — a real Excalidraw file is rejected, not converted.
  {
    section: "31. Persistence",
    text: /^\.excalidraw (import|export)$/,
    status: "gap",
    why: 'not implemented — elements_from_json refuses anything whose type is not "osidraw"; a .excalidraw file does not load, and nothing writes one.',
  },
  // elements_from_json_invalid_type_returns_none, _malformed_json_returns_none and
  // _missing_elements_field_returns_none pin exactly this — in ci_export.rs, not named
  // below.
  {
    section: "31. Persistence",
    text: /^JSON validation$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export.rs`],
  },
  // Old scenes still parse and round-trip: a_legacy_scene_round_trips_byte_identical and
  // a_legacy_text_resolves_exactly_as_before (ci_text_model_compat.rs), "an old scene must
  // still parse" (ci_text_align.rs) — none of this rule's own named files.
  {
    section: "31. Persistence",
    text: /^(Version|Legacy) migration$/,
    status: "covered",
    tests: [`${ENGINE}/ci_text_model_compat.rs`, `${ENGINE}/ci_text_align.rs`],
  },
  {
    section: "31. Persistence",
    status: "covered",
    tests: [
      `${ENGINE}/ci_persistence.rs`,
      `${WEB}/autosave/autosaver.test.ts`,
      `${WEB}/autosave/sceneDiff.test.ts`,
    ],
  },
  // Both are Canvas→PNG-only options, and Canvas→PNG is canvas.toBlob() on the on-screen
  // canvas as-is (engine.ts's exportPng) — no transparent-background toggle and no
  // chosen-background-color option, unlike the SVG path's explicit background parameter.
  // Slips past the PNG carve-out above since neither line contains the word "PNG".
  {
    section: "32. Export",
    text: /^(Transparent background|Background color)$/,
    status: "gap",
    why: "Canvas→PNG (engine.ts exportPng, canvas.toBlob()) has no transparent-background toggle and no background-color option, unlike the SVG export path.",
  },
  {
    section: "32. Export",
    text: /^Selection export$/,
    status: "gap",
    why: "The export dialog and both engine.exportSvg/exportPng always export the whole scene; nothing threads the current selection through to either path.",
  },
  // scene_to_svg's <image> arm is exercised directly: a real embedded data URL, a flipped
  // image, and the no-picture-yet fallback.
  {
    section: "32. Export",
    text: /^Images$/,
    status: "covered",
    tests: [`${ENGINE}/ci_image.rs`],
  },
  {
    section: "32. Export",
    text: /^Embedded scene data if desired$/,
    status: "gap",
    why: "Neither exportSvg nor exportPng embeds the .osidraw JSON into the file for round-trip re-import; OsidrawFile (export/json.rs) has no such provision.",
  },
  {
    section: "32. Export",
    text: /^(Files|Exportable app state)$/,
    status: "gap",
    why: "The exported .osidraw JSON (OsidrawFile in export/json.rs) carries only type, version and elements — no files map and no appState, so neither round-trips.",
  },
  {
    section: "32. Export",
    text: /PNG|Clipboard image|Selection → image|Whole canvas → image|Scale|[Ff]rame export|Frame export|Fonts/,
    status: "gap",
    why: "No raster export path at all — see the Export tricks rule.",
  },
  { section: "32. Export", status: "covered", tests: [`${ENGINE}/ci_export.rs`] },
  {
    section: "33. Libraries",
    status: "gap",
    why: "No library — see the Library rule.",
  },
  {
    section: "34. Menus",
    text: /Link|Add to library|Properties/,
    status: "gap",
    why: "The menu entries that depend on features not built yet (links, library, a stats panel).",
  },
  {
    section: "34. Menus",
    text: /Command palette|Search commands|Keyboard navigation|Execute actions|Shortcut display/,
    status: "covered",
    // Track B, Part 1: DrawCommandPalette.svelte + commandPalette.ts — fuzzy search
    // ("Search commands"), arrow-key navigation, Enter to run ("Execute actions"), and a
    // shortcut printed beside each command ("Shortcut display").
    tests: [`${WEB}/draw-chrome/commandPalette.test.ts`, "e2e/keyboardDiagram.spec.ts"],
  },
  // Each action is implemented and tested at the engine/store level (grouping, z-order,
  // lock, duplicate, delete, copy/paste) but no test clicks the context-menu entry
  // itself and checks the effect — menu.test.ts covers what the menu *offers*, not what
  // clicking an item *does*.
  {
    section: "34. Menus",
    text: /^Cut$|^Copy$|^Duplicate$|^Delete$|^Group$|^Ungroup$|^Lock$|^Unlock$|^Bring forward$|^Send backward$/,
    status: "gap",
    why: "Implemented and tested as engine actions elsewhere; no test drives them through this context menu specifically.",
  },
  // A single hamburger dropdown (DrawMainMenu.svelte), not a File/Edit/View/Help menu
  // bar — the checklist's generic template, not this project's or the oracle's shape.
  {
    section: "34. Menus",
    text: /^File$|^Edit$|^View$|^Help$|^Preferences$/,
    status: "out-of-scope",
    why: "This project's main menu is one hamburger dropdown (DrawMainMenu.svelte), not a File/Edit/View/Help/Preferences menu bar — Excalidraw itself has no such bar either.",
  },
  {
    section: "34. Menus",
    text: /^Export$/,
    status: "gap",
    why: '"Export image…" is in the dropdown (DrawMainMenu.svelte) but no test opens it from the main menu specifically; the export flow itself is covered under section 32.',
  },
  {
    section: "35. Properties panel",
    text: /Numeric inputs/,
    status: "gap",
    why: "No number fields: position, size and rotation are edited on the canvas only, and the panel has no rows for them. See docs/reference/console.md › Gaps.",
  },
  {
    section: "35. Properties panel",
    text: /Font picker/,
    status: "covered",
    tests: [
      `${WEB}/draw-chrome/fonts.test.ts`,
      `${ENGINE}/ci_next_style.rs`,
      "e2e/fontPicker.spec.ts",
    ],
  },
  {
    section: "35. Properties panel",
    text: /Mixed values/,
    status: "covered",
    tests: [`${ENGINE}/ci_selection_style.rs`, "e2e/console.spec.ts"],
  },
  {
    section: "35. Properties panel",
    text: /Color picker/,
    status: "covered",
    tests: [`${WEB}/draw-chrome/colors.test.ts`, "e2e/console.spec.ts"],
  },
  {
    section: "35. Properties panel",
    text: /Live update|Undo integration/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_selection_style.rs`,
      `${ENGINE}/ci_style_reach.rs`,
      "e2e/console.spec.ts",
    ],
  },
  {
    section: "35. Properties panel",
    status: "covered",
    tests: [
      `${WEB}/draw-chrome/shapeActions.test.ts`,
      `${WEB}/draw-chrome/inspector.test.ts`,
      `${ENGINE}/ci_selection_style.rs`,
      `${ENGINE}/ci_style_patch.rs`,
      "e2e/console.spec.ts",
    ],
  },
  {
    section: "36. Links",
    status: "gap",
    why: "No link on an element — see the Element linking rule.",
  },
  { section: "37. Search", status: "gap", why: "No scene search — see the Search rule." },
  {
    section: "38. Grid",
    text: /Export exclusion|Grid step|Zoom-dependent/,
    status: "gap",
    why: "Grid step is modelled but not exposed, rendering does not thin with zoom, and export does not explicitly exclude the grid.",
  },
  // ci_grid.rs pins the snapping math (step size, intersections, on/off) but never the
  // paint output — set_stroke(ctx, &view.theme.grid) in wasm/paint.rs has no test.
  {
    section: "38. Grid",
    text: /^Grid rendering$/,
    status: "gap",
    why: "implemented, untested — the grid is painted from view.theme.grid, but nothing checks what gets drawn.",
  },
  // themeFromCss's "reads the host tokens" test checks the grid colour it derives from
  // the page's --line token — apps/web/src/lib/draw-chrome/theme.test.ts, not named below.
  {
    section: "38. Grid",
    text: /^Dark mode$/,
    status: "covered",
    tests: [`${WEB}/draw-chrome/theme.test.ts`],
  },
  { section: "38. Grid", status: "covered", tests: [`${ENGINE}/ci_grid.rs`] },
  {
    section: "39. Dark mode / themes",
    text: /Export theme|Collaboration colors/,
    status: "gap",
    why: "Export always uses the light palette, and collaborator colours are assigned but not themed.",
  },
  {
    section: "39. Dark mode / themes",
    status: "covered",
    tests: [`${WEB}/draw-chrome/theme.test.ts`, `${ENGINE}/ci_export.rs`],
  },
  // The colored outline around what a peer holds is exactly "remote selections" in the
  // Multiplayer UI list — e2e/peers.spec.ts's "what one person holds, the other sees in
  // their colour and cannot take" drives it end to end. Carved out before the blanket gap
  // below, which used to claim this untested.
  {
    section: "40. Collaboration",
    text: /^Remote selections$/,
    status: "covered",
    tests: ["e2e/peers.spec.ts"],
  },
  {
    section: "40. Collaboration",
    text: /Follow user|Active tool/,
    status: "gap",
    why: "Presence beyond cursors. Element sync, last-write-wins, reconnection with catch-up, the offline queue and the connection state are done.",
  },
  // The share modal renders one (DrawShareModal.svelte) but no unit test or e2e spec
  // asserts it — the section rule below never names a file that mentions "avatar" at all.
  {
    section: "40. Collaboration",
    text: /^Collaborator avatars$/,
    status: "gap",
    why: "implemented, untested — rendered by DrawShareModal.svelte; no test asserts it.",
  },
  // The peers-list DrawShareModal renders (avatars, "N online") is the same untested
  // surface as Collaborator avatars just above — nothing asserts it renders or updates.
  {
    section: "40. Collaboration",
    text: /^User list$/,
    status: "gap",
    why: "implemented, untested — DrawShareModal.svelte renders a peers-list with a live count; no test asserts it.",
  },
  // Presence's other half — what a peer has selected, not just where their cursor is —
  // lives in peerClaims.ts and is asserted there, a file the section rule never names.
  {
    section: "40. Collaboration",
    text: /^Selection$/,
    status: "covered",
    tests: [`${WEB}/realtime/peerClaims.test.ts`],
  },
  // The merge rule itself — reconcile.ts, the single source of truth CLAUDE.md points to —
  // is unit-tested in the contract package, not in any file the section rule names.
  {
    section: "40. Collaboration",
    text: /^(Conflict resolution|Ordering|Versioning)$/,
    status: "covered",
    tests: ["packages/contract/tests/reconcile.test.ts"],
  },
  {
    section: "40. Collaboration",
    status: "covered",
    tests: [
      `${WEB}/realtime/realtime.test.ts`,
      `${WEB}/realtime/liveBroadcast.test.ts`,
      `${WEB}/draw-chrome/status.test.ts`,
      `${WEB}/draw-chrome/share.test.ts`,
      "e2e/live.spec.ts",
      "e2e/share.spec.ts",
      `${ENGINE}/ci_remote_patch.rs`,
    ],
  },
  {
    section: "42. Rendering engine",
    text: /Draw cursors|Draw snap guides|Clip frames|Optimize redraws|Draw bindings/,
    status: "gap",
    why: "Snap guides, binding highlights and frame clipping are computed but not drawn, and there is no dirty-rect or tile cache yet.",
  },
  {
    section: "42. Rendering engine",
    text: /^Draw hover$/,
    status: "gap",
    why: "No test paints a hover highlight — only a connector endpoint's binding-highlight-while-hovering is verified (paint.rs), which is the gap above's 'Draw bindings', not a general hover outline.",
  },
  // `paint_view().marquee` is the actual render-facing state a selection drag produces.
  {
    section: "42. Rendering engine",
    text: /^Draw selection$/,
    status: "covered",
    tests: [`${ENGINE}/ci_repaint.rs`],
  },
  {
    section: "42. Rendering engine",
    text: /^Draw laser$/,
    status: "covered",
    tests: [`${ENGINE}/ci_laser.rs`],
  },
  {
    section: "42. Rendering engine",
    status: "covered",
    tests: [`${ENGINE}/ci_render_drawable.rs`, `${ENGINE}/ci_export.rs`, `${ENGINE}/ci_grid.rs`],
  },
  // Rectangle/Ellipse/Diamond outline hit testing has its own suite, not in this
  // section's named files.
  {
    section: "43. Hit-testing engine",
    text: /^Rectangle$|^Ellipse$|^Diamond$/,
    status: "covered",
    tests: [`${ENGINE}/ci_geometry.rs`],
  },
  // `clicking_a_member_selects_the_whole_outermost_group` drives the click through the
  // real hit test to reach a group's member.
  {
    section: "43. Hit-testing engine",
    text: /^Groups$/,
    status: "covered",
    tests: [`${ENGINE}/ci_groups_nested.rs`],
  },
  // `has_solid_interior` (geometry.rs) puts Sticky and Embed on the same catch-all "solid
  // unless Frame or an unfilled Rectangle/Diamond/Ellipse" branch as Text/Freedraw/Image,
  // which `content_elements_are_never_hollow` (ci_hit_fill.rs, named below) exercises —
  // but no test constructs a StickyNote or Embeddable element and hit-tests it directly.
  {
    section: "43. Hit-testing engine",
    text: /^Sticky$|^Embeds$/,
    status: "gap",
    why: "Implemented (same has_solid_interior branch as Image/Text/Freedraw), untested: no test hit-tests a StickyNote or Embeddable element specifically.",
  },
  {
    section: "43. Hit-testing engine",
    status: "covered",
    tests: [
      `${ENGINE}/ci_hit_fill.rs`,
      `${ENGINE}/ci_hit_rotated.rs`,
      `${ENGINE}/ci_selection.rs`,
      `${ENGINE}/ci_frame.rs`,
    ],
  },
  {
    section: "44. Geometry engine",
    text: /^Vector$/,
    status: "gap",
    why: "No vector primitive or vector algebra module — offsets are plain x/y deltas on Point pairs.",
  },
  {
    section: "44. Geometry engine",
    text: /^Matrix$/,
    status: "gap",
    why: "No composable transform matrix — rotation and translation are direct x/y/angle field updates, not matrix multiplication.",
  },
  {
    section: "44. Geometry engine",
    text: /^Circle$/,
    status: "gap",
    why: "No distinct Circle primitive — a circle is an Ellipse element with equal width and height (ci_recognize.rs::a_circle_is_an_ellipse_too is about shape recognition, not a Circle geometry type).",
  },
  {
    section: "44. Geometry engine",
    text: /^Convex polygon tests$/,
    status: "gap",
    why: "is_valid_polygon and can_become_polygon (geometry.rs) check point count and closedness, not convexity — no convexity or convex-hull test exists.",
  },
  {
    section: "44. Geometry engine",
    text: /^Projection$|^Closest point$/,
    status: "gap",
    why: "project_param (bucket_fill.rs) and the binding anchor's projection helpers are implemented but exercised only indirectly through bucket-fill and binding behaviour — no test asserts a projected or closest-point value directly.",
  },
  // `polygon_includes_point` reached through a live hit test, and the toggle's own
  // validity/closedness rules — not in this section's named files.
  {
    section: "44. Geometry engine",
    text: /^Polygon$/,
    status: "covered",
    tests: [`${ENGINE}/ci_polygon.rs`],
  },
  // `distance_to_segment` and `segments_intersect`/`segment_intersection_point`, reached
  // through bucket fill's boundary walk and dense-binding's outline distance.
  {
    section: "44. Geometry engine",
    text: /^Segment$|^Intersection$|^Distance$/,
    status: "covered",
    tests: [`${ENGINE}/ci_bucket_fill.rs`, `${ENGINE}/ci_binding_dense.rs`],
  },
  // `rotate_point` (selection/handles.rs), reached through the handle and resize suites —
  // not in this section's named files.
  {
    section: "44. Geometry engine",
    text: /^Rotation$/,
    status: "covered",
    tests: [`${ENGINE}/ci_handles.rs`, `${ENGINE}/ci_selection.rs`],
  },
  {
    section: "44. Geometry engine",
    status: "covered",
    tests: [`${ENGINE}/ci_geometry.rs`, `${ENGINE}/ci_math.rs`, `${ENGINE}/ci_camera.rs`],
  },
  {
    section: "48. Accessibility",
    text: /High contrast|Reduced motion|Screen-reader|focus trap|Focus management/,
    status: "gap",
    why: "Toolbar and menu roles and labels are in place and asserted by the browser specs; the rest is unaudited.",
  },
  // DrawMainMenu.svelte's onKeyDown answers ArrowDown/ArrowUp by stepping the highlighted
  // item, and DrawContextMenu.svelte has its own handler — but no test presses either key
  // with a menu open.
  {
    section: "48. Accessibility",
    text: /^Menu keyboard navigation$/,
    status: "gap",
    why: "implemented, untested — both menus answer ArrowDown/ArrowUp, but no test opens one and presses an arrow key.",
  },
  // Every menu item shows its own chord inline (dropdown-menu-item__shortcut) and `?`
  // opens the shortcuts help — but nothing asserts the hint text or opens that dialog.
  {
    section: "48. Accessibility",
    text: /^Shortcut discoverability$/,
    status: "gap",
    why: "implemented, untested — menu items render their shortcut inline and `?` opens the help dialog, but no test checks either.",
  },
  {
    section: "48. Accessibility",
    status: "covered",
    tests: ["e2e/shortcuts.spec.ts", `${WEB}/draw-chrome/menu.test.ts`],
  },
  {
    section: "49. Performance",
    status: "gap",
    why: "Still a gap, deliberately, even though the editing loop and the render path are now benchmarked (benches/editing.rs, benches/render.rs): a criterion bench measures and reports, it does not fail. Nothing here is *guarded* until a regression breaks a build, which needs thresholds in CI. Missing outright: a spatial index, dirty rectangles, and offscreen and image caches.",
  },
  {
    section: "51. Testing matrix",
    text: /Export|Copy|Paste/,
    status: "covered",
    tests: [`${ENGINE}/ci_export.rs`, `${ENGINE}/ci_edit.rs`],
  },
  {
    section: "51. Testing matrix",
    text: /modifier|Shift|Alt|Cmd|None/,
    status: "gap",
    why: "No systematic modifier sweep. Individual modifiers are tested where they matter; the cross-product is not.",
  },
  // "All three" is the last row of the modifier sweep above (Shift + Alt + Cmd/Ctrl held at
  // once) but names none of its siblings' words, so it fell through the modifier-gap rule and
  // into the section catch-all instead of sharing its verdict.
  {
    section: "51. Testing matrix",
    text: /^All three$/,
    status: "gap",
    why: "No systematic modifier sweep. Individual modifiers are tested where they matter; the cross-product is not.",
  },
  // Moving and duplicating a selection are real, tested behaviours — just not in any of the
  // three files the section rule names.
  {
    section: "51. Testing matrix",
    text: /^Move$/,
    status: "covered",
    tests: [`${ENGINE}/ci_grab_selected.rs`],
  },
  {
    section: "51. Testing matrix",
    text: /^Duplicate$/,
    status: "covered",
    tests: [`${ENGINE}/ci_duplicate.rs`],
  },
  {
    section: "51. Testing matrix",
    status: "covered",
    tests: [`${ENGINE}/ci_pointer.rs`, `${ENGINE}/ci_selection.rs`, `${ENGINE}/ci_history.rs`],
  },
  {
    section: "53. Recommended implementation order",
    status: "out-of-scope",
    why: "A phasing plan for the sections above, not features of its own. Each line is classified where the feature is named.",
  },
];

/** The first rule that matches, or `undefined` when the item is unaccounted for. */
export function ruleFor(item: ChecklistItem): Rule | undefined {
  return RULES.find((rule) => {
    const sectionMatches =
      typeof rule.section === "string"
        ? rule.section === item.section
        : rule.section.test(item.section);
    if (!sectionMatches) return false;
    return rule.text ? rule.text.test(item.text) : true;
  });
}
