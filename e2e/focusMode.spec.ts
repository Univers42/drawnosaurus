import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, camera, focusBoard, openBoard, type Board } from "./board.ts";

/**
 * Focus mode: Enter on a selected shape eases the camera in on it; Escape — which already
 * ends the edit, same as the plain editor (`textEditor.ts` › `editorKey`) — eases back. A
 * double-click does not trigger it. `camera.test.ts` pins `focusCamera`'s maths; this is
 * the one thing only a real browser proves — that a genuine keyboard Enter, and not a
 * mouse gesture that opens the identical editor, is what the camera reacts to.
 * `docs/reference/camera.md`.
 */

const editor = (page: Page) => page.locator("textarea[aria-label='Text editor']");

/** The debug handle's `select`, which `board.ts`'s own declaration leaves out. */
interface SelectHandle {
  select(ids: string[]): void;
}

/** A filled rectangle, so both a click in its middle and a double-click hit it — no need
 *  to aim at its outline. */
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
              width: 60,
              height: 40,
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
    },
    { at },
  );
}

test.describe("focus mode", () => {
  test("Enter eases the camera in on the shape; Escape eases back", async ({ page }) => {
    // Deterministic: every eased move lands in one step, so no animation frame to wait out.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const board = await openBoard(page);
    const at = { x: OPEN_CANVAS.left + 60, y: OPEN_CANVAS.top + 60 };
    // Focus before selecting: a click on empty canvas in the select tool clears the
    // selection, so the board must already hold the keyboard focus it needs for Enter.
    await focusBoard(board);
    await placeFilledRectangle(board, at);
    await board.page.evaluate(() =>
      (window.__drawEngine as unknown as SelectHandle).select(["shape"]),
    );

    const before = await camera(page);
    await page.keyboard.press("Enter");
    await expect(editor(page)).toBeFocused();

    const focused = await camera(page);
    expect(focused.scale, "zoomed in on the shape").toBeGreaterThan(before.scale);
    // The shape is centred: its world centre lands on the viewport's screen centre.
    const centre = await board.page.evaluate(() => {
      const engine = window.__drawEngine!;
      const el = JSON.parse(engine.exportJson()).elements[0];
      const { x, y, scale } = engine.camera;
      return { sx: (el.x + el.width / 2) * scale + x, sy: (el.y + el.height / 2) * scale + y };
    });
    expect(centre.sx).toBeCloseTo(board.box.width / 2, 0);
    expect(centre.sy).toBeCloseTo(board.box.height / 2, 0);

    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    const restored = await camera(page);
    expect(restored.x).toBeCloseTo(before.x, 3);
    expect(restored.y).toBeCloseTo(before.y, 3);
    expect(restored.scale).toBeCloseTo(before.scale, 5);
  });

  test("a double-click opens the same editor without moving the camera", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const board = await openBoard(page);
    const at = { x: OPEN_CANVAS.left + 60, y: OPEN_CANVAS.top + 60 };
    await placeFilledRectangle(board, at);

    const before = await camera(page);
    await board.page.mouse.dblclick(board.box.x + at.x + 30, board.box.y + at.y + 20);
    await expect(editor(page)).toBeFocused();

    expect(await camera(page)).toEqual(before);
  });
});
