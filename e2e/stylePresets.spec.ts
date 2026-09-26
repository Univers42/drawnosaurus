import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, focusBoard, openBoard, sceneElements, type Board } from "./board.ts";

/**
 * Style presets (`docs/reference/stylePresets.md`): applying one restyles the selection as
 * one step of undo, through the panel's existing `onApply` path
 * (`stylePresets.test.ts` pins the data; this is the one thing only a real browser
 * proves — that clicking a preset chip actually reaches the engine and that undo takes it
 * back in one step, not one per field it touched).
 */

/** The debug handle's `select`, which `board.ts`'s own declaration leaves out. */
interface SelectHandle {
  select(ids: string[]): void;
}

async function placeFilledRectangle(board: Board, at: { x: number; y: number }): Promise<void> {
  await board.page.evaluate(
    ({ at }) => {
      const engine = window.__drawEngine!;
      const world = engine.screenToWorld(at.x, at.y);
      engine.loadScene(
        JSON.stringify({
          type: "osidraw",
          version: 1,
          source: "e2e",
          elements: [
            {
              id: "shape",
              type: "rectangle",
              x: world.x,
              y: world.y,
              width: 80,
              height: 60,
              angle: 0,
              strokeColor: "#1e1e1e",
              backgroundColor: "#a5d8ff",
              fillStyle: "solid",
              strokeWidth: 2,
              strokeStyle: "solid",
              roughness: 0,
              opacity: 100,
              roundness: null,
              seed: 1,
              version: 1,
              versionNonce: 1,
              updated: 0,
              isDeleted: false,
            },
          ],
        }),
      );
      (engine as unknown as SelectHandle).select(["shape"]);
    },
    { at },
  );
}

test("applying a built-in preset restyles the selection in one undo step", async ({ page }) => {
  const board = await openBoard(page);
  const at = { x: OPEN_CANVAS.left + 80, y: OPEN_CANVAS.top + 80 };
  await focusBoard(board);
  await placeFilledRectangle(board, at);

  const before = (await sceneElements(page)).find((el) => el.id === "shape")!;
  expect(before.strokeColor).toBe("#1e1e1e");

  await page.getByRole("button", { name: "Blueprint" }).click();

  const styled = (await sceneElements(page)).find((el) => el.id === "shape")!;
  expect(styled.strokeColor).toBe("#1971c2");
  expect(styled.backgroundColor).toBe("transparent");
  expect(styled.roughness).toBe(0);

  // One undo removes the whole restyle, not one field of it. The preset chip is a button;
  // clicking it left focus there, and the engine's own keydown listener is bound to the
  // board container (not the window), so undo needs focus back on the board first
  // (`keyboardDiagram.spec.ts` hits the same requirement after the command palette closes).
  await focusBoard(board);
  await page.keyboard.press("Control+z");
  const reverted = (await sceneElements(page)).find((el) => el.id === "shape")!;
  expect(reverted.strokeColor).toBe(before.strokeColor);
  expect(reverted.backgroundColor).toBe(before.backgroundColor);
});
