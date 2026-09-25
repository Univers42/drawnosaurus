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
  {
    section: "🧩 Frames",
    text: /Rename|Export frames/,
    status: "gap",
    why: "Frames carry a name and render it, but nothing edits it, and export has no per-frame mode.",
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
    section: "🔄 Flowcharts",
    status: "gap",
    why: "No flowchart mode: node creation from a shape, keyboard navigation between nodes, and automatic bound-arrow connection. Bindings and shapes underneath it are done.",
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
  { section: "🔴 Laser pointer", status: "covered", tests: [`${ENGINE}/ci_laser.rs`] },
  {
    section: "✋ Hand / panning",
    status: "covered",
    tests: [`${ENGINE}/ci_pointer.rs`, "e2e/shortcuts.spec.ts"],
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
    status: "gap",
    why: "No command palette, and the prerequisite is the action registry from design.md §28 — commands have to be addressable by name before anything can list them.",
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
    status: "covered",
    tests: [`${ENGINE}/ci_edit.rs`, "engine/src/host/keys.test.ts"],
  },
  {
    section: "💾 Files",
    text: /PNG|read-only link/,
    status: "gap",
    why: "No PNG export and no read-only share link. SVG and JSON are done.",
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
  { section: "🔍 Export tricks", status: "covered", tests: [`${ENGINE}/ci_export.rs`] },
  {
    section: "👥 Collaboration",
    text: /Follow another|undo\/redo/,
    status: "gap",
    why: "Follow-mode and multiplayer-aware history. Presence, cursors and last-write-wins element sync are done.",
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
  {
    section: "2. Element system",
    status: "covered",
    tests: ["packages/contract/tests/element.test.ts", `${ENGINE}/ci_persistence.rs`],
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
    status: "covered",
    tests: [
      `${ENGINE}/ci_image.rs`,
      `${WEB}/draw-chrome/imageFile.test.ts`,
      "e2e/image.spec.ts",
      "apps/api/tests/integration/images.test.ts",
    ],
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
  {
    section: "12. Frames",
    text: /Rename|Export frame|Frame navigation/,
    status: "gap",
    why: "See the Frames rule: naming is stored and drawn but not editable, and export has no frame mode.",
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
    // Was swept up by the section rule below while nothing read Alt during a resize.
    text: /Alt center scaling/,
    status: "gap",
    why: "Alt does not resize from the centre: every handle holds the opposite side or corner, one element or several. Excalidraw scales about the centre while Alt is held (shouldResizeFromCenter, resizeElements.ts@1118751f:621-727, 1056-1059).",
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
    status: "gap",
    why: "No flowchart mode — see the Flowcharts rule.",
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
    why: "Tab does nothing on the canvas. It is the flowchart navigation key, so it waits on that.",
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
  { section: "30. Clipboard", status: "covered", tests: [`${ENGINE}/ci_edit.rs`] },
  {
    section: "31. Persistence",
    text: /IndexedDB|crash recovery|localStorage preferences/,
    status: "gap",
    why: "Autosave goes to the API and a localStorage draft is the fallback; there is no IndexedDB store and no crash-recovery prompt.",
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
    text: /Command palette|Search commands|Keyboard navigation|Execute actions|Shortcut display|Link|Add to library|Properties/,
    status: "gap",
    why: "The command palette and the menu entries that depend on features not built yet (links, library, a stats panel).",
  },
  {
    section: "34. Menus",
    status: "covered",
    tests: [`${WEB}/draw-chrome/menu.test.ts`, `${WEB}/draw-chrome/shapeActions.test.ts`],
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
  {
    section: "40. Collaboration",
    text: /Follow user|Remote selections|Active tool|User list/,
    status: "gap",
    why: "Presence beyond cursors. Element sync, last-write-wins, reconnection with catch-up, the offline queue and the connection state are done.",
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
    status: "covered",
    tests: [`${ENGINE}/ci_render_drawable.rs`, `${ENGINE}/ci_export.rs`, `${ENGINE}/ci_grid.rs`],
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
    status: "covered",
    tests: [`${ENGINE}/ci_geometry.rs`, `${ENGINE}/ci_math.rs`, `${ENGINE}/ci_camera.rs`],
  },
  {
    section: "48. Accessibility",
    text: /High contrast|Reduced motion|Screen-reader|focus trap|Focus management/,
    status: "gap",
    why: "Toolbar and menu roles and labels are in place and asserted by the browser specs; the rest is unaudited.",
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
