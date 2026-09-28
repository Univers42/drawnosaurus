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
    status: "covered",
    tests: [`${ENGINE}/ci_zoom_fit.rs`, "e2e/shortcuts.spec.ts"],
  },
  {
    section: "🧭 Navigation & canvas",
    text: /Middle mouse \+ drag/,
    status: "covered",
    tests: ["e2e/shortcuts.spec.ts"],
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
    text: /^`Ctrl\/Cmd` while snapping — Temporarily disable snapping$/,
    status: "gap",
    why: "6.4 closed the GRID half for every gesture — press, move, resize, the clicked sticky note, and the hover, which is not snapped at all rather than gated (ci_ctrl_grid.rs). What is NOT established is whether the oracle releases the ANGLE lock under Ctrl as well: `getLockedLinearCursorAlignSize` (sizeHelpers.ts:196-199) takes no modifier in the part of it that computes the step, and 5.2 established that a line snaps to exactly two things, the grid and the angle lock. One of two is proven, so the box stays shut rather than being flipped on half an answer.",
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
  // The arrow tool's key again: sharp → curved → elbow (App.tsx@1118751f:5706-5714).
  {
    section: "Lines & arrows",
    text: /Cycle\/change arrow type/,
    status: "covered",
    tests: [`${ENGINE}/ci_elbow.rs`, "e2e/elbowArrow.spec.ts"],
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
  // Ctrl/Cmd+Shift+L runs the context menu's lock toggle with something selected, as
  // the oracle's keyTest does (actionElementLock.ts@1118751f:151-160).
  {
    section: /^(🖱️ Selection|🔒 Locking)$/,
    text: /Shift \+ L`/,
    status: "covered",
    tests: ["engine/src/host/keys.test.ts", `${ENGINE}/ci_lock.rs`, "e2e/lock.spec.ts"],
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
    tests: [
      `${ENGINE}/ci_flowchart.rs`,
      `${ENGINE}/ci_flowchart_oracle.rs`,
      "engine/src/host/keys.test.ts",
      "e2e/flowchart.spec.ts",
    ],
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
  // Ctrl+V rides the browser's own paste event — e2e/clipboard.spec.ts now dispatches all
  // three for real and checks the round trip (and that Ctrl+V lands on the pointer, not a
  // fixed offset — the bug this file exists for). Same fix closes "27. Keyboard system"'s.
  {
    section: "🖱️ Selection",
    text: /^`Ctrl\/Cmd \+ [CXV]` —/,
    status: "covered",
    tests: ["e2e/clipboard.spec.ts"],
  },
  {
    section: "🖱️ Selection",
    status: "covered",
    tests: [
      `${ENGINE}/ci_selection.rs`,
      `${ENGINE}/ci_edit.rs`,
      `${ENGINE}/ci_history.rs`,
      // `shortkey.md:77` "Delete selected point" was claimed covered by this blanket rule with
      // no test that exercised it -- the rule names files, and none of these deleted a point of
      // a line. `ci_point_delete.rs` is the one that does. See the `^Remove point$` rule for
      // what the oracle's three branches are.
      `${ENGINE}/ci_point_delete.rs`,
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
    tests: [`${WEB}/mermaid/mermaid.test.ts`, "e2e/mermaid.spec.ts"],
  },
  // The paste itself is ported (`paste_text.rs`, `keyboardInput.ts`): one element per line,
  // each wrapped to max(min(visible width / 2, 800), 200) and centred on the pointer. What
  // the line asks for beyond that — pasting rich content from Google Docs, and
  // "paste as single element" — is design.md:1279 and shortkey.md:421,423, which are
  // Phase 4.8's, so the line stays a gap rather than being half-claimed.
  {
    section: "🔤 Text",
    text: /wrap text where appropriate/,
    status: "gap",
    why: "Plain text pasted now becomes text elements, one per line and wrapped to max(min(visible width / 2, 800), 200) as Excalidraw does (ci_paste_text.rs, paste_text.rs, App.tsx@1118751f:4979-5096). The rest of the line is the rich part this checklist asks for elsewhere and does not have: pasting from Google Docs, and 'paste as single element' (design.md:1279, shortkey.md:421,423) — Phase 4.8. Ctrl+V of a paragraph is split into one element per line, which is the oracle's behaviour, not the one a reader of the clipboard meant.",
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
  // a locked element is not pressed on, moved, lassoed, erased or taken by Select All —
  // only carried by its group or frame. A right-click takes it with its group, so the
  // menu can unlock it, and the board menu's Unlock all frees them all.
  {
    section: "🗂️ Layers / ordering",
    text: /Lock element|Unlock element/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_lock.rs`,
      "e2e/lock.spec.ts",
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
    why: "No deep selection reaches a locked element: a click, a marquee, a lasso and Select All pass it by, as Excalidraw's do (actionSelectAll.ts@1118751f:32-38). Only a right-click selects one, with its group, so the context menu can unlock it (ci_lock.rs, e2e/lock.spec.ts); Excalidraw's click-to-unlock popup is not built.",
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
    tests: [
      `${ENGINE}/ci_next_style.rs`,
      `${ENGINE}/ci_style.rs`,
      `${WEB}/draw-chrome/menu.test.ts`,
      "e2e/arrowType.spec.ts",
    ],
  },
  // Routed square between the shapes they bind (elbowArrow.ts@1118751f), held to the
  // oracle's own router on a recorded sweep (engine/tools/elbow-oracle).
  {
    section: "➡️ Advanced arrows",
    text: /[Ee]lbow/,
    status: "covered",
    tests: [`${ENGINE}/ci_elbow.rs`, `${ENGINE}/ci_elbow_oracle.rs`, "e2e/elbowArrow.spec.ts"],
  },
  // The six cardinality/crow's-foot markers ER diagrams use, plus the plain heads
  // (circle, circle_outline, triangle_outline, diamond_outline, bar) the oracle's picker
  // hides by default beside them — geometry and painting transcribed from
  // getArrowheadPoints/getArrowheadShapes (bounds.ts, shape.ts), replayed against the
  // oracle's own output by ci_arrowhead_oracle.rs.
  {
    section: "➡️ Advanced arrows",
    text: /cardinality/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_arrowhead_oracle.rs`,
      // The line was already covered by ci_arrowhead_oracle.rs, which holds every head's
      // numbers to 1e-9. That is a *picture* comparison: it says the rendering matches a
      // fixture and says nothing about the relationships between the ten values.
      // `ci_cardinality_props.rs` is the half that is not a picture -- distinctness across
      // the set, equivariance under translating and under turning the line about its own
      // endpoint, and the legacy fold.
      //
      // The fold is `dot` -> `circle`, `crowfoot_one` -> `cardinality_one`,
      // `crowfoot_many` -> `cardinality_many`, `crowfoot_one_or_many` ->
      // `cardinality_one_or_many`, pinned through `load_scene` and `export_json`. Two tests
      // rather than one, because a fix handling only the `crowfoot_*` spellings passes one
      // and silently loses `dot`.
      `${ENGINE}/ci_cardinality_props.rs`,
      `${WEB}/draw-chrome/menu.test.ts`,
      "e2e/arrowheads.spec.ts",
    ],
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
    // (`flowchart.rs` › `flowchart_create`/`flowchart_commit`, `keys.ts`). Every node,
    // arrow binding and camera move is replayed against the oracle's own output
    // (`ci_flowchart_oracle.rs`, `engine/tools/flowchart-oracle`).
    section: "🔄 Flowcharts",
    text: /create connected nodes/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_flowchart.rs`,
      `${ENGINE}/ci_flowchart_oracle.rs`,
      "engine/src/host/keys.test.ts",
      "e2e/flowchart.spec.ts",
    ],
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
    tests: [
      `${ENGINE}/ci_flowchart.rs`,
      `${ENGINE}/ci_flowchart_oracle.rs`,
      "engine/src/host/keys.test.ts",
      "e2e/flowchart.spec.ts",
    ],
  },
  {
    // The commit's own arrow, bound at both ends (`binding_arrow`) — not the general
    // binding system, which "18. Binding system" already covers.
    section: "🔄 Flowcharts",
    text: /Connect nodes with bound arrows/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_flowchart.rs`,
      `${ENGINE}/ci_flowchart_oracle.rs`,
      "e2e/flowchart.spec.ts",
    ],
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
    status: "covered",
    tests: [
      `${ENGINE}/ci_elbow.rs`,
      `${ENGINE}/ci_elbow_oracle.rs`,
      `${ENGINE}/ci_flowchart_oracle.rs`,
      "e2e/elbowArrow.spec.ts",
      "e2e/flowchart.spec.ts",
    ],
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
  {
    section: "✋ Hand / panning",
    text: /^Middle mouse drag/,
    status: "covered",
    tests: ["e2e/shortcuts.spec.ts"],
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
    // NOT earned as `covered` even though the modal arm is now tested, because the line
    // names two arms and the second is a measured divergence rather than a hole.
    //
    // ARM 1 — through the modal: covered by e2e/embedModal.spec.ts. Six cases, each made
    // red once by mutating the product: accepted (one element, type 'embed', the *resolved*
    // player URL, 560x315, roughness 0, transparent, arrives selected and centred), placement
    // determinism (two spellings of one link land on the same pixel; a 0.5x zoom keeps the
    // board size and centres the frame), refusal (host off the allow-list, `javascript:`, and
    // a junk host: aria-invalid, the allow-list named, the Embed button disabled, Enter
    // guarded, and 0 elements / 0 frames / 0 iframes), a control test that retypes in the same
    // dialog so the refusals cannot pass by being refused forever, the blank case ("" , "   ",
    // "\t", " \t ") which must place nothing and must NOT claim refusal, and Cancel.
    //
    // ARM 2 — onto the canvas: a real divergence, measured. With the board focused, a real
    // Ctrl+V of a supported embed URL leaves ["text"] — onChromePaste (DrawSurface.svelte:
    // 781-803) handles files, Mermaid and legacy sticky JSON only, so the URL falls through to
    // the plain-text paste. The oracle frames an embed from a pasted link it will not render
    // as text (App.tsx@1118751f:4711-4757, addTextFromPaste at :4757). So this is not "untested"
    // any more — it is *tested and wrong*, and the honest status for a line with one working arm
    // and one divergent arm is a gap with a reason, not a closure.
    //
    // Also open under the same feature, found while writing arm 1: the embed dialog cannot be
    // dismissed with Escape. DrawModals.svelte:73-87 is the single Escape handler and does not
    // list the embed dialog, which is rendered outside it (DrawSurface.svelte:2246-2268); the
    // oracle closes every modal on Escape (Modal.tsx@1118751f:39-47), and our own
    // docs/reference/shortcuts.md:261-264 claims one handler covers all eleven role="dialog"
    // sites. Filed as a Phase 1 task; the e2e never presses Escape.
    why: "one arm tested, one arm divergent — e2e/embedModal.spec.ts now covers pasting through the modal (accept, refuse, blank, cancel, deterministic placement), but pasting a supported URL onto the canvas leaves a text element where the oracle frames an embed (App.tsx@1118751f:4711-4757), so the line is not closed. Separate defect: the embed dialog has no Escape handler.",
  },
  {
    section: "🧱 Web embeds",
    status: "covered",
    // e2e/embed.spec.ts is also where the dialog itself is exercised: on the palette path
    // the field takes no focus on the base and does after `onMount` focuses it. What sits
    // behind it, the engine's placement, is asserted by that same file's tests, the ones
    // that insert through the engine. `prompt/*.md` names no line for a dialog's focus, so
    // nothing is claimed here beyond that.
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
    status: "covered",
    tests: [`${WEB}/draw-chrome/commandPalette.test.ts`, "e2e/mermaid.spec.ts"],
  },
  {
    section: "🧜 Mermaid",
    text: /^Preview the generated diagram$/,
    status: "covered",
    tests: ["e2e/mermaid.spec.ts"],
  },
  {
    section: "🧜 Mermaid",
    text: /^Supported diagram types include/,
    status: "covered",
    tests: ["e2e/mermaidFuzz.spec.ts", `${WEB}/mermaid/mermaid.test.ts`],
  },
  {
    section: "🧜 Mermaid",
    text: /Paste Mermaid directly/,
    status: "covered",
    tests: ["e2e/mermaid.spec.ts", `${WEB}/mermaid/mermaid.test.ts`],
  },
  {
    section: "🧜 Mermaid",
    status: "covered",
    tests: [
      `${WEB}/mermaid/mermaid.test.ts`,
      `${ENGINE}/ci_insert_json.rs`,
      "e2e/mermaid.spec.ts",
      "e2e/mermaidFuzz.spec.ts",
    ],
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
    status: "covered",
    // prompt/shortkey.md:361. The oracle's palette remembers the *one* command it last
    // ran — `lastUsedPaletteItem` holds a single item, not a list
    // (`CommandPalette.tsx@1118751f:85`) — and lifts it into a "Recents" group above
    // the list, out of the category it was declared in (`:844-857`). It does not boost
    // anything and keeps no history, and ours matches: `paletteGroups` takes one id, so
    // a list cannot be handed to it, and no other row moves.
    // Deliberately *not* claimed: the query does not rank recent commands. The oracle
    // hides the recents group the moment there is a query (`:844-845`) and so do we.
    // The e2e is what pins the round trip: the memory lives above the dialog, so it
    // surviving close/reopen — and holding one row rather than a list — is only
    // reachable in a browser.
    tests: [`${WEB}/draw-chrome/commandPalette.test.ts`, "e2e/paletteRecents.spec.ts"],
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
    text: /custom grid spacing/,
    status: "gap",
    why: "A fixed set of sizes in the menu, not a custom value. 6.6, and it owns the second half of the line this rule used to carry. The Ctrl half is real and is the rule below.",
  },
  // Split off from a rule that paired `custom grid spacing` with `disable snapping`, and so could
  // be neither closed nor honestly described: one of the two is 6.6 and still a gap. **A rule that
  // covers two tasks is a rule that can never be flipped**, because the tasks land at different
  // times. The same failure as 4.3's broad pattern, one level up.
  //
  // shortkey.md:374 "Hold Ctrl/Cmd while dragging - Temporarily disable snapping" has BOTH halves
  // now. The object half was already true and 5.2's own note says so (ci_objects_snap.rs,
  // e2e/objectsSnap.spec.ts). The grid half is 6.4.
  //
  // And 6.4's finding is the part worth keeping: the oracle's hover is NOT Ctrl-gated, it is
  // simply not grid-snapped. `App.tsx:7941-7979` reads the raw pointer -- `scenePointer` is a pure
  // camera transform (`viewportCoordsToSceneCoords`, utils.ts:317-337), never re-assigned in that
  // function, handed to `getHoveredElementForBinding` at `:7947-7954`, with no `getGridPoint`
  // between and none in the callee (`getBindingCandidates`, collision.ts:432, reads no grid). Ours
  // asked what was under the NEAREST INTERSECTION. Measured, not chosen: with a 10-grid, a shape
  // whose right edge is at 405 and a pointer at (415, 345) lit nothing at all, because the grid's
  // 420 is 15 out. Adding `snap_gesture` there -- which is what the brief asked for -- would have
  // left every Ctrl-RELEASED hover reading the wrong point and the site looking fixed.
  //
  // The gate belongs to the SITE, not to the pointer-up: `App.tsx:13579` is in `maybeHandleResize`
  // (`:13546`), reached from `onPointerMoveFromPointerDownHandler` under `resize.isResizing`
  // (`:10725`, call at `:10731`) and from `onKeyDown`/`onKeyUpFromPointerDownHandler` (`:10593`,
  // `:10606`).
  //
  // Duplicate keeps snapping under Ctrl because `App.duplicate.ts:95-99` passes the grid bare, and
  // the branch proved that rather than asserting it.
  //
  // This rule has to sit ABOVE the section's catch-all, which is `covered` and would otherwise
  // claim the line by accident. That is the whole of the 665/1112 lesson applied once more, in the
  // same file, the same night.
  {
    section: "🔲 Grid",
    text: /^Hold .Ctrl\/Cmd. while dragging/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_ctrl_grid.rs`,
      `${ENGINE}/ci_end_snap.rs`,
      `${ENGINE}/ci_objects_snap.rs`,
      "e2e/objectsSnap.spec.ts",
    ],
  },
  {
    section: "🔲 Grid",
    status: "covered",
    tests: [`${ENGINE}/ci_grid.rs`, "e2e/shortcuts.spec.ts"],
  },
  {
    section: "🌙 Interface modes",
    text: /Zen mode|zen/i,
    status: "covered",
    tests: [`${WEB}/draw-chrome/zen.test.ts`, "e2e/zen.spec.ts"],
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
    // Was /PNG|SVG|Google Docs|single element/, and it matched ELEVEN lines across two
    // features and three tasks: Google's rich paste and paste-as-single-element (4.8, still
    // gaps), the four copy-as-image lines (4.3, now covered below) and four export lines the
    // 32. Export rules already own. A gap pattern broad enough to catch its neighbours' lines
    // is a claim about work nobody did, and it sat ABOVE those rules, so it shadowed them.
    // Narrowed to what it is actually about.
  },
  {
    section: "📋 Clipboard tricks",
    text: /Google Docs|single element/,
    status: "gap",
    why: "Rich external paste: pasting from Google Docs, and paste-as-single-element (design.md:1279, shortkey.md:421,423). Ctrl+V of a paragraph becomes text elements, one per line, which is the oracle behaviour - see the ^Paste text directly$ rule. 4.8.",
  },
  // e2e/clipboard.spec.ts dispatches real Ctrl+C and Ctrl+X and checks both against the
  // actual OS clipboard (Ctrl+X deletes but a following Ctrl+V proves the cut landed there).
  {
    section: "📋 Clipboard tricks",
    text: /Ctrl\/Cmd \+ C`.*Copy|Ctrl\/Cmd \+ X`.*Cut/,
    status: "covered",
    tests: ["e2e/clipboard.spec.ts"],
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
    status: "covered",
    tests: [`${ENGINE}/ci_paste_text.rs`, "e2e/clipboard.spec.ts"],
  },
  {
    section: "📋 Clipboard tricks",
    text: /Paste Mermaid syntax to trigger Mermaid handling/,
    status: "covered",
    tests: ["e2e/mermaid.spec.ts"],
  },
  // shortkey.md:424/425 -- the same feature in the checklist's own words rather than the
  // rules' "Copy ... to clipboard". One claim, closed together, because one spec covers it.
  {
    section: "📋 Clipboard tricks",
    text: /^Copy selected content as (PNG|SVG)$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_clipboard.rs`,
      `${ENGINE}/ci_export_clipboard_props.rs`,
      "e2e/copyAsImage.spec.ts",
    ],
  },
  {
    section: "📋 Clipboard tricks",
    status: "covered",
    tests: [`${ENGINE}/ci_edit.rs`, "engine/src/host/keys.test.ts"],
  },
  // "Export SVG" sat in this section with no rule of its own: /PNG|SVG|Google
  // Docs|single element/ caught it, which is not the same as claiming it. Narrowing
  // that pattern to what it was really about dropped these two lines out of the ledger
  // altogether -- the denominator fell 931 -> 929 while the covered count went UP, which
  // is the shape of a number that cannot be trusted on its own.
  // **A pattern that matches a line by accident is not coverage of it**, and the only way
  // to tell the difference is to narrow it and see what falls out.
  {
    section: "💾 Files",
    text: /^Export SVG$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export.rs`, `${ENGINE}/ci_export_png.rs`, "e2e/exportPng.spec.ts"],
  },
  {
    section: "💾 Files",
    text: /^Export PNG$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_png.rs`,
      `${WEB}/draw-chrome/exportParity.test.ts`,
      "e2e/exportPng.spec.ts",
    ],
  },
  {
    section: "💾 Files",
    text: /read-only link/,
    status: "gap",
    why: "No read-only share link. The Share dialog (share.ts) makes a room, not a published board.",
  },
  // It needed its own rule because the `^Export PNG$` rule above no longer matched it, and
  // without one it would have fallen through to the section's covered catch-all below, which
  // names the JSON pipeline as its tests and has nothing to do with the clipboard. (It was
  // already a gap before 4.1, via the old `/PNG|read-only link/` rule; nothing moved down.)
  // It was a gap until 4.3, which is the commit that closed it.
  // 4.3. A copy is the export, unchanged: actionCopyAsPng
  // (`actionClipboard.tsx@1118751f:192`) and actionCopyAsSvg (`:124`) both call
  // `prepareElementsForExport(elements, appState, true)` -- the literal `true` in both,
  // at `:139` and `:212`. So an empty selection copies the whole scene and a lone
  // selected frame copies that frame's contents, and neither is decided a second time.
  // The `why` this replaces named 4.3 and was false the moment this merged.
  {
    section: "💾 Files",
    text: /Copy PNG to clipboard/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_clipboard.rs`,
      `${ENGINE}/ci_export_clipboard_props.rs`,
      "e2e/copyAsImage.spec.ts",
    ],
  },
  // The binding is real; the chord is now pressed, and only the load behind it is
  // unexercised — Save/export and Import are covered through their underlying JSON
  // pipeline below.
  {
    section: "💾 Files",
    text: /Ctrl\/Cmd \+ O` — Open\/load a scene/,
    status: "gap",
    why: "half — `e2e/shortcuts.spec.ts` presses Ctrl+O with the main menu open and the file chooser opens, which is the half that was untested (`DrawSurface.svelte`'s `onAppShortcut` binds mod+O to `mainMenu.openFile()`). No test answers the picker: nothing loads a scene from a file through this chord.",
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
  // "Export entire canvas" and "Export PNG" are the same sentence after this change: the
  // PNG export is framed by the scene's own bounds, not by the viewport, which is what
  // shortkey.md:444 and :446 were each asking for.
  // And the same accident again in Export tricks, where `^Export PNG$` names the raster
  // Docs|single element/ caught it, which is not the same as claiming it. Narrowing
  // that pattern to what it was really about dropped these two lines out of the ledger
  // altogether -- the denominator fell 931 -> 929 while the covered count went UP, which
  // is the shape of a number that cannot be trusted on its own.
  // **A pattern that matches a line by accident is not coverage of it**, and the only way
  // to tell the difference is to narrow it and see what falls out.
  {
    section: "🔍 Export tricks",
    text: /^Export SVG$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export.rs`, `${ENGINE}/ci_export_png.rs`, "e2e/exportPng.spec.ts"],
  },
  {
    section: "🔍 Export tricks",
    text: /^(Export entire canvas|Export PNG)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export_png.rs`, "e2e/exportPng.spec.ts"],
  },
  {
    section: "🔍 Export tricks",
    text: /^Copy selection as PNG$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_clipboard.rs`,
      `${ENGINE}/ci_export_clipboard_props.rs`,
      "e2e/copyAsImage.spec.ts",
    ],
  },
  {
    // Was `/frames/` with the why "No per-frame export mode" -- which is still *true*, and is
    // the interesting part, and no longer the reason this line is a gap. A frame export is a
    // selection export of one frame: there is no frame-specific mode and 4.2 did not add one.
    // What it did add is that the frame's own element is what gets measured
    // (`exportToCanvas:228-233`, zero padding, its turned box) while its contents are what
    // gets painted, with `frameRendering.clip = false` at `:217-219` so the frame's own clip
    // does not cut the content at its edge. A child poking past the edge is cropped, and that
    // is the oracle's answer.
    //
    // Narrowed from `/frames/` to the one line it ever matched, so it stops shadowing anything.
    section: "🔍 Export tricks",
    text: /^Export frames where appropriate$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export_scope.rs`, "e2e/exportPng.spec.ts"],
  },
  {
    // This exact-match rule shadowed the broader `/Selection export|Export selection/` added
    // for design.md:1337, because first match wins and this one is earlier. So the figure
    // moved by three when four lines were closed and the fourth stayed a gap for a reason
    // that had been false since 4.2 landed. **A count that moves is not evidence that the
    // right line moved** -- which is why the coverage test asserts named lines, not a total.
    section: "🔍 Export tricks",
    text: /^Export selection$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export_scope.rs`, "e2e/exportPng.spec.ts"],
  },
  {
    // 4.3. Already anchored, and it is the path the oracle gives no chord to at all:
    // `actionCopyAsSvg` declares no `keyTest` (`actionClipboard.tsx:124-190` ends at
    // `keywords`), so Alt+Shift+C copies a raster and the SVG has no shortcut.
    section: "🔍 Export tricks",
    text: /^Copy selection as SVG$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export_clipboard.rs`, "e2e/copyAsImage.spec.ts"],
  },
  // Half of this line is now true and half is not, so it stays a gap and says which is
  // which rather than claiming the whole sentence.
  // 4.5. The `why` this replaces said "Half. The PNG export honours it … while the SVG still
  // always renders one", and it also claimed the SVG "still takes its padding from the front" and
  // that "`DrawExportModal.svelte` calls `exportSvg(16)`". **All three clauses are false**, and the
  // third has been false since 4.2 took the front's number.
  //
  // THE DEFAULT IS INCLUDE, and one line decides it: `appState.ts@1118751f:69`
  // `exportBackground: true`, with `scene/export.ts@1118751f:458` a TWO-PART `&&` —
  // `if (appState.exportBackground && viewBackgroundColor)`. **Both halves matter: an empty colour
  // is not a colour.** Asserted on its own (`the_defaults_are_paper_on_and_dark_off`), because a
  // default that differs is the whole feature.
  //
  // AND THE HARD HALF WAS NOT THE RECT. The background is also what an OUTLINE ARROWHEAD IS
  // PUNCHED THROUGH WITH, and what the PNG's canvas is filled with — **three reads of one string**,
  // and the oracle reads one value three times (`export.ts:466`, `helpers.ts:115-119`, and the
  // arrowhead fills inherit it). Making the rect optional without noticing the other two would have
  // shipped **a white hole in an arrowhead on every transparent export**, and a test asking "does
  // the rect disappear" passes straight over that.
  // `an_outline_arrowhead_is_punched_with_the_chosen_paper` is the test that would not.
  //
  // "Background color" never meant a missing colour. The oracle's export dialog has **no colour
  // picker** (`ImageExportDialog.tsx:220-275` offers only-selected, with-background, dark-mode,
  // embed-scene, scale) — the colour is `viewBackgroundColor`, app state the canvas picker writes
  // (`actionCanvas.tsx:73-74`) and the export only reads.
  {
    section: "🔍 Export tricks",
    text: /^Include\/exclude background depending on export settings$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_background.rs`,
      `${ENGINE}/ci_export.rs`,
      `${WEB}/draw-chrome/exportParity.test.ts`,
      "e2e/exportPng.spec.ts",
    ],
  },
  // 4.5. `design.md:1333` "Background color" was recorded as half done, and the half that was
  // missing was never the colour — it was that the SVG could not be talked out of its `<rect>`.
  // That is now done, and the oracle's own dialog having no colour picker is why: there is one
  // colour, the theme's, and the front has no second one to disagree with.
  {
    section: "32. Export",
    text: /^Background color$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_background.rs`,
      `${ENGINE}/ci_export.rs`,
      `${WEB}/draw-chrome/exportParity.test.ts`,
    ],
  },
  // 4.5, and the `why` this replaces said "Export always uses the light palette" — which is the
  // opposite of what shipped. Dark mode is not a second palette; it is ONE colour filter over
  // every colour the renderer writes.
  {
    section: "39. Dark mode / themes",
    text: /^Export theme$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export_background.rs`, "e2e/exportPng.spec.ts"],
  },
  // Kept narrow so it can carry the reason 4.5 established, which is the interesting part.
  {
    section: "39. Dark mode / themes",
    text: /^Collaboration colors$/,
    status: "gap",
    why: 'deferred: not in the oracle, and the reason is a design one rather than a port. `getClientColor` (packages/excalidraw/clients.ts@1118751f:29-44) hashes the peer id to a hue and returns a FIXED `hsl(hue, 100%, 83%)`; it takes no theme, reads none, and `clients.ts` does not contain the string "theme" anywhere. Ours is a front literal (apps/web/src/lib/realtime/realtimeClient.ts:104, CURSOR_COLORS) and it is SENT OVER THE WIRE in every presence message, which is the part that makes a local fix wrong: **a theme-following collaborator colour cannot be a local decision**, because two people in a room must see the same person in the same colour and each client\'s theme is its own. That points at the server, or at a derivation from the shared peer id. Written down in docs/reference/export.md, not built.',
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
      "e2e/presentationPath.spec.ts",
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
    tests: [`${ENGINE}/ci_lock.rs`, `${ENGINE}/ci_group_locks_frames.rs`, `${ENGINE}/ci_hover.rs`],
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
      `${ENGINE}/ci_lock.rs`,
      `${ENGINE}/ci_group_locks_frames.rs`,
      `${ENGINE}/ci_hover.rs`,
      `${ENGINE}/ci_lasso.rs`,
      `${ENGINE}/ci_eraser.rs`,
      `${WEB}/draw-chrome/menu.test.ts`,
    ],
  },
  // 6.3. The `why` this replaces said snapping "applies to moving a selection only", and it
  // named `App.tsx:13375` and `:13499` as the two call sites. **Both are wrong** -- they are
  // `maybeDragNewGenericElement` and `maybeHandleCrop`, not snapping entry points. The real
  // ones are `:13383` and `:13625`.
  //
  // There are FOUR entry points, not two, and the third is this task's own headline verb:
  //   `snapDraggedElements`   :692-807    from App.tsx:11097   the moved box's 9 stops
  //   `snapNewElement`        :1246-1316  from App.tsx:13383   ONE point: origin+dragOffset
  //   `snapResizingElements`  :1108-1244  from :13625, :13507  side handle 2, corner 1
  //   `getSnapLinesAtPointer` :1318-1400  from App.tsx:7870    the pointer, at hover
  //
  // `snapNewElement` is gated on `isSnappingEnabled` ONLY -- **there is no tool gate on it.**
  // `isActiveToolNonLinearSnappable` (:1402-1414) gates `getSnapLinesAtPointer`, the HOVER, and
  // only that. Reading it as "decides whether a tool can snap at all" would gate the corner
  // snap to seven tools and drop the sticky note's corner, which the oracle keeps.
  //
  // The ORDER is `getPointSnaps` (:636-690) being `for our point { for reference {`, kept on
  // `<=` and replaced only on `<` -- **a tie keeps the first found.**
  //
  // The CANDIDATES are box corners and a centre, never outline points:
  // `getReferenceSnapPoints` (:616-634) -> `getElementsCorners` (:198-313). The case that
  // settles it -- a reference box (0,0,100,80) and a pointer x of 53, where the centre stop 50
  // is 3 away and snaps, the edges are 53 and 47 away and are out of reach, and the nearest
  // outline point is 53 away: **an outline-based snapper could not have answered at all.**
  //
  // NOT CLAIMED, and reported rather than fixed. `SNAP_PX` is **6** where the oracle's
  // `SNAP_DISTANCE` is **8** (`snapping.ts:41`) -- and that is the number every Q/R pair here
  // is stated against, so it is load-bearing rather than cosmetic. Ours also reads the
  // UNROTATED box where the oracle rotates by `angle` (:241-291), and the grid WINS over
  // objects where the oracle composes them (`snapping.ts:178-184`, `App.tsx:13402-13403`).
  // Phase 1, all three, all pre-existing.
  {
    section: /^(3\. Rectangle|4\. Ellipse|5\. Diamond)/,
    text: /Snap to nearby objects/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_draw_object_snap.rs`,
      `${ENGINE}/ci_resize_object_snap.rs`,
      `${ENGINE}/ci_object_snap_props.rs`,
      `${ENGINE}/ci_freedraw_origin.rs`,
      "e2e/objectsSnap.spec.ts",
    ],
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
    status: "covered",
    // The `why` this replaces was false, and false in a way that pointed at the wrong file.
    // It read: "Not implemented -- no backspace/undo-last-point exists while placing a
    // multi-point line (multi_linear.rs)." Every clause is wrong. The oracle has no Backspace
    // handler on the line editor at all -- BACKSPACE appears in exactly three places in it,
    // and `linearElementEditor.ts` contains none of them -- so there was nothing to implement
    // *during placement* to match. And what "Remove point" actually is, in
    // `actionDeleteSelected.tsx@1118751f:228-273`, is Backspace on the *selected* points of a
    // line already placed. The prerequisite is per-point selection, which did not exist in any
    // layer; `design.md:276` "Move individual points" is still unbuilt and depends on it.
    //
    // Three branches, in this order, because the order is the spec: no selection => fall
    // through to deleting whole elements; every point selected => delete the element;
    // otherwise remove the selected points and re-map the selection to `[first - 1]`, or `[0]`.
    // `deletePoints` (linearElementEditor.ts:1576-1618) then has a polygon rule -- removing the
    // start, the end or the uncommitted point rewrites nextPoints[0] from the last -- and
    // normalises through the point reseat `multi_linear.rs` already had, so there is one
    // normaliser and not two.
    //
    // Points are held by a click, or by shift-dragging a box over the line being edited. The
    // second is the oracle's `isSelectingPointsInLineEditor`
    // (`App.tsx@1118751f:10895-10899`), named there and requiring `event.shiftKey`; a press
    // that misses the line clears `isEditing` at `:9591-9607`, which is why a plain box-drag
    // cannot reach `handleBoxSelection` at all. The box only ever grows, because `:283`'s latch
    // reads the previous set.
    tests: [`${ENGINE}/ci_point_delete.rs`],
  },
  {
    section: "6. Line",
    text: /^Move entire line$|^Rotate$/,
    status: "covered",
    tests: [`${ENGINE}/ci_line_multipoint.rs`],
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
  // The comment this replaces said "nothing in the crate computes that", which was true and was
  // the wrong reason: it read as a missing feature here rather than an absent one in the oracle.
  // 5.2 walked the call graph and the oracle has **no endpoint-to-element snapping at all**.
  //
  // Placing a line's preview point reaches `handlePointDragging` at `App.tsx@1118751f:11253` and
  // dragging an existing endpoint reaches **the same function** at `:10853`, so the oracle does
  // share the helper and both gestures answer alike. Its transitive closure — `createPointAt`,
  // `_getShiftLockedDelta`, `pointDraggingUpdates`, `movePoints`, `_updatePoints` — contains
  // **zero** calls into `snapping.ts`, and `maybeCacheReferenceSnapPoints`, the only writer of the
  // snap cache, is called at `:11095`, `:13381`, `:13505` and `:13623`, none of them on this path.
  //
  // What it *does* snap to is two things, in order: the grid, per axis (`getGridPoint`,
  // `linearElementEditor.ts:1468`), then the angle lock (`getLockedLinearCursorAlignSize`,
  // `:1895-1935`, which grid-snaps first at `:1916`). `getSnapLinesAtPointer` is gated on
  // `isActiveToolNonLinearSnappable` (`:1402-1414`) and lists rect/ellipse/diamond/frame/
  // magicframe/image/text — not `line`, not `selection`. And the reachable candidate generators
  // use bounding-box corners and centres (`snapping.ts:198-313`), not points or midpoints.
  {
    section: "6. Line",
    text: /^Endpoint snapping$/,
    status: "gap",
    why: "not in the oracle - a line's endpoint snaps to the grid and then to the angle lock, and to nothing else. 6.3 STRENGTHENED this, and better evidence is better: there is now a SECOND oracle entry point that demonstrably does not apply to a line, where 5.2 could only cite the absence of one. `snapNewElement` (:1246-1316, from App.tsx:13383) snaps exactly ONE point, origin+dragOffset, and is gated on `isSnappingEnabled` with no tool gate at all - so nothing about it is line-shaped. The tool gate that WOULD exclude a line, `isActiveToolNonLinearSnappable` (:1402-1414), gates the hover and only the hover. Implemented for the grid half as snap_gesture beside snap (engine/mod.rs), with a Q/R pair per case: same gesture, grid on, snapping without Ctrl and landing on the raw pointer with it.",
  },
  {
    section: "6. Line",
    status: "covered",
    tests: [`${ENGINE}/ci_linear_anchor.rs`, `${ENGINE}/ci_snapping.rs`, `${ENGINE}/ci_binding.rs`],
  },
  {
    section: "7. Arrow",
    text: /[Ee]lbow/,
    status: "covered",
    tests: [`${ENGINE}/ci_elbow.rs`, `${ENGINE}/ci_elbow_oracle.rs`, "e2e/elbowArrow.spec.ts"],
  },
  // 5.3. The `why` this replaces said the label "cannot be dragged along it -- Excalidraw's
  // labelPosition (linearElementEditor.ts@1118751f:1962-2030) is not ported". The function is at
  // :1963-2030; :1962 is its `static` line.
  //
  // A plain primary-button drag on the label. The call graph, walked from the top: hover at
  // `App.tsx:8445` gives `CURSOR_TYPE.GRAB` via `arrowText.isBoundTextGrabbable`; the
  // bounding-box handles are taken FIRST (`:9406-9442`) and only a press that missed them
  // enters `LinearElementEditor.handlePointerDown`; the grab is refused when
  // `clickedPointIsHandle` or `segmentMidpoint` (`linearElementEditor.ts:1150-1183`) and the
  // offset is measured from the label's CENTRE (`:1234-1242`); `App.tsx:10766`
  // `arrowText.maybeDragLabel` owns the move past `DRAGGING_THRESHOLD / zoom`; and
  // `handleBoundTextDragging` (`:1963-2030`) writes `labelPosition` and `x`/`y` on every move.
  //
  // THE UNIT is a fraction of the arrow's own PATH ARC LENGTH, in [0,1] -- written as
  // `(prefixSums[i] + lengthWithinSegment) / totalLength` (`:2011-2018`), read as
  // `clamp(f, 0, 1) * totalLength` (`:2050`). The path is `getLinearElementPathSegments`
  // (`utils.ts:206-233`): the DRAWN curve for a rounded arrow, chords for a sharp one, and an
  // elbow's unrounded logical polyline whatever `roundness` says. Pieces are measured by arc
  // length, so 0.5 is half the ground covered, not half the parameter.
  //
  // The fixture in `tests/fixtures/label-position.json` is what settles it, and the shape of it
  // is the point. A straight three-point arrow with perpendicular chords of 120 and 90 -- path
  // 210 long. At fraction 0.25 the path says (52.5, 0), and the bounding-box reading, the
  // one-segment reading and the world-offset reading **all say the same wrong thing**:
  // (30, 0), (30, 0), (0.25, 0). **A discriminator that three wrong readings agree on is not
  // a discriminator**, so 0.25 alone cannot decide between four of them. At 0.6 the answer is
  // (120, 6) -- six units into the SECOND chord, which a per-segment reading can never reach.
  //
  // Two consequences that are easy to get wrong and are now tested: a LINE's label does not
  // move (`isArrowElement` is in the guard), and at the default the label sits *under* the
  // segment-midpoint knob, so a press dead on its centre is a POINT drag and the knob wins by
  // design. A test that pressed the centre would have silently been testing the other feature.
  //
  // 0 and 1 are legal and reachable -- clamped on write, on read and on load
  // (`restore.ts:573-575`). Dragging 5000 units past either end parks the label there.
  //
  // 5.5's non-convertibility is CONNECTED, through the label's EXISTENCE and not its position:
  // `isEligibleLinearElement` (`ConvertElementTypePopup.tsx:666-672`) refuses on
  // `hasBoundTextElement`, and `labelPosition` is a field on the label, so dragging can neither
  // make a labelled arrow convertible nor an unlabelled one non-convertible.
  {
    section: "7. Arrow",
    text: /label positioning/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_label_position.rs`,
      "packages/contract/tests/engineParity.test.ts",
      "e2e/labelDrag.spec.ts",
    ],
  },
  {
    section: "7. Arrow",
    text: /Arrowhead|Straight arrows|Curved arrows/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_next_style.rs`,
      `${ENGINE}/ci_style.rs`,
      `${ENGINE}/ci_arrowhead_oracle.rs`,
      "e2e/arrowType.spec.ts",
    ],
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
  // freehand.rs ports perfect-freehand's streamline and speed thinning; the stroke tests
  // pin both.
  {
    section: "8. Freedraw / pencil",
    text: /^(Point smoothing|Stabilization|Smoothing)$/,
    status: "covered",
    tests: [`${ENGINE}/ci_freehand_stroke.rs`],
  },
  {
    section: "8. Freedraw / pencil",
    text: /[Pp]ressure/,
    status: "gap",
    why: "Width comes from speed, as perfect-freehand simulates for a mouse (freehand.rs thinning, ci_freehand_stroke.rs); a pen's own pressure is never read.",
  },
  {
    section: "8. Freedraw / pencil",
    text: /stylus|[Pp]alm|[Tt]ouch|pen vs/,
    status: "gap",
    why: "Pen, touch and mouse are not told apart and a palm is not rejected — see §23.",
  },
  {
    section: "8. Freedraw / pencil",
    text: /interpolation/,
    status: "gap",
    why: "Not claimed: the samples are streamlined (ci_freehand_stroke.rs), but nothing pins whether points are added between them.",
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
    status: "covered",
    tests: [`${ENGINE}/ci_image.rs`],
  },
  {
    section: "10. Images",
    text: /^Copy\/paste$/,
    status: "covered",
    tests: [`${ENGINE}/ci_image.rs`],
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
  // ci_sticky.rs now drives the rotation handle itself, in a new `mod turning_it`: the
  // handle turns the note, a turned note turns its bound label with it as
  // rotateSingleElement does, and a turn changes nothing about a note's size or its label.
  {
    section: "11. Sticky notes",
    text: /^Rotate$/,
    status: "covered",
    tests: [`${ENGINE}/ci_sticky.rs`],
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
  // Presentation mode is the frame-to-frame navigation: each frame is a slide, stepped
  // with the arrow keys and fitted to the screen.
  {
    section: "12. Frames",
    text: /Frame navigation/,
    status: "covered",
    tests: [`${WEB}/draw-chrome/presentation.test.ts`, "e2e/presentation.spec.ts"],
  },
  {
    section: "12. Frames",
    // Both word orders, and the omission is worth naming: `/Export frame/` alone matches
    // shortkey.md:451 "Export frames where appropriate" and misses design.md:1339 "Frame
    // export", so the line 4.2 actually closed stayed a gap while the number moved anyway.
    // A count that moves is not evidence that the right line moved -- which is why the
    // coverage test asserts named lines rather than a total.
    text: /Frame export|Export frame/,
    status: "covered",
    // The `why` this replaces said "See the Frames rule: export has no frame mode", and the
    // second half is now false in an interesting way: a frame export is a *selection* export of
    // one frame, and there is still no frame-specific mode. The distinction that matters is that
    // a frame is measured by its own element while its contents are what gets painted.
    //
    // `exportToCanvas@1118751f:228-233` sets `exportPadding = 0` and measures `[exportingFrame]`
    // -- the frame element's own turned box, not the union of what it holds -- and `:217-219`
    // sets `frameRendering.clip = false`, without which the frame's own clip cuts the content
    // off at its edge. So a child poking past the edge is cropped, and that is the answer rather
    // than an accident. Framing by the contents would show the poking child and would not match.
    tests: [`${ENGINE}/ci_export_scope.rs`, "e2e/exportPng.spec.ts"],
  },
  // Three cases in ci_frame.rs now drag a frame's own handle: the grown bounds take in
  // what they now hold, the shrunken bounds let go of what no longer fits, and the handles
  // are its eight sides and corners. The rule stays a gap because the fourth thing is not
  // true. Shrinking a frame RELEASES a child left straddling its new edge, where the oracle
  // keeps and clips it (frame.ts@1118751f:312-316) — FrameOwners::of_bounds decides on
  // containment alone, so a straddling child resolves to None and needs_frame_clip goes
  // false. Filed as a Phase 1 task; flipping this rule before that is fixed would claim a
  // behaviour the engine does not have.
  {
    section: "12. Frames",
    text: /^Resize frame$/,
    status: "gap",
    why: "A frame grows and shrinks through the generic handle path and its membership follows (ci_frame.rs) — but a child left crossing the shrunken frame's new edge is released instead of kept and clipped, which is what the oracle does. Phase 1.",
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
    // drawn or resized, goes directly below it — is pinned in ci_zorder.rs, through undo
    // and redo (a new element's place is part of its creation, so the step records no
    // reorder of its own) and through a peer's order patch, which cannot name a child the
    // peer has never seen and now leaves it in the slot it was drawn in rather than on
    // top (ci_zorder.rs › a_peers_order_leaves_a_new_frame_child_where_the_peer_never_saw_it).
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
      `${ENGINE}/ci_lock.rs`,
      "e2e/lock.spec.ts",
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
    why: "Nothing on the canvas marks a locked element: Excalidraw's click on one shows an unlock popup and a dashed outline (activeLockedId, UnlockPopup.tsx@1118751f), not built here. Only the context menu offers Unlock (ci_lock.rs, e2e/lock.spec.ts).",
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
    why: "No modifier gives a smaller nudge than the plain 1px arrow-key step. Alt+Arrow walks the flowchart with one element selected and is that same 1px nudge otherwise, as in the oracle (engine/src/host/keys.test.ts).",
  },
  {
    section: "15. Transform engine",
    text: /^Negative dimensions normalization$/,
    status: "covered",
    tests: [`${ENGINE}/ci_geometry.rs`],
  },
  // 6.2. The two divergences this rule used to name are both closed, and the interesting one was
  // not the one the `why` said. The 15 degree constant is `math::SHIFT_LOCKING_ANGLE` (`math.rs:35`),
  // used by one quantiser, and the drag keeps its length by intersecting the locked ray with the
  // perpendicular through the cursor (`sizeHelpers.ts:236-250`) rather than by rotating the delta.
  //
  // What the `why` did not know is that the CONSTANT was never the bug. The oracle's rotation
  // rounding is `angle += step/2; angle -= angle % step` (`resizeElements.ts@1118751f:230-231`), and
  // `%` truncating toward zero only behaves like a floor BECAUSE the raw angle is built
  // `5*PI/2 + atan2(..)` and is therefore never negative (`:227`). Ours was built a whole turn
  // smaller, so it is negative, and the truncation opened a cell TWICE AS WIDE around zero: a locked
  // turn snapped the entire lower-left quadrant to 0 instead of 345/330/315.
  // `math::shift_locked_angle` normalises with `rem_euclid(TAU)` first and then rounds, so the input
  // range stops mattering -- better than adopting the oracle's `5*PI/2`, which would make the
  // quantiser correct for the one caller the oracle has rather than for every caller.
  //
  // The rotation path turned out to be a SEPARATE gap over the same constant: `rotate_element` and
  // `rotate_group` took no quantisation at all, and `square` was arriving from the pointer input
  // (`pointerInput.ts:27`) and going unread in both branches (`pointer_move.rs:282`, `:155`).
  //
  // The flat and square branches are NOT the projection: the oracle keeps the raw surviving component
  // and discards the other (`:229-234`), so a 100x10 drag comes out exactly 100, not the 99.52 a
  // projection gives. It branches on the step COUNT (`k = 0 mod 12`, `k = 6 mod 12`) rather than
  // comparing angles, because `6*(PI/12)` is not reliably `FRAC_PI_2` in binary and the oracle's own
  // `lockedAngle === Math.PI/2` can miss.
  //
  // TRAP, so a later cleanup does not unify them: `hover.rs:67`'s `FRAC_PI_4` is CORRECT and is not a
  // duplicate of this constant. It is the cursor step -- `rotateResizeCursor` uses
  // `Math.round(angle / (Math.PI/4))` over four cursors (`resizeTest.ts:223`). Two 45s in this
  // codebase, two different concerns, and a "find the duplicated angle constant" pass breaks one.
  //
  // Still open, and NOT this rule: `selection/linear.rs:79-82` returns an empty `world_points` when
  // `points` is None, so a line loaded from JSON without points has no endpoint handles at all. And
  // `text/layout.rs:97` is a third inline copy of `round_half_up`, a duplication candidate rather than
  // a duplicate of `hover.rs:67`.
  {
    section: "15. Transform engine",
    text: /^(Angle snapping|Shift angle locking)$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_rotate_lock.rs`,
      `${ENGINE}/ci_lock.rs`,
      `${ENGINE}/ci_end_snap.rs`,
      `${ENGINE}/ci_group_locks_frames.rs`,
      "e2e/angleLock.spec.ts",
    ],
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
  // (z-order is array position, CLAUDE.md), so the rest are stable by construction. The
  // server keeps the slot over HTTP (boards.test.ts) and in the merge itself
  // (reconcile.test.ts), the engine keeps it around a tombstone in a peer's order
  // (ci_zorder.rs), and the client's own model of a delete now matches the real merge
  // (sceneDiff.merges.test.ts). Not pinned: a LOCAL delete followed by another z-order
  // command — `scene.remove` tombstones and keeps the array length (draw_engine.rs) but
  // nothing asserts where the survivors stand afterwards.
  {
    section: "17. Z-order",
    text: /^Stable ordering after deletion$/,
    status: "gap",
    why: "partly pinned — the merge keeps the slot (reconcile.test.ts, boards.test.ts over HTTP), the engine keeps it around a tombstone in a peer's order (ci_zorder.rs), and the client's model of a delete matches the real merge (sceneDiff.merges.test.ts). Not pinned: a local delete followed by another z-order command, where nothing asserts where the survivors stand.",
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
  // Split four ways. One rule said
  // `/Equal spacing|Configurable increments|Configurable grid|Connection points/` and was a
  // `gap`, so it could not be flipped for the one part that shipped. **A rule that covers four
  // features across two tasks is a rule that can never be flipped**, because the tasks land at
  // different times. FOURTH instance — after `/PNG|SVG|Google Docs|single element/`, the Grid
  // rule's `custom grid spacing|disable snapping`, and the Export rule's three-way split. All
  // four mine, all the same shape, and the fix is always the same: one rule, one feature.
  //
  // 6.5 answered the other two thirds of Phase 6.5, and both answers are "not in the oracle":
  //
  // SNAP INCREMENTS: `design.md:832` is a **child of "Angle snapping"** (`:825`), not a linear
  // step. `SHIFT_LOCKING_ANGLE` is a module constant (`constants.ts@1118751f:31`) and `appState`
  // has no angle-increment field. **No UI was built** — a brief that offers a feature the
  // reference does not have is offering an invention.
  //
  // CONNECTION POINTS: the term is ABSENT from the oracle. The real thing is `getAllMidpoints`
  // (`utils.ts:743-767`) — four sites per shape, shapes from `isBindableElement`
  // (`typeChecks.ts:184-202`: rectangle, stickynote, diamond, ellipse, image, iframe,
  // embeddable, frame, magicframe, and a container-less text; **not** `line`, **not** `freedraw`,
  // **not** a selection).
  {
    section: "19. Snapping",
    text: /^Equal spacing$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_equal_spacing.rs`,
      `${ENGINE}/ci_equal_spacing_props.rs`,
      `${ENGINE}/ci_snapping.rs`,
      `${ENGINE}/ci_draw_object_snap.rs`,
    ],
  },
  // Deliberately left narrow, because the whole of 6.5's answer is that it does not exist.
  {
    section: "19. Snapping",
    text: /^Configurable increments$/,
    status: "gap",
    why: 'deferred: not in the oracle. 6.5 read the line it came from: design.md:832 is a CHILD of "Angle snapping" (:825), not a linear step. `SHIFT_LOCKING_ANGLE` is a module constant (constants.ts@1118751f:31) and `appState` carries no angle-increment field, so there is no setting to port and no UI was built.',
  },
  {
    section: "19. Snapping",
    text: /^Configurable grid$/,
    status: "gap",
    why: "6.6, and untouched by 6.5 — it was in this rule's pattern by accident, which is the reason the rule had to be split.",
  },
  // The machinery EXISTS — `midpoint_snap_radius`, `bindable_at` and `is_bindable_element` are
  // all in the motor — and it is still a gap, because 6.5 found a real divergence in it.
  {
    section: "19. Snapping",
    text: /^Connection points$/,
    status: "gap",
    why: "The machinery is there (`midpoint_snap_radius` in scene/binding.rs, `bindable_at`, `is_bindable_element`) and it is still a gap because 6.5 found a real divergence in it: **a diamond's connection sites are its four VERTICES here and its four EDGE MIDPOINTS in the oracle** — a 25% inset — and the doc comment at scene/binding.rs:370-383 asserts the wrong answer, which is worse than no comment. Phase 1. The oracle's rule is `getAllMidpoints` (utils.ts@1118751f:743-767), four sites per shape, over `isBindableElement` (typeChecks.ts:184-202), where the term \"connection points\" appears nowhere.",
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
    status: "covered",
    tests: ["e2e/shortcuts.spec.ts"],
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
    tests: [
      `${ENGINE}/ci_flowchart.rs`,
      `${ENGINE}/ci_flowchart_oracle.rs`,
      "e2e/flowchart.spec.ts",
    ],
  },
  // design.md:1044 "Shape conversion" was claimed by the section catch-all below, which is
  // `covered` and names one test. That is the ledger's version of 4.3's `/PNG|SVG|Google
  // Docs|single element/`: a rule that matches a line by ACCIDENT is not coverage of it, and
  // the only way to tell the difference is to give the line its own rule and see whether the
  // tests survive contact with the claim.
  //
  // 5.5's substance is that three of the four conversions are REFUSALS, not transformations:
  //   - converting away from an arrow DROPS its heads, because `newLinearElement` writes
  //     `startArrowhead: null, endArrowhead: null` unconditionally
  //     (`ConvertElementTypePopup.tsx@1118751f:583-586`), overwriting the spread's;
  //   - it refuses to touch bindings at all. `isEligibleLinearElement` (`:666-672`) admits a
  //     line always and an arrow only while unbound and unlabelled, so `getConversionTypeFromElements`
  //     never returns "linear" and TAB DOES NOT EVEN OPEN THE PANEL. "A switch never breaks a
  //     binding" is true by construction and is implemented as the refusal;
  //   - and the elbow is the one conversion that CHANGES THE POINTS -- a re-route between the
  //     same two ends (`convertLineToElbow`, `:712-802`, orthogonal, THRESHOLD = 20), not a
  //     type flag.
  //
  // Undo is one step on the keyboard path (`scheduleCapture`, `store.ts:110-112`); the CLICK
  // path never calls it and rides whatever capture comes next. Ours stamps on both, which is
  // strictly tighter -- a deliberate divergence, recorded rather than hidden.
  //
  // The round trip is CACHED, not recomputed, as the oracle does
  // (`LINEAR_ELEMENT_CONVERSION_CACHE`, `:157-161`, filled `:280-292`, read `:551-556`).
  //
  // Note this does not move the figure: the line was already counted covered by the catch-all.
  // The point is that the claim is now NAMED and AUDITABLE rather than accidental.
  {
    section: "26. Autoshape / flowchart logic",
    text: /^Shape conversion$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_shape_convert.rs`,
      "apps/web/src/lib/draw-chrome/shapeSwitch.test.ts",
      "e2e/shapeSwitch.spec.ts",
    ],
  },
  {
    section: "26. Autoshape / flowchart logic",
    status: "covered",
    tests: [`${ENGINE}/ci_recognize.rs`],
  },
  {
    section: "27. Keyboard system",
    text: /Tab/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_shape_convert.rs`,
      `${WEB}/draw-chrome/shapeSwitch.test.ts`,
      "e2e/shapeSwitch.spec.ts",
    ],
  },
  // Shift-click is a pointer gesture, not a keydown, so it is absent from keys.test.ts —
  // the additive/subtractive click the section rule below never actually exercises.
  {
    section: "27. Keyboard system",
    text: /^Shift-click$/,
    status: "covered",
    tests: [`${ENGINE}/ci_multi_select.rs`],
  },
  // copySelection/cutSelection exist (keys.ts's handleModChords) and Ctrl+V rides the
  // browser's own paste event — e2e/clipboard.spec.ts now dispatches all three for real.
  {
    section: "27. Keyboard system",
    text: /^Cmd\/Ctrl\+[CXV]$/,
    status: "covered",
    tests: ["e2e/clipboard.spec.ts"],
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
    why: "The engine exposes methods, not named actions. The host's command palette keeps a registry of named commands (commandPalette.ts), but shortcuts, menus and buttons still call the engine directly, so there is no single place all four agree on — design.md is right that this is the load-bearing one.",
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
    status: "covered",
    tests: [`${ENGINE}/ci_paste_text.rs`, "e2e/clipboard.spec.ts"],
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
  // The order half of autosave is NOT carried by sceneDiff.test.ts, which cannot: `diff`
  // and `acknowledge` share `predictOrder` and read the same `this.order`, so a wrong
  // prediction is wrong identically on both sides and every assertion there passes. What
  // pins it is apps/web/src/lib/autosave/sceneDiff.merges.test.ts, which puts the
  // tracker's model against `reconcileElements` — the merge the API actually runs — so
  // the prediction has to agree with a module the client never calls.
  //
  // Three of its four cases are green and one is not, and the split IS the finding: the
  // primitive is wrong for a resurrected id, while the production path is right anyway
  // because `diffAll` notices the mismatch and sends an explicit order. The client is
  // therefore still wrong, which is what zorder.md's cross-client row now says.
  //
  // Not a `gap`: nothing here is unwatched, and no §17 checklist line is a cross-client
  // order merge — a rule placed there would match nothing and fail the registry's own
  // dead-rule check, or hijack an unrelated item.
  {
    section: "31. Persistence",
    status: "covered",
    tests: [
      `${ENGINE}/ci_persistence.rs`,
      `${WEB}/autosave/autosaver.test.ts`,
      `${WEB}/autosave/sceneDiff.test.ts`,
      `${WEB}/autosave/sceneDiff.merges.test.ts`,
    ],
  },
  // Transparent background and Scale are the two dialog controls the PNG export now answers
  // (design.md:1331,1335). Background color is a different line and stays a gap: the
  // export paints the theme's own background, and nothing anywhere chooses one — that is
  // 4.5, and the SVG path's background rect is fixed for the same reason.
  {
    section: "32. Export",
    text: /^(Transparent background|Scale)$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_png.rs`,
      `${WEB}/draw-chrome/exportParity.test.ts`,
      "e2e/exportPng.spec.ts",
    ],
  },
  {
    section: "32. Export",
    // `^Selection export$` alone matches design.md:1337 and misses shortkey.md:445
    // "Export selection", the same reversal as the frame rule above.
    text: /Selection export|Export selection/,
    status: "covered",
    // The `why` this replaces ended "That is 4.2", which is now done. What decides the element
    // list is a layer above the bounds function, in `prepareElementsForExport`
    // (`data/index.ts@1118751f:48-96`): `:56-58` sets `isExportingSelection` from
    // `exportSelectionOnly && isSomeElementSelected(...)`, asked about the *elements* rather than
    // the ids, so ids that are not on the board do not count as a selection. There is no
    // selection-bounds function and no frame-bounds function -- `getCanvasSize`
    // (`export.ts@1118751f:566-575`) takes a list and `getCommonBounds` folds over it, and both
    // formats hand it the same expression: `exportToCanvas:232-235` and `exportToSvg:341-344` are
    // character-for-character the same call.
    //
    // An empty selection exports the **whole scene**, deliberately: `:56-58`'s flag never becomes
    // true, so `:61-69` takes its else arm. Pinned, because it is the case most able to pass
    // without being exercised.
    //
    // The property test is the one that matters: an export's world rect must *contain* every
    // element it was asked to paint, over ten scene shapes including turned, nested, framed,
    // child-poking-out, deleted and zero-sized. That is what catches a cull aimed at the editor's
    // camera instead of the export's own rect -- the failure 4.1's acceptance list was written to
    // prevent.
    tests: [`${ENGINE}/ci_export_scope.rs`, "e2e/exportPng.spec.ts"],
  },
  // scene_to_svg's <image> arm is exercised directly: a real embedded data URL, a flipped
  // image, and the no-picture-yet fallback.
  {
    section: "32. Export",
    text: /^Images$/,
    status: "covered",
    tests: [`${ENGINE}/ci_image.rs`],
  },
  // 4.4, and the `why` this replaces ("Neither exportSvg nor exportPng embeds the .osidraw
  // JSON into the file for round-trip re-import") is false.
  //
  // The KEY is `osidraw`, not the oracle's `application/vnd.excalidraw+json`
  // (`constants.ts:310`), and that is not a preference — it is the difference between two clean
  // answers. Borrowing their key turns a clean "not mine" into "I thought this was one of mine
  // and it is broken". Verified by running the oracle's `decodePngMetadata` transcribed
  // verbatim: `osidraw` -> INVALID, their key with our payload -> FAILED, their key with a real
  // Excalidraw payload -> ok. Also 7 bytes against 40, and not a MIME type.
  //
  // We write generation 1: plain scene JSON, uncompressed, base64'd. The oracle's generation 1
  // is plain JSON in a BST RING and its generation 2 is zlib (`data/encode.ts:99-121`,
  // pako@2.0.3); we neither write nor read generation 2. The label is the same and the bytes
  // are not, which is why ours carries a prefix and the table is written down in the module.
  //
  // PARITY IS NOT REACHABLE, and the crate that would be needed is not worth spending yet. An
  // Excalidraw payload is an *Excalidraw schema*, and mapping that is 4.7 — deferred as RISK.
  // Our PNG will never open in Excalidraw either, because ours is `osidraw` and its legacy arm
  // demands `type === "excalidraw"`. So `miniz_oxide` buys ONE STEP of a two-step journey and
  // step two is 4.7. The failure avoided today is not mojibake; it is a scene that cannot be
  // read *silently*, and the three refusals already avoid it.
  //
  // The refusals, all pinned: no `tEXt` chunk -> NotOurs; a chunk under another key -> NotOurs,
  // which the oracle cannot tell apart either (`image.ts:51`); our key with garbage text ->
  // Unreadable; a generation we do not know -> Unreadable, never misread; **our own generation
  // with `elements: []` -> Unreadable**, which is the silent failure the task exists to prevent;
  // a scene whose own `version` is 99 -> **restores**, because the version is not the gate and
  // the gate has to stay keepable; not walkable -> Malformed. First `tEXt` wins, both
  // directions — the oracle's `find`, not a `filter`.
  //
  // THE "IF DESIRED" HALF IS NOT BUILT, and it cannot be split off here. There is no checkbox
  // for it — `prompt/design.md:1352` is one line containing both halves, and `ruleFor` is
  // first-match-wins, so a line resolves to exactly one rule. Two rules for one sentence is not
  // expressible in this ledger, and writing the gap as a second pattern here would claim the
  // line twice rather than split it. The missing checkbox is the owner's to schedule, because
  // adding one to `design.md` renumbers the citations after it. Until then the honest statement
  // is: **embedding is unconditional**, the oracle's `exportEmbedScene` defaults to `false`,
  // and a picture carrying nothing is a lossy format wearing a `.png` name — so this is a
  // deliberate divergence and not an oversight.
  {
    section: "32. Export",
    text: /^Embedded scene data if desired$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_roundtrip.rs`,
      `${ENGINE}/ci_export_roundtrip_bytes.rs`,
      `${ENGINE}/ci_export_roundtrip_props.rs`,
      `${WEB}/draw-chrome/openFile.test.ts`,
      "e2e/roundTrip.spec.ts",
    ],
  },
  {
    section: "32. Export",
    text: /^(Files|Exportable app state)$/,
    status: "gap",
    why: "The exported .osidraw JSON (OsidrawFile in export/json.rs) carries only type, version and elements — no files map and no appState, so neither round-trips.",
  },
  // Canvas → PNG (design.md:1329) is whole-scene and at a chosen scale, so the PNG and
  // Scale lines close here. What is left in this block is everything about *which* elements
  // and *where* the bytes end up: a frame, a font, the clipboard.
  {
    section: "32. Export",
    text: /^Canvas → PNG$/,
    status: "covered",
    tests: [`${ENGINE}/ci_export_png.rs`, "e2e/exportPng.spec.ts"],
  },
  // `[Ff]rame export` came out of this pattern when 4.2 landed: a frame export exists now, and
  // it is covered by the "12. Frames" rule above. What is left is genuinely still open, and the
  // clause naming 4.2 went with it -- a reason that says "that is 4.2" stops being true the day
  // 4.2 merges, and nothing catches it.
  // Split three ways. One rule said `Clipboard image|Selection → image|Whole canvas → image|
  // ^Fonts$` and was a `gap` with a `why` naming 4.3 as unfinished, so it could not be flipped
  // for the one part that had shipped. **A rule that covers three features is a rule that
  // cannot be flipped, because the features land at different times** — the same failure as the
  // Grid rule's `custom grid spacing|disable snapping` and 4.3's `/PNG|SVG|Google Docs|
  // single element/`. Three instances now, all mine, all the same shape.
  //
  // `^Fonts$` — 4.6. The SVG carries the faces: `scene/export.ts@1118751f:439-441` calls
  // `Fonts.generateFontFaceDeclarations(elements)` and `:443-451` joins it into
  // `<style class="style-fonts">` inside the defs. **The `why` this replaces said the export
  // "names the font families without embedding an @font-face", which was the opposite of what
  // shipped** — and which came from a grep I ran against `scene/export.ts` alone and reported
  // as a statement about the oracle. A zero in one file is not a zero.
  //
  // Our family strings MATCH theirs for the eight families this app can produce, pinned for
  // all 64 ids the contract accepts. They differ for ids 4, 10 and 11..=64, deliberately: the
  // oracle names `Segoe UI Emoji`, and in the only case that can arrive (an Obsidian board
  // carrying `fontFamily: 4`) the oracle's answer is the WORSE one, because it is an emoji font.
  // A test fails loudly if anyone "fixes" it.
  {
    section: "32. Export",
    text: /^Fonts$/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_svg_fonts.rs`,
      `${ENGINE}/ci_svg_fonts_bytes.rs`,
      `${ENGINE}/ci_svg_fonts_props.rs`,
      `${WEB}/draw-chrome/fonts.test.ts`,
    ],
  },
  // `Selection → image` — 4.2, and the DIALOG's choice rather than the clipboard's.
  // `exportParity.test.ts:504-519` is the test that matters and it asserts the host *hands the
  // decision over*: `options.selectionOnly` reaches the engine for both raster and vector.
  // `:540-543` asserts the opposite for the clipboard, because the oracle's two copy actions
  // pass the literal `true` (`actionClipboard.tsx:139`, `:212`) and have no such option at all.
  // **The same word on both sides means two different things, and one test holds both.**
  {
    section: "32. Export",
    text: /Selection → image/,
    status: "covered",
    tests: [
      `${ENGINE}/ci_export_scope.rs`,
      `${WEB}/draw-chrome/exportParity.test.ts`,
      "e2e/exportPng.spec.ts",
    ],
  },
  // `Whole canvas → image` — 4.1. `e2e/exportPng.spec.ts:525` is "exports the whole scene even
  // when the camera is looking at part of it", and `:386` and `:414` pin the rule 4.2 recorded:
  // an empty selection IS the whole scene (`data/index.ts:56-58`, the `else` arm at `:69`), so
  // "an unset flag is the whole scene".
  {
    section: "32. Export",
    text: /Whole canvas → image/,
    status: "covered",
    tests: [`${ENGINE}/ci_export.rs`, `${ENGINE}/ci_export_png.rs`, "e2e/exportPng.spec.ts"],
  },
  {
    section: "32. Export",
    status: "covered",
    tests: [
      `${ENGINE}/ci_export.rs`,
      `${ENGINE}/ci_export_png.rs`,
      `${WEB}/draw-chrome/exportParity.test.ts`,
      "e2e/exportPng.spec.ts",
    ],
  },
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
  // Lock and Unlock are clicked in the context menu by e2e/lock.spec.ts, on a group.
  {
    section: "34. Menus",
    text: /^Lock$|^Unlock$/,
    status: "covered",
    tests: ["e2e/lock.spec.ts", `${ENGINE}/ci_lock.rs`],
  },
  // Each action is implemented and tested at the engine/store level (grouping, z-order,
  // duplicate, delete, copy/paste) but no test clicks the context-menu entry itself and
  // checks the effect — menu.test.ts covers what the menu *offers*, not what clicking an
  // item *does*.
  {
    section: "34. Menus",
    text: /^Cut$|^Copy$|^Duplicate$|^Delete$|^Group$|^Ungroup$|^Bring forward$|^Send backward$/,
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
  //
  // FLIPPED to covered by e2e/collabPeople.spec.ts. Worth knowing what "covered" means here,
  // because it is not the usual thing: **the oracle has no collaborator people-list UI at this
  // pin.** Grepping the pinned Excalidraw for a collaborator list finds only the `Collaborator`
  // *type* in its own tests — no component, no avatars, no "N online". So this line is our
  // design.md's feature, not an oracle behaviour, and covered means "we have tests for what we
  // built" rather than "we match the reference".
  //
  // The claim these two lines made was "implemented, untested — no test asserts it renders or
  // updates", and that is now false. Five cases, each proved able to fail by a six-mutation
  // battery, two of which red exactly one test each — M3 (folding past the first peer into a
  // "+2 more" row) reds only the four-people test, and M6 (the server's `gone` no longer
  // deleting a peer) reds only the leave test. That is the evidence the tests are specific
  // rather than merely present. Every assertion goes through one reader scoped to
  // [role="dialog"] .peers-section, and count and name are asserted together, so a list of the
  // right length missing a name cannot read as a pass.
  //
  // Two defects the same round surfaced, both left unfixed and both filed as Phase 1 work:
  // DrawShareModal.svelte:268-270 labels the first row "You (Host)" for *whoever* has the
  // dialog open, so a guest who opened a shared link is told they are the host while the real
  // host sits below them — pinned as a characterization test, which records today's behaviour
  // bug included, and that is why it is called out here rather than left to be discovered.
  // And nobody can type a name at all: realtimeClient.ts:157-171 is the only writer of
  // drawnosaurus:userName anywhere in the repo and it generates `Dino ${100-999}`. There is no
  // name field, no rename, no prompt. "the name the sharer typed" describes software that does
  // not exist yet; the test asserts the announced name is shown verbatim instead.
  {
    section: "40. Collaboration",
    text: /^Collaborator avatars$/,
    status: "covered",
    tests: ["e2e/collabPeople.spec.ts"],
  },
  // The peers-list DrawShareModal renders (avatars, "N online") is the same untested
  // surface as Collaborator avatars just above — nothing asserts it renders or updates.
  //
  // Same spec, same battery. The boundary is worth naming because it is not the one a reader
  // would guess: there is no "+N" anywhere in DrawShareModal.svelte, every peer is rendered
  // unconditionally, and the only boundary is `max-height: 150px` with a scroll. Four people
  // give four rows and four avatars, with the fourth clipped by the dialog's own bottom edge.
  //
  // The stale-peer question is only half answered, and the gap is deliberate rather than
  // overlooked. The `gone` path is covered: the product already deleted correctly, and what
  // was missing was both a test and a *reachable* way for a test to announce a departure —
  // e2e/board.ts:248-251's `gone`-on-close is dead code under Playwright, because
  // WebSocketRoute.onClose does not fire when the page closes (measured: guest tab closed, 8s
  // waited, onClose never fired, the host still showed the guest's cursor; the same frame
  // handed over by hand took it to 0). The spec therefore hands the frame over itself, and
  // e2e/peers.spec.ts:223-231's comment claiming a closed tab is announced "the same way a
  // real connection loss does" is false — that test passes on the engine's local
  // LASER_DECAY_TIME_MS timer instead. The silent-peer path (crash, network drop) is
  // PEER_STALE_MS = 45_000 on a 10s timer and is NOT exported, so the earliest honest check is
  // 55s against this config's 30s timeout, and a spec that waits out a wall clock on a shared
  // machine is a flaky spec. Left open on purpose and said so in the spec's own header.
  {
    section: "40. Collaboration",
    text: /^User list$/,
    status: "covered",
    tests: ["e2e/collabPeople.spec.ts"],
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
    why: "Painted, not asserted: snap guides, binding highlights, frame clips and peer cursors are all drawn (wasm/paint.rs), but no test checks the paint itself, only the state it reads. Redraws are saved by a scroll blit (render/scroll.rs), not dirty rectangles or a tile cache.",
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
    why: "Toolbar and menu roles and labels are in place and asserted by the browser specs, and every overlay that takes the focus on open hands it back on close — `takeFocus` in `focusHandback.ts`, which is the oracle's own pair (`Dialog.tsx@1118751f:52`, `:99-104`), asserted for the export, shortcuts and canvas-menu overlays in `e2e/shortcuts.spec.ts` and for the share and templates dialogs in their own specs. Two of the fourteen overlays take no focus on open, named rather than rounded up: the More tools menu keeps the focus on the board on purpose, so its chords still reach the board (`DrawToolbar.svelte:42-44`, `:112-127`), and the embed dialog focuses nothing, which is the open Phase 1.5. The main menu's hand-back lands on its trigger button, not on the board, which is correct for a menu and leaves the board without the focus until it is clicked — a design decision, not a bug, and `docs/reference/shortcuts.md` › Known limits carries the inventory. But there is still no focus trap: Tab walks out of an overlay, where the oracle cycles inside it (`Dialog.tsx@1118751f:69-95`, `Popover.tsx@1118751f:52-80`). High contrast and screen-reader labels are unaudited.",
  },
  // DrawMainMenu.svelte's onKeyDown answers ArrowDown/ArrowUp by stepping the highlighted
  // One of the two does. The main menu answers ArrowDown/ArrowUp and e2e/keysMenus.spec.ts
  // now drives it; the canvas menu's onkeydown handles Escape and nothing else
  // (DrawContextMenu.svelte:90-92), so focus never leaves its own box. The old why here
  // said "both menus answer ArrowDown/ArrowUp" — that was false, and 3.4(d) is what found it.
  {
    section: "48. Accessibility",
    text: /^Menu keyboard navigation$/,
    status: "gap",
    why: "Half done, and the half that is missing is a feature rather than a test. The main menu answers ArrowDown/ArrowUp and keysMenus.spec.ts drives it; the canvas menu's onkeydown handles Escape only (DrawContextMenu.svelte:90-92), so it answers no arrow key at all. Phase 1.",
  },
  // Every menu item shows its own chord inline (dropdown-menu-item__shortcut) and `?`
  // opens the shortcuts help. Read *and* pressed: the canvas menu's z-order hints, and
  // the main menu's. The two style hints and the palette's `<kbd>` are not read by
  // anything.
  {
    section: "48. Accessibility",
    text: /^Shortcut discoverability$/,
    status: "gap",
    why: "half — `?` opens the shortcuts dialog and `e2e/shortcuts.spec.ts` presses it; the canvas menu's front and back z-order hints are read and the chord each names is then pressed (`e2e/console.spec.ts:305-326`), and the main menu's `dropdown-menu-item__shortcut` is read and pressed by `e2e/shortcuts.spec.ts`. Not read: the canvas menu's Copy-styles and Paste-styles hints — their chords are pressed (`e2e/console.spec.ts:268`, `:271`) and the items themselves clicked (`:284`, `:287`), but no test reads those two hints — and the `<kbd>` the command palette prints beside each command (`DrawCommandPalette.svelte:105`).",
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
