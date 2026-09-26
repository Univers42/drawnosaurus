import type { Download, Page } from "@playwright/test";
import { expect } from "../fixtures.ts";
import {
  OPEN_CANVAS,
  focusBoard,
  openBoard,
  patchedElements,
  pickTool,
  sceneElements,
  type Board,
  type SceneElement,
} from "../board.ts";
import { editor, writeText, type BoardElement } from "../textBoard.ts";

/**
 * Shared building blocks for the `stories/*.spec.ts` boards.
 *
 * Every story builds through the real toolbar, keyboard shortcuts, the command palette
 * and real pointer drags — never `loadScene` — so these are thin wrappers around the
 * same gestures `flowchart.spec.ts`, `figure.spec.ts` and `arrowLabel.spec.ts` already
 * drive by hand. What is common across five stories (grow a flowchart node and label
 * it, place a figure, bind an arrow between two shapes, wait for autosave, compare a
 * reload) lives here once rather than five times.
 *
 * Coordinates are screen pixels inside `OPEN_CANVAS`. A fresh board's camera is
 * `x: 0, y: 0, scale: 1`, so a screen point there is also its own world point until
 * something pans or zooms — none of these stories do — the same assumption
 * `multiSelect.spec.ts` and `arrowLabel.spec.ts` already make.
 */

export { OPEN_CANVAS, focusBoard, openBoard, pickTool, sceneElements, writeText };
export type { Board, SceneElement };

export type Pt = { x: number; y: number };

/** The figure's own params, absent from `SceneElement` itself — `figure.spec.ts`'s own
 *  local type. */
export type FigureElement = SceneElement & {
  figure?: { kind: string; sides?: number; ratio?: number };
};

const panel = (page: Page) => page.getByRole("complementary", { name: "Style inspector" });

export const paletteInput = (page: Page) => page.getByRole("combobox", { name: "Command palette" });

/** The Shapes tool's kind picker, in the style panel — `figure.spec.ts`'s own locator. */
export const figureKindRadio = (page: Page, label: string) =>
  panel(page).getByRole("radio", { name: label, exact: true });

/** A style preset chip on the panel, by its name — `stylePresets.spec.ts`'s own locator. */
export const presetButton = (page: Page, name: string) => page.getByRole("button", { name });

/** The one element in `after` not present in `before`, of `type` — `flowchart.spec.ts`'s
 *  own helper, duplicated here rather than imported: a spec file is not a library. */
export function onlyNewOf(
  before: SceneElement[],
  after: SceneElement[],
  type: string,
): SceneElement {
  const beforeIds = new Set(before.map((element) => element.id));
  const found = after.filter((element) => !beforeIds.has(element.id) && element.type === type);
  if (found.length !== 1) {
    throw new Error(`expected exactly one new ${type}, found ${found.length}`);
  }
  return found[0]!;
}

/** Opens the command palette, types `query`, presses Enter, and waits for it to close. */
export async function runPaletteCommand(board: Board, query: string): Promise<void> {
  const { page } = board;
  const input = paletteInput(page);
  await page.keyboard.press("Control+/");
  await expect(input).toBeFocused();
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
}

/** Enter starts editing whatever is selected, types `text`, Escape commits it — the
 *  same key the flowchart and figure specs use to label a just-created node. */
export async function labelSelected(board: Board, text: string): Promise<void> {
  const { page } = board;
  await page.keyboard.press("Enter");
  await expect(editor(board)).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(editor(board)).toHaveCount(0);
}

/** The palette's "Add rectangle", labelled — the checkout story's keyboard-first start. */
export async function insertLabeledRectangle(board: Board, label: string): Promise<SceneElement> {
  const before = await sceneElements(board.page);
  await runPaletteCommand(board, "add rectangle");
  const after = await sceneElements(board.page);
  const node = onlyNewOf(before, after, "rectangle");
  await labelSelected(board, label);
  return node;
}

