import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { camera, focusBoard, openBoard, OPEN_CANVAS, waitForCameraStable } from "./board.ts";

/**
 * Right-button drag to pan, and the context menu it used to be incompatible with.
 *
 * A right-button press is a pan only once the pointer has travelled past the drag
 * threshold; let go before that and it is a right-click. The whole design is in the
 * oracle's `AppPan` doc comment (`App.pan.ts@1118751f:12-25`), and the awkward half is the
 * platform: macOS and Linux fire `contextmenu` on mousedown, before anything can know
 * whether the gesture is a click or a drag, and Windows fires it on mouseup. The oracle
 * swallows the event that belongs to a session and opens the menu on the release instead
 * (`App.pan.ts:74-84`, `App.tsx:13225-13246`).
 *
 * So the ordering is the thing under test, and two of these four tests inject it: the
 * browser running this spec decides its own `contextmenu` timing, and a suite that only
 * ever saw one of them would pass with the swallow removed. The synthetic events below
 * are the two platform orderings, dispatched in the order each platform uses.
 */

/** Where on the board to press, clear of the chrome that floats over the canvas. */
const SPOT = {
  x: (OPEN_CANVAS.left + OPEN_CANVAS.right) / 2,
  y: (OPEN_CANVAS.top + OPEN_CANVAS.bottom) / 2,
};

/** The canvas menu, or nothing while it is closed. */
function menu(page: Page) {
  return page.getByRole("menu", { name: "Canvas menu" });
}

/**
 * Dispatch one event on the canvas, as the platform would at this point in the gesture.
 *
 * These are synthetic on purpose: the ordering is what is under test, and the browser
 * running this spec only ever produces one of the two. A synthetic pointer is not a real
 * pointer, so the capture the host asks for on the press is refused by the DOM — harmless
 * here, since what follows is the event order rather than the drag.
 */
async function fireOnCanvas(
  page: Page,
  type: "pointerdown" | "pointerup" | "pointermove" | "contextmenu",
  init: { button?: number; clientX?: number; clientY?: number } = {},
) {
  await page.evaluate(
    ({ type, init }) => {
      const canvas = document.querySelector("canvas")!;
      const at = { clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 };
      if (type === "contextmenu") {
        // A MouseEvent, as the platform sends: the one the host listens for.
        canvas.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, ...at }),
        );
        return;
      }
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: init.button ?? 2,
          buttons: type === "pointerup" ? 0 : 1,
          ...at,
        }),
      );
    },
    { type, init },
  );
}

/** One animation frame, which is the unit the host coalesces pointer moves into. */
async function nextFrame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test.describe("right-button drag to pan", () => {
  test("a right-click opens the menu and moves the board not at all", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    const before = await camera(page);

    await page.mouse.move(SPOT.x, SPOT.y);
    await page.mouse.down({ button: "right" });
    // Inside the threshold, and jittery rather than a clean line: a hand is not a machine.
    for (const step of [1, 2, 1, 0]) {
      await page.mouse.move(SPOT.x + step, SPOT.y + step);
    }
    await page.mouse.up({ button: "right" });

    await expect(menu(page)).toBeVisible();
    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  test("a right-drag pans the board and opens no menu", async ({ page }) => {
    const board = await openBoard(page);
    await focusBoard(board);
    const before = await camera(page);

    // Twenty steps of 10px. The **first** step is the threshold: it is what turns the press
    // into a pan, and it moves nothing, so the board travels the other nineteen
    // (`App.pan.ts:146-148`). The number below is that rule, not a tolerance.
    const STEPS = 20;
    await page.mouse.move(SPOT.x, SPOT.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(SPOT.x + 200, SPOT.y + 200, { steps: STEPS });
    await page.mouse.up({ button: "right" });

    await expect(menu(page)).toHaveCount(0);
    const after = await waitForCameraStable(page);
    expect(after.x).toBeCloseTo(before.x + (STEPS - 1) * 10, 0);
    expect(after.y).toBeCloseTo(before.y + (STEPS - 1) * 10, 0);
  });

  test("a contextmenu with the press opens nothing, and the release opens the menu", async ({
    page,
  }) => {
    // macOS and Linux. The event arrives before the gesture can be known to be a click, so
    // a host that opened the menu here would put it under the pointer and make the drag
    // above impossible.
    const board = await openBoard(page);
    await focusBoard(board);
    const before = await camera(page);

    await fireOnCanvas(page, "pointerdown", { clientX: SPOT.x, clientY: SPOT.y });
    await fireOnCanvas(page, "contextmenu", { clientX: SPOT.x, clientY: SPOT.y });
    await expect(menu(page)).toHaveCount(0);
    await fireOnCanvas(page, "pointerup", { clientX: SPOT.x, clientY: SPOT.y });
    await expect(menu(page)).toBeVisible();

    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x, 5);
  });

  test("a contextmenu with the release opens the menu, and a drag's does not", async ({ page }) => {
    // Windows, both halves. A release that never engaged is an ordinary right-click and
    // the platform's own event opens the menu; a release that turned out to be a drag is
    // not a click, and the event that follows it must be swallowed.
    const board = await openBoard(page);
    await focusBoard(board);

    await fireOnCanvas(page, "pointerdown", { clientX: SPOT.x, clientY: SPOT.y });
    await fireOnCanvas(page, "pointerup", { clientX: SPOT.x, clientY: SPOT.y });
    await fireOnCanvas(page, "contextmenu", { clientX: SPOT.x, clientY: SPOT.y });
    await expect(menu(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);

    const before = await camera(page);
    await fireOnCanvas(page, "pointerdown", { clientX: SPOT.x, clientY: SPOT.y });
    // Two moves in two frames, because the first one only turns the press into a pan:
    // 12px is past the threshold and moves nothing, the 20px after it is the pan. One
    // move would prove nothing about the camera, and two in one frame would be coalesced
    // into the second — the host applies one engine step per frame on purpose.
    await fireOnCanvas(page, "pointermove", { clientX: SPOT.x + 12, clientY: SPOT.y });
    await nextFrame(page);
    await fireOnCanvas(page, "pointermove", { clientX: SPOT.x + 32, clientY: SPOT.y });
    await nextFrame(page);
    await fireOnCanvas(page, "pointerup", { clientX: SPOT.x + 32, clientY: SPOT.y });
    await fireOnCanvas(page, "contextmenu", { clientX: SPOT.x + 32, clientY: SPOT.y });
    await expect(menu(page)).toHaveCount(0);
    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x + 20, 0);
  });

  test("the move that crosses the threshold does not shift the board", async ({ page }) => {
    // `App.pan.ts:146-148`: the pan starts at the crossing, so the distance travelled to
    // reach it is never caught up. Lost, this jumps the board by up to 5px on the first
    // move after — which is why the assertion is on the exact number and not on movement.
    const board = await openBoard(page);
    await focusBoard(board);
    const before = await camera(page);

    await page.mouse.move(SPOT.x, SPOT.y);
    await page.mouse.down({ button: "right" });
    // 3px is inside the threshold, 4 more is past it, 10 more is the pan.
    await page.mouse.move(SPOT.x + 3, SPOT.y);
    await page.mouse.move(SPOT.x + 7, SPOT.y);
    await page.mouse.move(SPOT.x + 17, SPOT.y);
    await page.mouse.up({ button: "right" });

    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x + 10, 0);
  });
});
