import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  activeTool,
  focusBoard,
  elementKinds,
  openBoard,
  patchedElements,
  pickTool,
  sceneElements,
  selection,
  type Board,
} from "./board.ts";

/**
 * Bucket fill, through a real browser.
 *
 * The geometry is already settled in the motor — 48 tests in
 * `engine/crates/draw-engine/tests/ci_bucket_fill.rs` cover the boundary graph, the face
 * walk, the island keyholes and the z-order. None of that is retested here. What is here
 * is the half those cannot reach: a click on a canvas, an element in the scene, a patch
 * on the wire, and a shape the renderer can actually build. Every bug this feature has
 * had lived in that gap, which is why a green engine suite said it worked.
 *
 * That gap swallowed the next two as well, and they are why the tool read as broken. The
 * region under the click was computed correctly every time; what went wrong was
 * everything around it. The paint could not be *picked up* — a closed filled line was
 * hit-tested along its outline only, so a click in the middle of the paint found nothing
 * and it could not be selected, moved, recoloured or deleted. And the style panel offered
 * nothing at all while the bucket was the active tool, so the colour to paint with could
 * not be chosen and every fill came out the same fallback shade.
 */

/** Corners well inside `OPEN_CANVAS`, so no floating panel eats the gesture. */
const SHAPE = { from: { x: 520, y: 240 }, to: { x: 900, y: 560 } };
const INSIDE = { x: 700, y: 400 };

/** A rectangle drawn by hand, so the fill has a real boundary to find. */
async function drawRectangle(page: Page, board: Board): Promise<void> {
  await pickTool(page, "Rectangle");
  await page.mouse.move(board.box.x + SHAPE.from.x, board.box.y + SHAPE.from.y);
  await page.mouse.down();
  await page.mouse.move(board.box.x + SHAPE.to.x, board.box.y + SHAPE.to.y, { steps: 8 });
  await page.mouse.up();
}

/** One bucket click at a point on the board. */
async function fillAt(page: Page, board: Board, at: { x: number; y: number }): Promise<void> {
  await pickTool(page, "Bucket fill");
  await page.mouse.click(board.box.x + at.x, board.box.y + at.y);
}

