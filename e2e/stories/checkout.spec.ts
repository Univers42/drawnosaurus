import { expect, test } from "../fixtures.ts";
import {
  OPEN_CANVAS,
  connect,
  expectArrowBound,
  expectLabelBound,
  expectSceneMatches,
  exportPngAndSvg,
  focusBoard,
  growNode,
  insertLabeledRectangle,
  labelArrow,
  labelOf,
  openBoard,
  placeFigureAt,
  reopenWith,
  sceneElements,
  waitForAutosave,
} from "./helpers.ts";

/**
 * Story 1 — checkout flow, built keyboard-first: the command palette starts it, Ctrl+Right
 * grows the linear steps, a digit picks the decision diamond, and the two outcomes are a
 * figure each, bound and labelled. See `flowchart.spec.ts` (the keys this drives) and
 * `figure.spec.ts` (the Shapes tool this places Receipt/Orders DB with).
 */

test("checkout flow: cart, address, payment, a decision, and its two outcomes", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const slug = "checkout";
  const board = await openBoard(page, slug);
  await focusBoard(board);

  // Keyboard-first: the palette starts it, Ctrl+Right walks the linear steps.
  const cart = await insertLabeledRectangle(board, "Cart");
  const { node: address, arrow: cartToAddress } = await growNode(board, "ArrowRight", "Address");
  const { node: payment, arrow: addressToPayment } = await growNode(board, "ArrowRight", "Payment");
  const { node: paid, arrow: paymentToPaid } = await growNode(board, "ArrowRight", "Paid?", "2");
  expect(paid.type, "the decision is a diamond").toBe("diamond");

  // The two outcomes: a figure each, placed clear of the flowchart chain (which may have
  // panned the camera on its own reveal — `connect` below reads world positions, not
  // screen ones, so where these land on screen does not matter).
  const receipt = await placeFigureAt(
    board,
    "Document",
    { x: OPEN_CANVAS.left + 40, y: OPEN_CANVAS.bottom - 170 },
    { w: 130, h: 90 },
    "Receipt",
  );
  const ordersDb = await placeFigureAt(
    board,
    "Cylinder",
    { x: OPEN_CANVAS.left + 240, y: OPEN_CANVAS.bottom - 170 },
    { w: 130, h: 90 },
    "Orders DB",
  );

  const paidToReceipt = await connect(board, paid, receipt);
  await labelArrow(board, paidToReceipt, "yes");
  const paidToOrders = await connect(board, paid, ordersDb);
  await labelArrow(board, paidToOrders, "no");

  // Structure: element counts per type, every arrow bound at both ends, every label
  // inside its container.
  const built = await sceneElements(page);
  const counts: Record<string, number> = {};
  for (const element of built) counts[element.type] = (counts[element.type] ?? 0) + 1;
  expect(counts["rectangle"]).toBe(3);
  expect(counts["diamond"]).toBe(1);
  expect(counts["figure"]).toBe(2);
  expect(counts["arrow"]).toBe(5);
  expect(counts["text"]).toBe(8); // 6 node/figure labels + 2 arrow labels

  expectArrowBound(cartToAddress, cart.id, address.id);
  expectArrowBound(addressToPayment, address.id, payment.id);
  expectArrowBound(paymentToPaid, payment.id, paid.id);
  expectArrowBound(paidToReceipt, paid.id, receipt.id);
  expectArrowBound(paidToOrders, paid.id, ordersDb.id);

  expectLabelBound(built, cart.id, "Cart");
  expectLabelBound(built, address.id, "Address");
  expectLabelBound(built, payment.id, "Payment");
  expectLabelBound(built, paid.id, "Paid?");
  expectLabelBound(built, receipt.id, "Receipt");
  expectLabelBound(built, ordersDb.id, "Orders DB");
  expect(labelOf(built, paidToReceipt.id).text).toBe("yes");
  expect(labelOf(built, paidToOrders.id).text).toBe("no");

  // Save → reload: what autosave actually sent, reopened through the real load path.
  const saved = await waitForAutosave(board);
  expectSceneMatches(built, saved.values(), "the saved scene matches what was drawn");
  const reopened = await reopenWith(board, slug, saved);
  expectSceneMatches(
    await sceneElements(reopened.page),
    saved.values(),
    "the reload matches the save",
  );

  // Export: the real dialog, a real PNG and a real SVG.
  await exportPngAndSvg(board);
});