/** Ctrl(+digit)+Arrow grows a bound node off the current selection; the digit picks its
 *  kind exactly as the flowchart shape strip does (1 rectangle, 2 diamond, 3 ellipse). */
export async function growNode(
  board: Board,
  dir: "ArrowRight" | "ArrowLeft" | "ArrowUp" | "ArrowDown",
  label: string,
  digit?: "1" | "2" | "3",
): Promise<{ node: SceneElement; arrow: SceneElement }> {
  const { page } = board;
  const before = await sceneElements(page);
  await page.keyboard.down("Control");
  await page.keyboard.press(dir);
  if (digit) await page.keyboard.press(digit);
  await page.keyboard.up("Control");
  const after = await sceneElements(page);
  const arrow = onlyNewOf(before, after, "arrow");
  const kind = digit === "2" ? "diamond" : digit === "3" ? "ellipse" : "rectangle";
  const node = onlyNewOf(before, after, kind);
  await labelSelected(board, label);
  return { node, arrow };
}

/** A drag with the given tool, from `at` sized by `size` — `versionStamps.spec.ts`'s own
 *  `drawBox`, generalised to any drag-drafted tool (rectangle, diamond, ellipse, frame). */
export async function dragTool(
  board: Board,
  tool: string,
  at: Pt,
  size: { w: number; h: number },
): Promise<void> {
  const { page, box } = board;
  await focusBoard(board);
  await pickTool(page, tool);
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + size.w, box.y + at.y + size.h, { steps: 6 });
  await page.mouse.up();
}

/** Draws a plain shape (rectangle/diamond/ellipse) by dragging it, and labels it. */
export async function placeShapeAt(
  board: Board,
  tool: "Rectangle" | "Diamond" | "Ellipse",
  at: Pt,
  size: { w: number; h: number },
  label?: string,
): Promise<SceneElement> {
  const kind = tool.toLowerCase();
  await dragTool(board, tool, at, size);
  const placed = (await sceneElements(board.page)).filter((el) => el.type === kind).at(-1);
  if (!placed) throw new Error(`no ${kind} was placed`);
  if (label) await labelSelected(board, label);
  return placed;
}

/** Draws a frame by dragging the Frame tool — `pointer.rs::begin_frame` drafts it like a
 *  rectangle. Anything created inside its bounds afterwards is judged into it on its own
 *  commit (`pointer_end.rs::judge_created_frame_membership`) — no membership call here. */
export async function placeFrame(
  board: Board,
  at: Pt,
  size: { w: number; h: number },
): Promise<SceneElement> {
  await dragTool(board, "Frame", at, size);
  const placed = (await sceneElements(board.page)).filter((el) => el.type === "frame").at(-1);
  if (!placed) throw new Error("no frame was placed");
  return placed;
}

/**
 * Double-clicks a frame's name label and types `name` over it, committing with Enter —
 * the real rename (`FrameRenameRequest` / `renameFrame`, `engine/frame_rename.rs`), now
 * that one exists, in place of the separate heading text the stories used to draw for it.
 * `frame.x + 8, frame.y - 8` lands inside the label's hit box regardless of its own text
 * (`frame_name_at`): just right of its left edge, and well above the frame's own border
 * but below the label's top.
 */
export async function renameFrame(board: Board, frame: SceneElement, name: string): Promise<void> {
  const { page } = board;
  const at = await worldToCanvas(board, frame.x + 8, frame.y - 8);
  await page.mouse.dblclick(board.box.x + at.x, board.box.y + at.y);
  const input = page.locator('input[aria-label="Frame name"]');
  await expect(input).toBeVisible();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
}

/** Picks the Shapes tool, chooses `kind` in the panel, drags it out, and labels it — the
 *  drag `figure.spec.ts`'s `placeFigure` uses: a click alone is discarded as too small. */
