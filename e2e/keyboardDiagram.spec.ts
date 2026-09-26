import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, sceneElements, selection } from "./board.ts";

/**
 * Keyboard-only diagramming, start to finish, no mouse: the command palette
 * (`docs/reference/palette.md`) inserts a shape at the viewport's centre, and from there
 * the existing flowchart keys (`docs/reference/flowchart.md`) take over. `commandPalette.
 * test.ts` and `ci_insert_shape.rs` pin the pieces separately; this is the one thing only
 * a real browser proves — that closing the palette hands keyboard focus back to the board
 * so the very next keystroke (Enter, Ctrl+Arrow, Alt+Arrow) actually reaches it.
 */

const editor = (page: Page) => page.locator("textarea[aria-label='Text editor']");
const paletteInput = (page: Page) => page.getByRole("combobox", { name: "Command palette" });

test("palette → add rectangle → label it → grow a second node → navigate back", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);

  // The palette owns Ctrl/Cmd+Shift+P now (Present moved to Ctrl/Cmd+Alt+P); Ctrl/Cmd+/
  // is its other chord, both matching the oracle's own toggle
  // (`CommandPalette.tsx@1118751f:145-146`).
  const before = await sceneElements(page);
  await page.keyboard.press("Control+/");
  await expect(paletteInput(page)).toBeFocused();

  // "add rectangle" rather than "rectangle": the latter also matches the Rectangle *tool*
  // command and would run whichever the fuzzy ranking happened to put first.
  await page.keyboard.type("add rectangle");
  await page.keyboard.press("Enter");
  await expect(paletteInput(page)).toHaveCount(0);

  const afterInsert = await sceneElements(page);
  expect(afterInsert).toHaveLength(before.length + 1);
  const nodeA = afterInsert.find((el) => !before.some((b) => b.id === el.id))!;
  expect(nodeA.type).toBe("rectangle");
  expect(await selection(page), "the inserted shape is selected").toEqual([nodeA.id]);

  // Closing the palette must give the board back its keyboard focus, or nothing below
  // this line would ever reach the engine.
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("first");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);

  // Ctrl+Right grows a second, bound node off the one the palette just made.
  const beforeGrow = await sceneElements(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Control");
  const afterGrow = await sceneElements(page);
  expect(afterGrow).toHaveLength(beforeGrow.length + 2); // the node and its arrow
  const nodeB = afterGrow.find(
    (el) => el.type === "rectangle" && !beforeGrow.some((b) => b.id === el.id),
  )!;
  const arrow = afterGrow.find((el) => el.type === "arrow")!;
  expect(await selection(page)).toEqual([nodeB.id]);

  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("second");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);

  // Alt+Left walks back to the node it grew from.
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Alt");
  expect(await selection(page), "navigated back to the first node").toEqual([nodeA.id]);

  // The whole diagram, built without ever touching the mouse: two nodes, one arrow
  // binding them, two labels.
  const final = await sceneElements(page);
  const rectangles = final.filter((el) => el.type === "rectangle");
  const arrows = final.filter((el) => el.type === "arrow");
  const labels = final.filter((el) => el.type === "text");
  expect(rectangles.map((r) => r.id).sort()).toEqual([nodeA.id, nodeB.id].sort());
  expect(arrows).toHaveLength(1);
  expect(arrows[0]!.startBinding).toBe(nodeA.id);
  expect(arrows[0]!.endBinding).toBe(nodeB.id);
  expect(labels).toHaveLength(2);
  expect(labels.map((l) => l.text).sort()).toEqual(["first", "second"]);
  expect(final.find((el) => el.id === nodeA.id)!.boundTextId).toBe(
    labels.find((l) => l.text === "first")!.id,
  );
  expect(final.find((el) => el.id === nodeB.id)!.boundTextId).toBe(
    labels.find((l) => l.text === "second")!.id,
  );
  expect(arrow.id).toBe(arrows[0]!.id);
});
