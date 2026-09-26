import { expect, test } from "../fixtures.ts";
import {
  OPEN_CANVAS,
  connect,
  expectArrowBound,
  expectLabelBound,
  expectSceneMatches,
  exportPngAndSvg,
  focusBoard,
  labelArrow,
  labelOf,
  maybeWriteTemplate,
  openBoard,
  placeFigureAt,
  placeFrame,
  placeShapeAt,
  presetButton,
  reopenWith,
  sceneElements,
  waitForAutosave,
  worldToCanvas,
  writeText,
  type Board,
  type SceneElement,
} from "./helpers.ts";

/**
 * Story 2 — system architecture: three frames stacked top to bottom (Clients, Services,
 * Data), the shapes each holds, bound and labelled arrows between them, and one style
 * preset applied to both services at once. Frame membership is never set by hand — a
 * shape drawn inside an existing frame is judged into it on its own commit
 * (`pointer_end.rs::judge_created_frame_membership`), exactly what this checks.
 *
 * Each frame also gets its own heading text ("Clients", "Services", "Data") in the room
 * `CONTENT_TOP` leaves at its top: the frame's own name badge is whatever
 * `default_frame_name` assigned it when it was drawn ("Frame 1", …) — nothing in the app
 * exposes a way to rename it (no double click, no panel field, no engine call; a frame is
 * not in `is_bindable_element`, so even Enter-to-edit refuses a selected one) — so a real
 * heading is what actually reads as the section's name on the board and in its preview.
 *
 * Three placement rules keep that heading legible rather than merely present:
 *
 * - a free text is created centred on the click, not started from it — `text_creation_
 *   point` lifts it half a line above the pointer (`engine/text.rs`) — so a heading
 *   clicked within half a line of its frame's top border ends up drawn *above* that
 *   border, outside the frame it was meant to join, and never gets its `frameId` at all.
 *   `HEADING_CLICK` sits well clear of that.
 * - `GAP`, the space *between* frames, is wide enough that an arrow crossing it lands its
 *   label in the open gap, clear of both frames' own content.
 * - the heading itself sits at the frame's *right* edge (`HEADING_RIGHT_INSET`), not its
 *   left, because every shape here is drawn toward the left — an arrow landing on the one
 *   below bound to the heading instead of its target: a free text is a valid arrow target
 *   in its own right (`binding.rs::is_target_kind`), and the servicesHeading sat exactly
 *   where the web→auth arrow's own approach point landed.
 */

const HEADING_CLICK = 20;
const HEADING_RIGHT_INSET = 120;
const CONTENT_TOP = 40;
const GAP = 50;
const CLIENTS = { x: OPEN_CANVAS.left + 20, y: OPEN_CANVAS.top + 10, w: 680, h: 110 };
const SERVICES = {
  x: OPEN_CANVAS.left + 20,
  y: CLIENTS.y + CLIENTS.h + GAP,
  w: 680,
  h: 130,
};
const DATA = {
  x: OPEN_CANVAS.left + 20,
  y: SERVICES.y + SERVICES.h + GAP,
  w: 680,
  h: 120,
};

/** Clicks a shape's outline at the mid-height of its left or right edge — clear of every
 *  arrow bound to it here, which all meet a shape at its top, bottom or the opposite
 *  side. `clickElement`'s own rule: transparent fill, so the outline is what is hit. */
async function clickSide(
  board: Board,
  el: SceneElement,
  side: "left" | "right",
  shift: boolean,
): Promise<void> {
  const at = await worldToCanvas(
    board,
    side === "left" ? el.x : el.x + el.width,
    el.y + el.height / 2,
  );
  if (shift) await board.page.keyboard.down("Shift");
  await board.page.mouse.click(board.box.x + at.x, board.box.y + at.y);
  if (shift) await board.page.keyboard.up("Shift");
}