export async function placeFigureAt(
  board: Board,
  kind: string,
  at: Pt,
  size: { w: number; h: number } = { w: 120, h: 90 },
  label?: string,
): Promise<FigureElement> {
  const { page, box } = board;
  await focusBoard(board);
  await pickTool(page, "Shapes");
  await figureKindRadio(page, kind).click();
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + size.w, box.y + at.y + size.h, { steps: 6 });
  await page.mouse.up();
  const placed = (await sceneElements(page)).filter((el) => el.type === "figure").at(-1) as
    FigureElement | undefined;
  if (!placed) throw new Error("no figure was placed");
  if (label) await labelSelected(board, label);
  return placed;
}

/** N, then a drag to size it, then typed text committed with Escape — `stickyNote.spec.ts`'s
 *  own `writeNote`, generalised to a chosen size and position. Held with Shift: a plain
 *  drag settles a note square, to the larger of the two sides (`pointer_end.rs::end_sticky`),
 *  so a `size` with `w !== h` needs Shift to keep the rectangle it asked for. */
export async function placeStickyAt(
  board: Board,
  at: Pt,
  size: { w: number; h: number },
  text: string,
): Promise<{ note: SceneElement; label: SceneElement }> {
  const { page, box } = board;
  await focusBoard(board);
  await page.keyboard.press("n");
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + at.x + size.w, box.y + at.y + size.h, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(editor(board)).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(editor(board)).toHaveCount(0);
  const note = (await sceneElements(page)).filter((el) => el.type === "stickynote").at(-1);
  if (!note) throw new Error("no sticky note was placed");
  return { note, label: labelOf(await sceneElements(page), note.id) };
}

/** A line placed point by point, closed by clicking back on its own start — the engine
 *  reads that as a polygon (`element.rs::is_polygon`), `lineMultipoint.spec.ts`'s own
 *  recipe for it. `sharp` picks the Edges row before the first point: it must land
 *  *after* this function's own `focusBoard`, or that plain click — with the Line tool
 *  already active from a caller picking it early to reach the Edges row itself — reads
 *  as the start of a stray point of its own. */
export async function drawClosedLine(
  board: Board,
  points: readonly Pt[],
  options: { sharp?: boolean } = {},
): Promise<SceneElement> {
  const { page, box } = board;
  await focusBoard(board);
  await pickTool(page, "Line");
  if (options.sharp) {
    await page.getByRole("group", { name: "Edges" }).getByRole("button", { name: "Sharp" }).click();
  }
  const click = async (p: Pt) => {
    await page.mouse.move(box.x + p.x, box.y + p.y, { steps: 6 });
    await page.mouse.click(box.x + p.x, box.y + p.y);
    await page.waitForTimeout(60);
  };
  for (const point of points) await click(point);
  await click(points[0]!); // back onto the start: closes the loop
  await page.waitForTimeout(120);
  const line = (await sceneElements(page)).filter((el) => el.type === "line").at(-1);
  if (!line) throw new Error("no line was drawn");
  return line;
}

/** A world point translated to this page's current camera, in canvas-relative pixels
 *  (not screen-absolute — `writeText` and the mouse helpers add `board.box` themselves). */
export async function worldToCanvas(board: Board, wx: number, wy: number): Promise<Pt> {
  const { x, y, scale } = await board.page.evaluate(() => window.__drawEngine!.camera);
  return { x: wx * scale + x, y: wy * scale + y };
}

const centerOf = (el: SceneElement): Pt => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

