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
  openBoard,
  placeFigureAt,
  placeFrame,
  placeShapeAt,
  presetButton,
  reopenWith,
  sceneElements,
  waitForAutosave,
  worldToCanvas,
  type Board,
  type SceneElement,
} from "./helpers.ts";

/**
 * Story 2 — system architecture: three frames stacked top to bottom (Clients, Services,
 * Data), the shapes each holds, bound and labelled arrows between them, and one style
 * preset applied to both services at once. Frame membership is never set by hand — a
 * shape drawn inside an existing frame is judged into it on its own commit
 * (`pointer_end.rs::judge_created_frame_membership`), exactly what this checks.
 */

const CLIENTS = { x: OPEN_CANVAS.left + 20, y: OPEN_CANVAS.top + 20, w: 680, h: 90 };
const SERVICES = { x: OPEN_CANVAS.left + 20, y: OPEN_CANVAS.top + 150, w: 680, h: 110 };
const DATA = { x: OPEN_CANVAS.left + 20, y: OPEN_CANVAS.top + 300, w: 680, h: 90 };

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

  const web = await placeShapeAt(
    board,
    "Ellipse",
    { x: CLIENTS.x + 20, y: CLIENTS.y + 15 },
    { w: 90, h: 55 },
    "Web",
  );
  // Wide enough that "Mobile" wraps on no boundary at all — an ellipse's usable width
  // for its label is narrower than its box, and 90 wrapped it onto two lines.
  const mobile = await placeShapeAt(
    board,
    "Ellipse",
    { x: CLIENTS.x + 200, y: CLIENTS.y + 15 },
    { w: 130, h: 55 },
    "Mobile",
  );

  // 130 wide, not 100: "Orders" is one hard word with no space to wrap on, and at 100 a
  // hexagon's narrower usable width broke it mid-word on a fresh reload's own layout
  // pass, even though the width the shape was first drawn at let it stay whole.
  const auth = await placeFigureAt(
    board,
    "Polygon",
    { x: SERVICES.x + 20, y: SERVICES.y + 20 },
    { w: 130, h: 70 },
    "Auth",
  );
  const orders = await placeFigureAt(
    board,
    "Polygon",
    { x: SERVICES.x + 220, y: SERVICES.y + 20 },
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
    { x: DATA.x + 20, y: DATA.y + 10 },
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
  expect(counts["text"]).toBe(9); // 5 shape labels + 4 arrow labels

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

  // The preset restyled both services, not just the one clicked last.
  const styledAuth = byId.get(auth.id)!;
  const styledOrders = byId.get(orders.id)!;
  expect(styledAuth.strokeColor).toBe("#1971c2");
  expect(styledOrders.strokeColor).toBe("#1971c2");

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