test("system architecture: three frames, services, a database, clients, and a shared preset", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const slug = "architecture";
  const board = await openBoard(page, slug);

  const clientsFrame = await placeFrame(
    board,
    { x: CLIENTS.x, y: CLIENTS.y },
    { w: CLIENTS.w, h: CLIENTS.h },
  );
  const servicesFrame = await placeFrame(
    board,
    { x: SERVICES.x, y: SERVICES.y },
    { w: SERVICES.w, h: SERVICES.h },
  );
  const dataFrame = await placeFrame(board, { x: DATA.x, y: DATA.y }, { w: DATA.w, h: DATA.h });

  const clientsHeading = await writeText(
    board,
    { x: CLIENTS.x + CLIENTS.w - HEADING_RIGHT_INSET, y: CLIENTS.y + HEADING_CLICK },
    "Clients",
  );
  const servicesHeading = await writeText(
    board,
    { x: SERVICES.x + SERVICES.w - HEADING_RIGHT_INSET, y: SERVICES.y + HEADING_CLICK },
    "Services",
  );
  const dataHeading = await writeText(
    board,
    { x: DATA.x + DATA.w - HEADING_RIGHT_INSET, y: DATA.y + HEADING_CLICK },
    "Data",
  );

  const web = await placeShapeAt(
    board,
    "Ellipse",
    { x: CLIENTS.x + 20, y: CLIENTS.y + CONTENT_TOP },
    { w: 90, h: 55 },
    "Web",
  );
  // Wide enough that "Mobile" wraps on no boundary at all — an ellipse's usable width
  // for its label is narrower than its box, and 90 wrapped it onto two lines.
  const mobile = await placeShapeAt(
    board,
    "Ellipse",
    { x: CLIENTS.x + 200, y: CLIENTS.y + CONTENT_TOP },
    { w: 130, h: 55 },
    "Mobile",
  );

  // 130 wide, not 100: "Orders" is one hard word with no space to wrap on, and at 100 a
  // hexagon's narrower usable width broke it mid-word on a fresh reload's own layout
  // pass, even though the width the shape was first drawn at let it stay whole.
  const auth = await placeFigureAt(
    board,
    "Polygon",
    { x: SERVICES.x + 20, y: SERVICES.y + CONTENT_TOP },
    { w: 130, h: 70 },
    "Auth",
  );
  const orders = await placeFigureAt(
    board,
    "Polygon",
    { x: SERVICES.x + 220, y: SERVICES.y + CONTENT_TOP },
    { w: 130, h: 70 },
    "Orders",
  );
  expect(auth.figure, "the default figure is a hexagon").toMatchObject({
    kind: "polygon",
    sides: 6,
  });

  const db = await placeFigureAt(
    board,
    "Cylinder",
    { x: DATA.x + 20, y: DATA.y + CONTENT_TOP },
    { w: 100, h: 70 },
    "DB",
  );

  const webToAuth = await connect(board, web, auth);
  await labelArrow(board, webToAuth, "signs in");
  const mobileToOrders = await connect(board, mobile, orders);
  await labelArrow(board, mobileToOrders, "places order");
  const authToOrders = await connect(board, auth, orders);
  await labelArrow(board, authToOrders, "verifies");
  const ordersToDb = await connect(board, orders, db);
  await labelArrow(board, ordersToDb, "persists");

  // One style preset, applied to both services at once: a plain click selects Auth, a
  // shift-click adds Orders — each on the one side of its hexagon no arrow meets, since
  // every arrow bound here lands on a shape's top, bottom or the side facing the other
  // service, and a click there would hit the line instead of the shape it is bound to.
  // A marquee over just the two of them is not an option either: "Orders" grows its
  // hexagon a little taller than "Auth" does (`container_dimension_for_bound_text`'s
  // per-shape fit), and any box enclosing both shapes necessarily encloses the arrow
  // between them too, so it would select three elements, not two.
  await focusBoard(board);
  await clickSide(board, auth, "left", false);
  await clickSide(board, orders, "right", true);
  await expect
    .poll(async () => (await page.evaluate(() => window.__drawEngine!.getSelection())).sort())
    .toEqual([auth.id, orders.id].sort());
  await presetButton(page, "Blueprint").click();
  await focusBoard(board);

  const built = await sceneElements(page);
  const counts: Record<string, number> = {};
  for (const element of built) counts[element.type] = (counts[element.type] ?? 0) + 1;
  expect(counts["frame"]).toBe(3);
  expect(counts["ellipse"]).toBe(2);
  expect(counts["figure"]).toBe(3);
  expect(counts["arrow"]).toBe(4);
  expect(counts["text"]).toBe(12); // 5 shape labels + 4 arrow labels + 3 frame headings

  expectArrowBound(webToAuth, web.id, auth.id);
  expectArrowBound(mobileToOrders, mobile.id, orders.id);
  expectArrowBound(authToOrders, auth.id, orders.id);
  expectArrowBound(ordersToDb, orders.id, db.id);

  expectLabelBound(built, web.id, "Web");
  expectLabelBound(built, mobile.id, "Mobile");
  expectLabelBound(built, auth.id, "Auth");
  expectLabelBound(built, orders.id, "Orders");
  expectLabelBound(built, db.id, "DB");
  expect(labelOf(built, webToAuth.id).text).toBe("signs in");
  expect(labelOf(built, mobileToOrders.id).text).toBe("places order");
  expect(labelOf(built, authToOrders.id).text).toBe("verifies");
  expect(labelOf(built, ordersToDb.id).text).toBe("persists");

  // Frame membership: each shape belongs to the frame it was drawn inside.
  const byId = new Map(built.map((element) => [element.id, element]));
  expect(byId.get(web.id)?.frameId).toBe(clientsFrame.id);
  expect(byId.get(mobile.id)?.frameId).toBe(clientsFrame.id);
  expect(byId.get(auth.id)?.frameId).toBe(servicesFrame.id);
  expect(byId.get(orders.id)?.frameId).toBe(servicesFrame.id);
  expect(byId.get(db.id)?.frameId).toBe(dataFrame.id);
  expect(byId.get(clientsHeading.id)?.frameId, "the Clients heading is in its frame").toBe(
    clientsFrame.id,
  );
  expect(byId.get(servicesHeading.id)?.frameId, "the Services heading is in its frame").toBe(
    servicesFrame.id,
  );
  expect(byId.get(dataHeading.id)?.frameId, "the Data heading is in its frame").toBe(dataFrame.id);

  // The preset restyled both services, not just the one clicked last.
  const styledAuth = byId.get(auth.id)!;
  const styledOrders = byId.get(orders.id)!;
  expect(styledAuth.strokeColor).toBe("#1971c2");
  expect(styledOrders.strokeColor).toBe("#1971c2");

  await maybeWriteTemplate(board, "architecture");

  // Save → reload.
  const saved = await waitForAutosave(board);
  expectSceneMatches(built, saved.values(), "the saved scene matches what was drawn");
  const reopened = await reopenWith(board, slug, saved);
  expectSceneMatches(
    await sceneElements(reopened.page),
    saved.values(),
    "the reload matches the save",
  );

  // Export.
  await exportPngAndSvg(board);
});