/**
 * A point `gap` outside `shape`'s bounding box, at the midpoint of whichever side faces
 * `toward` — the same four points as the engine's own `side_midpoints`
 * (`scene/binding.rs`), which is exactly where a real drag's `snapped_midpoint` pulls an
 * orbiting end onto.
 *
 * Used to choose where an arrow drag or click lands *outside* a shape: `anchor_for_drop`
 * binds `Inside` — straight through the centre, over whatever label sits there — when the
 * drop is inside the shape, and `Orbit` — stopped a gap clear of the outline — when it is
 * outside but within `max_binding_distance` (15 world units at zoom 1). Dropping on the
 * centre, as a plain drag would, is always inside; this is how `connect`/`connectCurved`
 * land beside the outline instead.
 *
 * A side's midpoint rather than a projection straight along the diagonal to `toward`
 * (`binding.rs::attach_point`'s own approach, kept there for a caller that aims through a
 * shape's true centre): aimed at a corner, a shape whose outline recedes a long way from
 * its bounding box there — a cylinder's cap, a star's waist — landed outside
 * `max_binding_distance` of its real outline even though the drop was close to the box,
 * which left an arrow between two diagonally-placed figures unbound at both ends. A
 * side's midpoint stays over the part of the shape closest to its own box on every kind
 * this draws, exactly as it does for a rectangle, an ellipse (its curve touches the box
 * there) and a diamond (its vertex is there).
 *
 * An ellipse gets `attach_point`'s own diagonal formula after all, rather than a side's
 * midpoint: it is exact there (no corner for its curve to recede from), and several
 * arrows fanning out from one ellipse — a mind map's topic — need it, since the
 * midpoint-only approach sends every target on the same side of the shape to that one
 * fixed point, fine when only one arrow ever leaves that side.
 */
function edgeApproach(shape: SceneElement, toward: Pt, gap: number): Pt {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  if (shape.type === "ellipse") {
    const rx = Math.max(shape.width / 2, 0.5);
    const ry = Math.max(shape.height / 2, 0.5);
    const rawX = toward.x - cx;
    const rawY = toward.y - cy;
    const length = Math.hypot(rawX, rawY) || 1e-6;
    const dx = rawX / length;
    const dy = rawY / length;
    const reach = 1 / Math.hypot(dx / rx, dy / ry) + gap;
    return { x: cx + dx * reach, y: cy + dy * reach };
  }
  const hx = shape.width / 2;
  const hy = shape.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  // Whichever axis `toward` is further along, scaled by this shape's own half extent,
  // decides which pair of sides faces it — left/right or top/bottom.
  if (Math.abs(dx) * (hy || 1) >= Math.abs(dy) * (hx || 1)) {
    return { x: cx + Math.sign(dx || 1) * (hx + gap), y: cy };
  }
  return { x: cx, y: cy + Math.sign(dy || 1) * (hy + gap) };
}

/** Clear of the outline but well under the 15-unit reach `max_binding_distance(1)` gives
 *  at zoom 1 (`scene/binding.rs`), so a drop here still finds the shape and orbits it
 *  instead of landing inside. */
const ARROW_APPROACH_GAP = 8;

/** How far a curved branch's midpoint bows off the straight line between its two
 *  approach points — enough to read as a real curve, nowhere near either shape. */
const ARROW_BEND_OFFSET = 24;

/** Drags a bound arrow from just outside `from`'s outline, facing `to`, to just outside
 *  `to`'s, facing `from` — both drops land in orbit range but outside the shape
 *  (`edgeApproach`), so the arrow stops at each outline with a gap instead of running
 *  through the centre and whatever label sits there, which is what dropping on the
 *  centre itself (`anchor_for_drop`'s `Inside` case) would do. */
