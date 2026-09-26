import { expect, test } from "../fixtures.ts";
import {
  OPEN_CANVAS,
  expectLabelBound,
  expectSceneMatches,
  exportPngAndSvg,
  maybeWriteTemplate,
  openBoard,
  placeFrame,
  placeStickyAt,
  renameFrame,
  reopenWith,
  sceneElements,
  waitForAutosave,
  writeText,
} from "./helpers.ts";

/**
 * Story 3 — sprint retro: three frames, each renamed to its own column ("Went well", "To
 * improve", "Actions" — a real rename, through the double click on the name label:
 * `renameFrame`, `engine/frame_rename.rs`) and holding a couple of sticky notes, with a
 * title above them all. `stickyNote.spec.ts` drives the note itself (N, a drag to size
 * it, type, Escape); this just repeats that inside frames the notes are judged into on
 * their own commit.
 */

const COLUMN_W = 220;
const COLUMN_TOP = OPEN_CANVAS.top + 40;
const COLUMN_H = 400;
const GAP = 20;
const COL1 = OPEN_CANVAS.left + 10;
const COL2 = COL1 + COLUMN_W + GAP;
const COL3 = COL2 + COLUMN_W + GAP;
/** Wide enough that a note's longest single word ("teamwork", "releases") wraps only
 *  against the next word, never mid-word — narrower notes broke inside a word instead. */
const NOTE_SIZE = { w: 170, h: 110 };
const ACTION_NOTE_SIZE = { w: 170, h: 100 };

test("sprint retro: three frames of sticky notes and a title", async ({ page }) => {
  test.setTimeout(90_000);
  const slug = "retro";
  const board = await openBoard(page, slug);

  const title = await writeText(board, { x: COL1 + 40, y: OPEN_CANVAS.top + 10 }, "Sprint Retro");

  const wentWell = await placeFrame(
    board,
    { x: COL1, y: COLUMN_TOP },
    { w: COLUMN_W, h: COLUMN_H },
  );
  const toImprove = await placeFrame(
    board,
    { x: COL2, y: COLUMN_TOP },
    { w: COLUMN_W, h: COLUMN_H },
  );
  const actions = await placeFrame(board, { x: COL3, y: COLUMN_TOP }, { w: COLUMN_W, h: COLUMN_H });

  await renameFrame(board, wentWell, "Went well");
  await renameFrame(board, toImprove, "To improve");
  await renameFrame(board, actions, "Actions");

  const wentWellNotes = [
    await placeStickyAt(board, { x: COL1 + 20, y: COLUMN_TOP + 45 }, NOTE_SIZE, "Great teamwork"),
    await placeStickyAt(board, { x: COL1 + 20, y: COLUMN_TOP + 185 }, NOTE_SIZE, "Fast releases"),
  ];
  const toImproveNotes = [
    await placeStickyAt(board, { x: COL2 + 20, y: COLUMN_TOP + 45 }, NOTE_SIZE, "Slow reviews"),
    await placeStickyAt(board, { x: COL2 + 20, y: COLUMN_TOP + 185 }, NOTE_SIZE, "Flaky tests"),
  ];
  const actionNotes = [
    await placeStickyAt(
      board,
      { x: COL3 + 20, y: COLUMN_TOP + 45 },
      ACTION_NOTE_SIZE,
      "Add CI cache",
    ),
    await placeStickyAt(
      board,
      { x: COL3 + 20, y: COLUMN_TOP + 165 },
      ACTION_NOTE_SIZE,
      "Pair more",
    ),
    await placeStickyAt(
      board,
      { x: COL3 + 20, y: COLUMN_TOP + 285 },
      ACTION_NOTE_SIZE,
      "Retro on Fridays",
    ),
  ];

  const built = await sceneElements(page);
  const counts: Record<string, number> = {};
  for (const element of built) counts[element.type] = (counts[element.type] ?? 0) + 1;
  expect(counts["frame"]).toBe(3);
  expect(counts["stickynote"]).toBe(7);
  expect(counts["text"]).toBe(8); // 7 note labels + the title

  for (const { note, label } of [...wentWellNotes, ...toImproveNotes, ...actionNotes]) {
    expectLabelBound(built, note.id, label.text!);
  }

  const byId = new Map(built.map((element) => [element.id, element]));
  for (const { note } of wentWellNotes) expect(byId.get(note.id)?.frameId).toBe(wentWell.id);
  for (const { note } of toImproveNotes) expect(byId.get(note.id)?.frameId).toBe(toImprove.id);
  for (const { note } of actionNotes) expect(byId.get(note.id)?.frameId).toBe(actions.id);
  expect(byId.get(wentWell.id)?.name, "the column's own name, not a heading text").toBe(
    "Went well",
  );
  expect(byId.get(toImprove.id)?.name, "the column's own name, not a heading text").toBe(
    "To improve",
  );
  expect(byId.get(actions.id)?.name, "the column's own name, not a heading text").toBe("Actions");

  const savedTitle = byId.get(title.id)!;
  expect(savedTitle.text).toBe("Sprint Retro");
  expect(savedTitle.frameId ?? null, "the title sits above the frames, in none of them").toBeNull();

  await maybeWriteTemplate(board, "retro");

  const saved = await waitForAutosave(board);
  expectSceneMatches(built, saved.values(), "the saved scene matches what was drawn");
  const reopened = await reopenWith(board, slug, saved);
  expectSceneMatches(
    await sceneElements(reopened.page),
    saved.values(),
    "the reload matches the save",
  );

  await exportPngAndSvg(board);
});
