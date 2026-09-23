import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  chromaInk,
  clickElement,
  focusBoard,
  OPEN_CANVAS,
  openBoard,
  pickTool,
  regionInk,
  relay,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * Two people on one board: what one of them holds, the other sees and cannot take, and
 * what one of them is moving moves on the other's screen while it moves.
 *
 * Reported drawing together: shapes appeared on the other screen only once let go, and
 * nothing stopped two people taking the same one — one erased a shape the other was
 * moving, and it came back on the other's next edit. See `engine/peers.rs`.
 *
 * Both pages share a room through a relay standing in for the API's live route, with the
 * default camera, so a point on one screen is the same point on the other.
 */

/** Where the box is drawn, canvas-relative: 140 × 90 from here. */
const AT = { x: OPEN_CANVAS.left + 100, y: OPEN_CANVAS.top + 80 };
const around = (x: number, y: number) => ({
  left: x - 10,
  top: y - 10,
  right: x + 150,
  bottom: y + 100,
});

async function together(page: Page, browser: Browser) {
  const live = relay();
  const host = await openBoard(page, "e2e", { live: live.join });
  const hash = new URL(page.url()).hash;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const colleaguePage = await context.newPage();
  // The fixture watches the first page only.
  const thrown: string[] = [];
  colleaguePage.on("pageerror", (error) => thrown.push(error.message));
  const colleague = await openBoard(colleaguePage, "e2e", { live: live.join, hash });
  const close = async () => {
    expect(thrown, "the colleague's page threw").toEqual([]);
    await context.close();
  };
  return { host, colleague, close };
}

async function drawBox(board: Board): Promise<void> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + AT.x, box.y + AT.y);
  await page.mouse.down();
  await page.mouse.move(box.x + AT.x + 140, box.y + AT.y + 90, { steps: 4 });
  await page.mouse.up();
}

test("what one person holds, the other sees in their colour and cannot take", async ({
  page,
  browser,
}) => {
  const { host, colleague, close } = await together(page, browser);
  const other = colleague.page;
  await drawBox(host);
  // A shape just drawn is selected, so the host holds it.
  await expect.poll(async () => (await sceneElements(other)).length).toBe(1);
  expect(await selection(page)).toHaveLength(1);

  await expect
    .poll(() => chromaInk(other, around(AT.x, AT.y)), {
      message: "no outline in the host's colour around what the host holds",
    })
    .toBeGreaterThan(0.01);

  await clickElement(colleague, 0);
  expect(await selection(other), "the colleague took a shape the host holds").toEqual([]);
  await expect(other.getByRole("status")).toContainText("is working on this");

  // The one that was reported: the eraser took it, and the host's next edit brought it
  // back.
  await pickTool(other, "Eraser");
  await other.mouse.move(colleague.box.x + AT.x - 60, colleague.box.y + AT.y + 45);
  await other.mouse.down();
  await other.mouse.move(colleague.box.x + AT.x + 220, colleague.box.y + AT.y + 45, { steps: 6 });
  await other.mouse.up();
  expect(await sceneElements(other), "the eraser took what the host holds").toHaveLength(1);

  // Let go, and it is anyone's.
  await focusBoard(host);
  await expect.poll(() => chromaInk(other, around(AT.x, AT.y))).toBeLessThan(0.002);
  await pickTool(other, "Select");
  await clickElement(colleague, 0);
  expect(await selection(other)).toHaveLength(1);
  await close();
});

test("a shape being moved moves on the other screen before it is let go", async ({
  page,
  browser,
}) => {
  const { host, colleague, close } = await together(page, browser);
  const other = colleague.page;
  await drawBox(host);
  await expect.poll(async () => (await sceneElements(other)).length).toBe(1);
  const [drawn] = await sceneElements(other);
  await focusBoard(host);

  // By its top edge: a shape with no fill is held by its outline.
  const { box } = host;
  await page.mouse.move(box.x + AT.x + 70, box.y + AT.y);
  await page.mouse.down();
  await page.mouse.move(box.x + AT.x + 270, box.y + AT.y + 100, { steps: 8 });

  // Still held down: nothing is committed, and yet it has moved over there — all the
  // way, and out of its old place. Polled as one: a preview in between is on its way
  // there, and frames in this browser can be a second apart.
  const moved = around(AT.x + 200, AT.y + 100);
  await expect
    .poll(
      async () => ({
        there: (await regionInk(other, moved)) > 0.01,
        gone: (await regionInk(other, around(AT.x, AT.y))) < 0.002,
      }),
      { message: "the shape did not move on the other screen" },
    )
    .toEqual({ there: true, gone: true });
  expect((await sceneElements(other))[0]!.x, "a preview, not an edit").toBe(drawn!.x);

  await page.mouse.up();
  await expect
    .poll(async () => (await sceneElements(other))[0]!.x, { message: "the commit did not arrive" })
    .toBeCloseTo(drawn!.x + 200, 0);
  expect(await regionInk(other, moved), "and it stays where it was put").toBeGreaterThan(0.01);
  await close();
});

test("the other person's cursor is where they point, not in the corner", async ({
  page,
  browser,
}) => {
  const { host, colleague, close } = await together(page, browser);
  const other = colleague.page;
  const cursors = other.locator(".cursor-wrapper");
  // Known from their join, but they have pointed nowhere yet.
  await expect(cursors).toHaveCount(0);

  await page.mouse.move(host.box.x + AT.x, host.box.y + AT.y, { steps: 3 });
  await expect(cursors).toHaveCount(1);
  await expect
    .poll(async () => {
      const at = await cursors.first().boundingBox();
      return at && { x: Math.round(at.x - colleague.box.x), y: Math.round(at.y - colleague.box.y) };
    })
    .toEqual({ x: AT.x, y: AT.y });
  await close();
});