export async function connect(
  board: Board,
  from: SceneElement,
  to: SceneElement,
): Promise<SceneElement> {
  const { page } = board;
  await pickTool(page, "Arrow");
  const startWorld = edgeApproach(from, centerOf(to), ARROW_APPROACH_GAP);
  const endWorld = edgeApproach(to, centerOf(from), ARROW_APPROACH_GAP);
  const start = await worldToCanvas(board, startWorld.x, startWorld.y);
  const end = await worldToCanvas(board, endWorld.x, endWorld.y);
  await page.mouse.move(board.box.x + start.x, board.box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(board.box.x + end.x, board.box.y + end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(140);
  const arrow = (await sceneElements(page))
    .filter((el) => el.type === "arrow")
    .find((el) => el.startBinding === from.id && el.endBinding === to.id);
  if (!arrow) throw new Error(`no arrow bound ${from.id} -> ${to.id}`);
  return arrow;
}

/**
 * Like `connect`, but with a real bend at the midpoint, so the arrow is visibly curved —
 * a straight two-point arrow renders identically whichever way its `roundness` is set,
 * since a Catmull-Rom curve needs at least three points to bend at all
 * (`render/outline.rs::curve`). Placed click by click rather than dragged: a drag only
 * ever finishes as one straight segment, but a press-and-release too short to count as a
 * drag opens the multi-point path (`pointer_end.rs::end_linear`), the same mechanic
 * `arrowLabel.spec.ts`'s own `curvedArrow` uses. Both ends still drop just outside their
 * shape (`edgeApproach`) so they bind in orbit; the last click lands in orbit range of
 * `to`, which finishes the path and binds it there in the same gesture
 * (`multi_linear.rs::ends_path_at`) — no fourth click needed.
 *
 * The bend picks whichever of its two perpendicular sides ends up farther from both
 * shapes' centres, never a fixed rotational side: a mind map's branches sit all around
 * their topic, and a bend rotated the other, *fixed* way happened to curve back in
 * within orbit range of the branch's own outline for exactly the ones sitting north-west
 * and south-east of it — close enough that the second click's press already counted as
 * landing beside it (`ends_path_at`), finishing the path there and leaving the third
 * click to open (and immediately abandon) a path of its own.
 */
export async function connectCurved(
  board: Board,
  from: SceneElement,
  to: SceneElement,
): Promise<SceneElement> {
  const { page, box } = board;
  await pickTool(page, "Arrow");
  const startWorld = edgeApproach(from, centerOf(to), ARROW_APPROACH_GAP);
  const endWorld = edgeApproach(to, centerOf(from), ARROW_APPROACH_GAP);
  const mid = { x: (startWorld.x + endWorld.x) / 2, y: (startWorld.y + endWorld.y) / 2 };
  const dx = endWorld.x - startWorld.x;
  const dy = endWorld.y - startWorld.y;
  const length = Math.hypot(dx, dy) || 1;
  const perpX = -dy / length;
  const perpY = dx / length;
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  const minDistance = (p: Pt): number =>
    Math.min(
      Math.hypot(p.x - fromCenter.x, p.y - fromCenter.y),
      Math.hypot(p.x - toCenter.x, p.y - toCenter.y),
    );
  const candidates = [1, -1].map((sign) => ({
    x: mid.x + sign * perpX * ARROW_BEND_OFFSET,
    y: mid.y + sign * perpY * ARROW_BEND_OFFSET,
  }));
  const bendWorld =
    minDistance(candidates[0]!) >= minDistance(candidates[1]!) ? candidates[0]! : candidates[1]!;
  const click = async (world: Pt) => {
    const at = await worldToCanvas(board, world.x, world.y);
    await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 6 });
    await page.mouse.click(box.x + at.x, box.y + at.y);
    await page.waitForTimeout(60);
  };
  await click(startWorld);
  await click(bendWorld);
  await click(endWorld); // in orbit range of `to`: this click both finishes and binds it
  await page.waitForTimeout(120);
  const arrow = (await sceneElements(page))
    .filter((el) => el.type === "arrow")
    .find((el) => el.startBinding === from.id && el.endBinding === to.id);
  if (!arrow) throw new Error(`no curved arrow bound ${from.id} -> ${to.id}`);
  return arrow;
}

/** Double-clicks an arrow's own midpoint to open its label — for a straight two-point
 *  arrow the bounding box's centre *is* the midpoint of the line, as `arrowLabel.spec.ts`
 *  relies on too. */
export async function labelArrow(
  board: Board,
  arrow: SceneElement,
  text: string,
): Promise<BoardElement> {
  const mid = await worldToCanvas(board, arrow.x + arrow.width / 2, arrow.y + arrow.height / 2);
  return writeText(board, mid, text);
}