test.describe("bucket fill", () => {
  test("a click inside a shape paints it, and paints it once", async ({ page }) => {
    // One click is one fill. A duplicate would stack exactly on the original, invisible
    // until you moved one and found another underneath, and would double the scene on
    // every click after that — so it is worth an assertion even though it holds today.
    const board = await openBoard(page);
    await drawRectangle(page, board);
    expect(await sceneElements(page)).toHaveLength(1);

    await fillAt(page, board, INSIDE);

    expect(await sceneElements(page)).toHaveLength(2);
    // The fill is a closed line, and it goes under the outline it came from rather than
    // over it — paint belongs behind the stroke that bounds it.
    expect(await elementKinds(page)).toEqual(["line", "rectangle"]);
  });

  test("the paint that appears on screen is also sent to the server", async ({ page }) => {
    // The bug that made this feature unusable: the fill existed in the engine and showed
    // on the canvas, but never reached the API, so it was gone on the next load. The
    // engine did all its work inside `begin_pointer` and never reached the `end_pointer`
    // that flushes.
    const board = await openBoard(page);
    await drawRectangle(page, board);

    await fillAt(page, board, INSIDE);

    // The autosaver debounces, so wait for the patch rather than for a duration.
    await expect
      .poll(async () => (await patchedElements(page)).filter((el) => el.type === "line").length, {
        message: "no patch carrying the fill ever reached the API",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  });

  test("a click on bare canvas paints nothing", async ({ page }) => {
    // There is no region to fill, and the failure has to be quiet: an error, a marquee or
    // a stray element would all be worse than nothing happening.
    const board = await openBoard(page);
    await drawRectangle(page, board);

    await fillAt(page, board, { x: 1100, y: 620 });

    expect(await sceneElements(page)).toHaveLength(1);
  });

  test("filling the same region twice does not stack paint", async ({ page }) => {
    // Clicking an already-filled region should restyle the fill that is there, not lay a
    // second one on top of it — otherwise a board grows an invisible pile of identical
    // polygons every time someone taps the bucket.
    //
    // This one found a crash rather than a duplicate. The restyle path assigned the raw
    // current fill style, which is hachure by default, and a pattern-filled curve is the
    // one shape rough had no implementation for — so the second click aborted the WASM
    // module and the board stopped responding entirely. Four more clicks here than feels
    // necessary, because the fourth is the one that used to catch it.
    const board = await openBoard(page);
    await drawRectangle(page, board);

    for (let click = 0; click < 4; click += 1) {
      await fillAt(page, board, { x: INSIDE.x - click * 12, y: INSIDE.y + click * 12 });
      expect(await sceneElements(page), `after click ${click + 1}`).toHaveLength(2);
    }
  });

  test("the paint can be selected, moved and deleted like anything else", async ({ page }) => {
    // The failure a person actually met. The fill appeared and was then inert: clicking
    // it selected nothing, so it could not be moved, recoloured or removed, and the only
    // way out was undo. A closed line carrying a background is a polygon and a polygon is
    // solid — `shouldTestInside`, `packages/element/src/collision.ts:82-102`.
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await fillAt(page, board, INSIDE);

    await pickTool(page, "Select");
    await page.mouse.click(board.box.x + INSIDE.x, board.box.y + INSIDE.y);
    const picked = await selection(page);
    expect(picked, "a click in the middle of the paint must select the paint").toHaveLength(1);

    const before = (await sceneElements(page)).find((el) => el.id === picked[0])!;
    await page.mouse.move(board.box.x + INSIDE.x, board.box.y + INSIDE.y);
    await page.mouse.down();
    await page.mouse.move(board.box.x + INSIDE.x + 60, board.box.y + INSIDE.y + 40, { steps: 6 });
    await page.mouse.up();
    const after = (await sceneElements(page)).find((el) => el.id === picked[0])!;
    expect(after.x).toBeCloseTo(before.x + 60, 0);
    expect(after.y).toBeCloseTo(before.y + 40, 0);

    await page.keyboard.press("Delete");
    expect(await elementKinds(page)).toEqual(["rectangle"]);
  });

  test("the fill declares the size of the region it covers", async ({ page }) => {
    // The engine derives a point-based element's box from its points and so never
    // noticed these two numbers were zero. Everything that cannot see the points has
    // only these to go on — and the API has no WASM, so its bounds mirror read every
    // fill as a zero-area box and framed board thumbnails on it.
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await fillAt(page, board, INSIDE);

    const paint = (await sceneElements(page)).find((el) => el.type === "line")!;
    expect(paint.width).toBeGreaterThan(0);
    expect(paint.height).toBeGreaterThan(0);

    // And it is the extent of the ring, not merely some non-zero number.
    const xs = paint.points!.map((p) => p[0]);
    const ys = paint.points!.map((p) => p[1]);
    expect(paint.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 6);
    expect(paint.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 6);
  });

  test("the bucket offers a colour to paint with, and paints with it", async ({ page }) => {
    // `bucketfill` was in no capability predicate, so every control came back false and
    // the panel rendered as an empty box. There was no way to pick a colour, so every
    // fill was the fallback — and a second click restyled it to that same fallback,
    // which looks exactly like a tool that does nothing.
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await pickTool(page, "Bucket fill");

    const panel = page.getByRole("complementary", { name: "Style inspector" });
    await expect(panel, "the panel has to be there before a colour can be chosen").toBeVisible();
    // Exactly the controls paint has a use for. A stroke width for something with no
    // stroke would be a control that changes nothing.
    await expect(panel.getByRole("button", { name: "#ffc9c9" })).toBeVisible();
    await expect(panel.getByText("Width", { exact: true })).toHaveCount(0);

    await panel.getByRole("button", { name: "#ffc9c9" }).click();
    await page.mouse.click(board.box.x + INSIDE.x, board.box.y + INSIDE.y);

    const paint = (await sceneElements(page)).find((el) => el.type === "line");
    expect(paint?.backgroundColor).toBe("#ffc9c9");
  });

  test("a second click in a painted region recolours it", async ({ page }) => {
    // The other half of the same bug: with no way to change the colour, the restyle path
    // repainted the fill the shade it already was, so clicking a filled region did
    // nothing visible at all.
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await fillAt(page, board, INSIDE);
    const first = (await sceneElements(page)).find((el) => el.type === "line")!;

    const panel = page.getByRole("complementary", { name: "Style inspector" });
    await panel.getByRole("button", { name: "#ffec99" }).click();
    await page.mouse.click(board.box.x + INSIDE.x - 10, board.box.y + INSIDE.y + 10);

    const after = (await sceneElements(page)).filter((el) => el.type === "line");
    expect(after, "recoloured in place, not stacked").toHaveLength(1);
    expect(after[0]!.id, "the same element").toBe(first.id);
    expect(after[0]!.backgroundColor).toBe("#ffec99");
  });

  test("nothing is left selected, so regions can be painted one after another", async ({
    page,
  }) => {
    // The tool stays active on purpose. A selection left on the last fill puts handles
    // over the paint and takes the next Delete. Excalidraw leaves nothing selected for
    // the same reason (`App.bucketFill.ts:281-284`).
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await fillAt(page, board, INSIDE);

    expect(await selection(page)).toEqual([]);
    expect(await activeTool(page)).toBe("bucketfill");
  });

  test("a click that finds no region says so, and a click on nothing stays quiet", async ({
    page,
  }) => {
    // The five failure variants existed from the start, with a note that "an open region
    // is worth a word to the person clicking" — and the word was never said, because the
    // pointer path discarded the `Result`. A click that found no region did nothing at
    // all, which for anyone who does not already know a region must be enclosed by
    // *visible* strokes is indistinguishable from a tool that is broken.
    const board = await openBoard(page);
    await drawRectangle(page, board);
    await pickTool(page, "Bucket fill");

    const status = page.getByRole("status");

    // Bare canvas is deliberately silent: aiming at empty space is not a mistake worth
    // interrupting someone over. Excalidraw draws the line in the same place.
    await page.mouse.click(board.box.x + 1100, board.box.y + 620);
    await expect(status).toHaveCount(0);

    // A shape that *is* under the pointer and still refuses is the other case, and the
    // one where silence reads as a bug. A one-pixel box is the smallest way to say
    // "there is an owner here, and there is no region" — it is below the minimum area a
    // fill may have. Placed through the engine because it is too small to draw by hand.
    await page.evaluate(() => {
      const engine = window.__drawEngine!;
      const file = JSON.parse(engine.exportJson()) as { elements: unknown[] };
      file.elements.push({
        id: "tiny",
        type: "rectangle",
        x: 300,
        y: 300,
        width: 1,
        height: 1,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
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
      });
      engine.loadScene(JSON.stringify(file));
    });
    const at = await page.evaluate(() => {
      const { x, y, scale } = window.__drawEngine!.camera;
      return { x: 300.5 * scale + x, y: 300.5 * scale + y };
    });
    await page.mouse.click(board.box.x + at.x, board.box.y + at.y);

    await expect(status).toHaveText("Couldn't find an enclosed region to fill here.");
  });
});

test.describe("the paint behaves like a shape", () => {
  /**
   * A bucket fill is a closed `line`, and a line used to be grabbed by its points
   * whatever it had — so selecting the paint produced a circle on every vertex of the
   * region and no bounding box at all. It could not be resized, could not be turned, and
   * the circles dragged single corners of the paint away from the outline it was traced
   * from. Those are the "circles around the perimeter that do nothing useful".
   *
   * Excalidraw's rule is a count, not a kind: a linear element gets a bounding box when
   * `points.length > 2` (`transformHandles.ts:352`), and the point circles appear only
   * while the line editor is open or the line has exactly two points
   * (`interactiveScene.ts:1256`).
   */
  async function fillARectangle(page: Page, board: Board) {
    await drawRectangle(page, board);
    await fillAt(page, board, INSIDE);
    await pickTool(page, "Select");
    await page.mouse.click(board.box.x + INSIDE.x, board.box.y + INSIDE.y);
  }

  /** The paint, and the corner handle that resizes it — eight pixels beyond its box. */
  async function paintAndHandle(page: Page) {
    const paint = (await sceneElements(page)).find((el) => el.type === "line")!;
    return { paint, handle: { x: paint.x + paint.width + 8, y: paint.y + paint.height + 8 } };
  }

  test("the paint can be resized, and its ring keeps up with its box", async ({ page }) => {
    const board = await openBoard(page);
    await fillARectangle(page, board);
    const { paint, handle } = await paintAndHandle(page);

    // A real drag, in steps. One long jump cannot see the bug this catches: the scale
    // was taken from the live ring, so every move after the first divided by a span an
    // earlier move had already stretched, and the paint drifted out from under its box.
    await page.mouse.move(board.box.x + handle.x, board.box.y + handle.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(
        board.box.x + handle.x + (90 * step) / 6,
        board.box.y + handle.y + (70 * step) / 6,
      );
    }
    await page.mouse.up();

    const after = (await sceneElements(page)).find((el) => el.type === "line")!;
    expect(after.width).toBeGreaterThan(paint.width + 50);

    const xs = after.points!.map((p) => p[0]);
    const ys = after.points!.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(after.width, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(after.height, 6);
  });

  test("the paint can be turned", async ({ page }) => {
    const board = await openBoard(page);
    await fillARectangle(page, board);
    const paint = (await sceneElements(page)).find((el) => el.type === "line")!;

    // The rotation handle sits above the top edge, past the frame and the handle ring.
    const at = { x: paint.x + paint.width / 2, y: paint.y - 34 };
    await page.mouse.move(board.box.x + at.x, board.box.y + at.y);
    await page.mouse.down();
    await page.mouse.move(board.box.x + at.x + 90, board.box.y + at.y + 70, { steps: 6 });
    await page.mouse.up();

    const after = (await sceneElements(page)).find((el) => el.type === "line")!;
    expect(Math.abs(after.angle ?? 0)).toBeGreaterThan(0.05);
  });

  test("its corners are still there, behind a double click", async ({ page }) => {
    // The points are not taken away, only moved out of the common gesture's way — the
    // same door Excalidraw puts its line editor behind.
    const board = await openBoard(page);
    await fillARectangle(page, board);
    const before = (await sceneElements(page)).find((el) => el.type === "line")!;

    await page.mouse.dblclick(board.box.x + INSIDE.x, board.box.y + INSIDE.y);
    const corner = { x: before.x + before.points![1]![0], y: before.y + before.points![1]![1] };
    await page.mouse.move(board.box.x + corner.x, board.box.y + corner.y);
    await page.mouse.down();
    await page.mouse.move(board.box.x + corner.x + 60, board.box.y + corner.y - 40, { steps: 5 });
    await page.mouse.up();

    const after = (await sceneElements(page)).find((el) => el.type === "line")!;
    expect(after.points![1]).not.toEqual(before.points![1]);
  });
});

test.describe("what the paint belongs to", () => {
  /**
   * A fill is its own element and nothing links it back to the shape it was traced from.
   * That is the design — a region is frequently not a shape at all, so most regions
   * cannot be expressed as any element's background, and moving the shape leaves the
   * paint behind.
   *
   * Frame and group are the two exceptions, and they are membership rather than a link:
   * the paint joins whatever its region already belonged to. They are the only places a
   * fill travels with what it was painted inside, and without them paint inside a frame
   * is abandoned the moment the frame moves.
   */
  test("paint joins its owner's group, and moves when the group moves", async ({ page }) => {
    const board = await openBoard(page);
    await drawRectangle(page, board);
    // A second shape, so the group is a real one rather than a group of one.
    await pickTool(page, "Rectangle");
    await page.mouse.move(board.box.x + 950, board.box.y + 240);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1100, board.box.y + 380, { steps: 6 });
    await page.mouse.up();

    await pickTool(page, "Select");
    await focusBoard(board);
    await page.keyboard.press("Control+a");
    await page.evaluate(() => window.__drawEngine!.groupSelection());

    await fillAt(page, board, INSIDE);
    const paint = (await sceneElements(page)).find((el) => el.type === "line")!;
    const shape = (await sceneElements(page)).find((el) => el.type === "rectangle")!;
    expect(paint.groupId, "the paint is in the same group as the region it fills").toBe(
      shape.groupId,
    );
    expect(paint.groupId).toBeTruthy();

    // Dragging the *other* member of the group must carry the paint along with it.
    await pickTool(page, "Select");
    await page.mouse.move(board.box.x + 1025, board.box.y + 240);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1055, board.box.y + 280, { steps: 6 });
    await page.mouse.up();

    const moved = (await sceneElements(page)).find((el) => el.id === paint.id)!;
    expect(moved.x).toBeCloseTo(paint.x + 30, 0);
    expect(moved.y).toBeCloseTo(paint.y + 40, 0);
  });
});