/** The text bound to `containerId` — a flowchart node's label, a figure's, a sticky's. */
export function labelOf(elements: readonly SceneElement[], containerId: string): SceneElement {
  const found = elements.find((el) => el.type === "text" && el.containerId === containerId);
  if (!found) throw new Error(`no label bound to ${containerId}`);
  return found;
}

/**
 * A label is inside its container both ways: the label points at it, and it points
 * back. Both are looked up fresh in `elements` — a container captured before its label
 * was typed is a stale snapshot whose own `boundTextId` was never re-read, which reads
 * as "not bound" no matter how real the binding is.
 */
export function expectLabelBound(
  elements: readonly SceneElement[],
  containerId: string,
  text: string,
): void {
  const container = elements.find((el) => el.id === containerId);
  if (!container) throw new Error(`no element ${containerId}`);
  const label = labelOf(elements, containerId);
  expect(label.containerId, `the "${text}" label is bound to its container`).toBe(container.id);
  expect(container.boundTextId, `the container points back at its "${text}" label`).toBe(label.id);
  expect(label.text).toBe(text);
}

/** An arrow bound at both ends to the shapes a story means it to connect. */
export function expectArrowBound(arrow: SceneElement, startId: string, endId: string): void {
  expect(arrow.startBinding, "the arrow's start is bound").toBe(startId);
  expect(arrow.endBinding, "the arrow's end is bound").toBe(endId);
}

/** Every element the page currently holds, latest write per id, tombstones dropped. */
export function mergeLatestById(flat: readonly SceneElement[]): Map<string, SceneElement> {
  const map = new Map<string, SceneElement>();
  for (const element of flat) {
    if (element.isDeleted) map.delete(element.id);
    else map.set(element.id, element);
  }
  return map;
}

/**
 * Waits for the autosaver's debounce (800ms, `autosaver.ts`) to catch up: every element
 * currently on the board has reached the server at its current version. Returns what the
 * server would now hold — reconstructed from the PATCH bodies the page actually sent,
 * the same way `versionStamps.spec.ts`'s `lastSent` reads one element at a time.
 */
export async function waitForAutosave(board: Board): Promise<Map<string, SceneElement>> {
  const { page } = board;
  await expect
    .poll(
      async () => {
        const merged = mergeLatestById(await patchedElements(page));
        const live = await sceneElements(page);
        return live.every((element) => merged.get(element.id)?.version === element.version);
      },
      { message: "autosave caught up with the built scene", timeout: 10_000 },
    )
    .toBe(true);
  return mergeLatestById(await patchedElements(page));
}

/** The fields a save/reload round trip must preserve: ids, types, bindings and text —
 *  not z-order, which the diff sends separately and this file does not need. */
function fingerprint(elements: Iterable<SceneElement>) {
  return [...elements]
    .map((element) => ({
      id: element.id,
      type: element.type,
      text: element.text ?? null,
      containerId: element.containerId ?? null,
      boundTextId: element.boundTextId ?? null,
      startBinding: element.startBinding ?? null,
      endBinding: element.endBinding ?? null,
      frameId: element.frameId ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Same ids, types, bindings and text — order-independent. */
export function expectSceneMatches(
  a: Iterable<SceneElement>,
  b: Iterable<SceneElement>,
  message?: string,
): void {
  expect(fingerprint(a), message).toEqual(fingerprint(b));
}

/** Reopens `slug` on a fresh page with `saved` served as the scene — the real load path
 *  (`+page.svelte`'s `getBoard` → `elementsFromJson`), not a test-side `loadScene`. */
export async function reopenWith(
  board: Board,
  slug: string,
  saved: Map<string, SceneElement>,
): Promise<Board> {
  const page = await board.page.context().newPage();
  return openBoard(page, slug, { scene: [...saved.values()] });
}

async function downloadSize(download: Download): Promise<number> {
  const stream = await download.createReadStream();
  if (!stream) return 0;
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => (size += chunk.length));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return size;
}

/**
 * Runs the real Export dialog (Ctrl+Shift+E, `DrawExportModal.svelte`) for both PNG and
 * SVG, and checks each download is non-empty. The dialog closes itself after PNG (a real
 * async `engine.exportPng()`), so it is reopened for SVG.
 */
export async function exportPngAndSvg(board: Board): Promise<void> {
  const { page } = board;
  const dialog = page.getByRole("dialog", { name: "Export Drawing" });

  await focusBoard(board);
  await page.keyboard.press("Control+Shift+E");
  await expect(dialog).toBeVisible();
  const [png] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /PNG Image/ }).click(),
  ]);
  expect(await downloadSize(png), "the PNG export is non-empty").toBeGreaterThan(0);
  await expect(dialog).toBeHidden();

  await focusBoard(board);
  await page.keyboard.press("Control+Shift+E");
  await expect(dialog).toBeVisible();
  const [svg] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /SVG Vector/ }).click(),
  ]);
  expect(await downloadSize(svg), "the SVG export is non-empty").toBeGreaterThan(0);
  await expect(dialog).toBeHidden();
}

/**
 * Zooms to fit the whole board, waits for the engine's own rAF to paint it, then rasterises
 * the current view exactly as the Export dialog's PNG button does (`engine.exportPng()` —
 * `canvas.toBlob`) and downscales it to a ~360px-wide preview on an in-page canvas, over a
 * white fill so it reads the same in both themes regardless of what the story's own board
 * happened to be set to. Returns a `data:` URL; `null` if the browser produced no blob.
 */
async function captureThumbnail(board: Board): Promise<string | null> {
  const { page } = board;
  await focusBoard(board);
  await page.keyboard.press("Escape"); // clear whatever focusBoard's click may have selected
  await page.keyboard.press("Shift+Digit1"); // zoom to fit — see shortcuts.spec.ts
  await page.waitForTimeout(150); // the engine schedules its repaint on the next rAF
  return page.evaluate(async () => {
    const blob = await window.__drawEngine!.exportPng();
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const width = 360;
    const height = Math.round((bitmap.height / bitmap.width) * width);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise<string | null>((resolve) => {
      canvas.toBlob((out) => {
        if (!out) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(out);
      }, "image/png");
    });
  });
}

/**
 * The regeneration step for `apps/web/src/lib/templates/*.osidraw.json` and each
 * template's `apps/web/static/templates/<name>.png`: with `GENERATE_TEMPLATES` set, each
 * story writes its own final scene out as that template's `.osidraw.json`, through the
 * exact same path `saveToDisk`/reload use (`engine.exportJson()` — already
 * `{type:"osidraw",version,elements}`, tombstones already dropped), and a small preview
 * PNG of the same board, through the same path the Export dialog's PNG button uses — so
 * neither is ever anything but "what this story built".
 *
 * A no-op otherwise — this runs inside every story's normal pass, not a separate script,
 * so there is nothing extra to keep working. Regenerate with:
 *
 * ```sh
 * docker run --rm --ipc=host -e CI= -e GENERATE_TEMPLATES=1 --user 1000:1000 -e HOME=/tmp \
 *   -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v1.63.0-noble \
 *   node node_modules/@playwright/test/cli.js test e2e/stories --trace=off --reporter=line
 * ```
 */
export async function maybeWriteTemplate(board: Board, name: string): Promise<void> {
  if (!process.env.GENERATE_TEMPLATES) return;
  const json = await board.page.evaluate(() => window.__drawEngine!.exportJson());
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const jsonDir = fileURLToPath(new URL("../../apps/web/src/lib/templates/", import.meta.url));
  await writeFile(`${jsonDir}${name}.osidraw.json`, `${json}\n`, "utf8");

  const dataUrl = await captureThumbnail(board);
  if (!dataUrl) throw new Error(`no PNG preview produced for template "${name}"`);
  const pngDir = fileURLToPath(new URL("../../apps/web/static/templates/", import.meta.url));
  await mkdir(pngDir, { recursive: true });
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  await writeFile(`${pngDir}${name}.png`, Buffer.from(base64, "base64"));
}
