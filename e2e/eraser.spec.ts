import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { focusBoard, openBoard, pickTool, sceneElements, type Board } from "./board.ts";

/**
 * The eraser, through a real browser — where the bug was visible and the engine's own
 * tests could not see it.
 *
 * The engine coalesces nothing; the *host* does. `pointerInput.ts` collapses pointer
 * moves to one per animation frame, so a sweep that felt continuous to the hand reaches
 * the engine as a handful of samples tens of pixels apart. An eraser that tested those
 * samples stepped over everything between them, which is what "it jumps through elements
 * and you have to pass again and again" describes. Only a test that moves a real mouse at
 * a real speed produces that gap.
 */

/** Draws `count` rectangles in a row. The tool reverts after each, so it is re-picked. */
async function drawRow(page: Page, board: Board, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await pickTool(page, "Rectangle");
    const x = 460 + i * 110;
    await page.mouse.move(board.box.x + x, board.box.y + 300);
    await page.mouse.down();
    await page.mouse.move(board.box.x + x + 70, board.box.y + 380, { steps: 4 });
    await page.mouse.up();
  }
}

test.describe("eraser", () => {
  test("one fast sweep clears the row it crosses", async ({ page }) => {
    // Six shapes, one drag, two mouse samples. The host has a frame between them, so the
    // engine sees a jump of six hundred pixels — every shape in the row is inside it.
    const board = await openBoard(page);
    await drawRow(page, board, 6);
    expect(await sceneElements(page)).toHaveLength(6);

    await pickTool(page, "Eraser");
    await page.mouse.move(board.box.x + 440, board.box.y + 340);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1150, board.box.y + 340);
    await page.mouse.up();

    expect(
      await sceneElements(page),
      "a single sweep left shapes behind — it stepped between samples",
    ).toHaveLength(0);
  });

  test("one pass clears a run of duplicates", async ({ page }) => {
    // The reported case: hold Ctrl+D, then try to erase what it made. An eraser that takes
    // the topmost element and stops needs one pass per copy, and each pass looks like it
    // did nothing.
    //
    // Ctrl+D offsets each copy by +12,+12, so the copies are a diagonal staircase rather
    // than a single pile — and the stroke below is the diagonal through their corners, so
    // it crosses every one of their outlines. (A transparent shape is erased by its
    // outline, the same rule that governs selecting one.)
    const board = await openBoard(page);
    const origin = { x: 600, y: 280 };
    const step = 12;
    const copies = 10;

    await pickTool(page, "Rectangle");
    await page.mouse.move(board.box.x + origin.x, board.box.y + origin.y);
    await page.mouse.down();
    await page.mouse.move(board.box.x + origin.x + 200, board.box.y + origin.y + 140, {
      steps: 4,
    });
    await page.mouse.up();
    await focusBoard(board);

    await pickTool(page, "Select");
    await page.mouse.click(board.box.x + origin.x + 100, board.box.y + origin.y);
    for (let i = 0; i < copies; i += 1) {
      await page.keyboard.press("Control+d");
    }
    expect(await sceneElements(page)).toHaveLength(copies + 1);

    await pickTool(page, "Eraser");
    // Starts before the first corner and ends past the last, on the line every corner
    // sits on: corner i is at (origin + i·step, origin + i·step).
    await page.mouse.move(board.box.x + origin.x - 10, board.box.y + origin.y - 10);
    await page.mouse.down();
    await page.mouse.move(
      board.box.x + origin.x + copies * step + 10,
      board.box.y + origin.y + copies * step + 10,
    );
    await page.mouse.up();

    expect(await sceneElements(page), "one pass left copies behind").toHaveLength(0);
  });

  test("the sweep is one undo, not one per shape", async ({ page }) => {
    // Erasing six shapes and pressing undo six times to get them back is not undo.
    const board = await openBoard(page);
    await drawRow(page, board, 4);

    await pickTool(page, "Eraser");
    await page.mouse.move(board.box.x + 440, board.box.y + 340);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1000, board.box.y + 340);
    await page.mouse.up();
    expect(await sceneElements(page)).toHaveLength(0);

    await focusBoard(board);
    await page.keyboard.press("Control+z");

    expect(await sceneElements(page)).toHaveLength(4);
  });

  test("the eraser leaves what the sweep missed", async ({ page }) => {
    // So "erase everything" cannot be how the tests above pass.
    const board = await openBoard(page);
    await drawRow(page, board, 3);

    await pickTool(page, "Eraser");
    // Well below the row.
    await page.mouse.move(board.box.x + 440, board.box.y + 600);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1150, board.box.y + 600);
    await page.mouse.up();

    expect(await sceneElements(page)).toHaveLength(3);
  });
});

test.describe("duplicating stays fast", () => {
  test("a long run of Ctrl+D produces every copy", async ({ page }) => {
    // The correctness half of the performance work: whatever the duplicate path does to
    // stay quick, it still has to produce exactly one copy per press. This is also the
    // shape of board the eraser test above relies on.
    const board = await openBoard(page);
    await pickTool(page, "Rectangle");
    await page.mouse.move(board.box.x + 600, board.box.y + 280);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 700, board.box.y + 360, { steps: 4 });
    await page.mouse.up();
    await focusBoard(board);
    await pickTool(page, "Select");
    await page.mouse.click(board.box.x + 650, board.box.y + 280);
    expect(await sceneElements(page)).toHaveLength(1);

    const start = Date.now();
    for (let i = 0; i < 100; i += 1) {
      await page.keyboard.press("Control+d");
    }
    const elapsed = Date.now() - start;

    expect(await sceneElements(page)).toHaveLength(101);
    // Generous, because most of this is Playwright's own key dispatch rather than the
    // engine — the engine's side is measured properly in `benches/editing.rs`. It is here
    // to catch the shape of the old bug: a per-press cost proportional to the board makes
    // a run of them quadratic, and that shows up at any threshold.
    expect(elapsed, `100 duplicates took ${elapsed}ms`).toBeLessThan(15_000);
  });
});

test.describe("big duplicates", () => {
  test("a board of screen-sized copies draws, pans, zooms and erases", async ({ page }) => {
    // The painter's `Path2D` cache is browser-only code, so nothing in the Rust suite
    // touches it — and this change rewrote its key from the element id to the shape
    // fingerprint, so that every copy of a duplicated shape shares one path. The failure
    // mode of a wrong key is a panic or a wrong picture, and the first of those is what
    // this catches: the fixture fails the test on any uncaught page error.
    //
    // It also walks the cache's whole life in one go — cold build, warm reuse across pan
    // and zoom, then eviction as the shapes are erased.
    const board = await openBoard(page);

    await pickTool(page, "Rectangle");
    await page.mouse.move(board.box.x + 450, board.box.y + 180);
    await page.mouse.down();
    await page.mouse.move(board.box.x + 1150, board.box.y + 640, { steps: 6 });
    await page.mouse.up();
    await focusBoard(board);

    await pickTool(page, "Select");
    await page.mouse.click(board.box.x + 800, board.box.y + 180);
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Control+d");
    }
    expect(await sceneElements(page)).toHaveLength(61);

    // Warm the cache across a pan and a zoom — geometry is generated in element-local
    // space, so neither should rebuild anything.
    await page.mouse.move(board.box.x + 700, board.box.y + 400);
    await page.mouse.wheel(40, 60);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");

    // Then take them away, which is what exercises the eviction sweep. The corners are
    // read back through the camera rather than assumed: the pan and zoom above moved
    // every shape on screen, and a sweep aimed at where they were drawn would miss.
    const corners = await page.evaluate(() => {
      const engine = window.__drawEngine!;
      const elements = JSON.parse(engine.exportJson()).elements as {
        x: number;
        y: number;
      }[];
      const { x, y, scale } = engine.camera;
      const at = (element: { x: number; y: number }) => ({
        x: element.x * scale + x,
        y: element.y * scale + y,
      });
      return { first: at(elements[0]!), last: at(elements[elements.length - 1]!) };
    });

    await pickTool(page, "Eraser");
    // Every copy's top-left corner sits on the line between these two, because Ctrl+D
    // offsets each one by the same amount.
    await page.mouse.move(board.box.x + corners.first.x - 8, board.box.y + corners.first.y - 8);
    await page.mouse.down();
    await page.mouse.move(board.box.x + corners.last.x + 8, board.box.y + corners.last.y + 8, {
      steps: 10,
    });
    await page.mouse.up();

    expect(await sceneElements(page)).toHaveLength(0);
  });
});

/**
 * A pile of filled copies, packed a couple of pixels apart — what a run of duplicates
 * nudged into place looks like, and what the report was about.
 *
 * Scene setup rather than behaviour: what is under test is the sweep. Filled, because a
 * filled shape is hit anywhere inside it — which is exactly why the old eraser failed
 * here: it asked for the topmost element under each sample, and the top copy, once
 * marked, answered every sample after, so the copies beneath were never reached.
 */
async function pileOfCopies(page: Page, count: number): Promise<void> {
  await page.evaluate((count) => {
    const engine = window.__drawEngine!;
    const elements = Array.from({ length: count }, (_, i) => {
      const world = engine.screenToWorld(620 + i * 2, 300 + i * 2);
      return {
        id: `copy-${i}`,
        type: "rectangle",
        x: world.x,
        y: world.y,
        width: 200 / engine.camera.scale,
        height: 140 / engine.camera.scale,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "#ffc9c9",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        roundness: null,
        seed: i + 1,
        version: 1,
        versionNonce: i + 1,
        updated: 0,
        isDeleted: false,
      };
    });
    engine.loadScene(JSON.stringify({ type: "osidraw", version: 1, source: "e2e", elements }));
  }, count);
}

/** Canvas-relative: through the middle of the pile, from clear space to clear space. */
const ACROSS_THE_PILE = { from: { x: 560, y: 390 }, to: { x: 960, y: 390 } };

async function sweep(board: Board, done = true): Promise<void> {
  const { page, box } = board;
  await page.mouse.move(box.x + ACROSS_THE_PILE.from.x, box.y + ACROSS_THE_PILE.from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + ACROSS_THE_PILE.to.x, box.y + ACROSS_THE_PILE.to.y, {
    steps: 12,
  });
  if (done) await page.mouse.up();
}

test.describe("erasing a pile of copies", () => {
  test("one sweep takes every copy in the pile", async ({ page }) => {
    const board = await openBoard(page);
    await pileOfCopies(page, 40);
    await pickTool(page, "Eraser");

    await sweep(board);

    const left = await sceneElements(page);
    expect(
      left.map((el) => el.id),
      `${left.length} of 40 copies survived`,
    ).toEqual([]);
  });

  test("the sweep fades what it will take, and deletes nothing until release", async ({ page }) => {
    const board = await openBoard(page);
    // One copy for the colour: faded copies stacked on each other add back up to nearly
    // solid (ten at a fifth each cover 89%), which is the same in Excalidraw.
    await pileOfCopies(page, 1);
    await pickTool(page, "Eraser");
    const middle = { x: 720, y: 370 };
    const strength = () =>
      page.evaluate((at) => {
        const canvas = document.querySelector("canvas")!;
        const scale = canvas.width / canvas.getBoundingClientRect().width;
        const [r, g, b] = canvas
          .getContext("2d")!
          .getImageData(Math.round(at.x * scale), Math.round(at.y * scale), 1, 1).data;
        // How far from white: the pink fill is (255, 201, 201), 108 at full strength.
        return 255 * 3 - (r! + g! + b!);
      }, middle);
    const solid = await strength();

    await sweep(board, false);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__drawEngine!.debugSnapshot().interaction.markedForErasure.length,
        ),
      )
      .toBe(1);
    await page.waitForTimeout(100);
    const faded = await strength();

    expect(await sceneElements(page), "nothing deleted yet").toHaveLength(1);
    expect(solid, "setup: the fill is drawn at full strength").toBeGreaterThan(90);
    // A fifth of the colour, as Excalidraw's ELEMENT_READY_TO_ERASE_OPACITY (20).
    expect(faded, `faded to ${faded} from ${solid}`).toBeGreaterThan(solid * 0.1);
    expect(faded).toBeLessThan(solid * 0.35);

    await page.mouse.up();
    expect(await sceneElements(page)).toHaveLength(0);
  });

  test("Escape mid-sweep keeps everything, at full strength", async ({ page }) => {
    const board = await openBoard(page);
    await pileOfCopies(page, 10);
    await pickTool(page, "Eraser");

    await sweep(board, false);
    await page.keyboard.press("Escape");
    await page.mouse.up();

    const left = await sceneElements(page);
    expect(left).toHaveLength(10);
    expect(left.every((el) => (el as { opacity?: number }).opacity === 100)).toBe(true);
    const marked = await page.evaluate(
      () => window.__drawEngine!.debugSnapshot().interaction.markedForErasure.length,
    );
    expect(marked, "and nothing stays faded").toBe(0);
  });

  test("undo brings the pile back at full strength", async ({ page }) => {
    // The old eraser faded by rewriting each copy's opacity, and undo then restored the
    // faded value: the pile came back see-through.
    const board = await openBoard(page);
    await pileOfCopies(page, 10);
    await pickTool(page, "Eraser");
    await sweep(board);
    expect(await sceneElements(page)).toHaveLength(0);

    await focusBoard(board);
    await page.keyboard.press("Control+z");

    const back = await sceneElements(page);
    expect(back).toHaveLength(10);
    expect(back.map((el) => (el as { opacity?: number }).opacity)).toEqual(Array(10).fill(100));
  });

  test("sweeping back with Alt held keeps what it passes over", async ({ page }) => {
    // Excalidraw's restore. Out and back along the same line: everything is marked on the
    // way out, and un-marked on the way back.
    const board = await openBoard(page);
    await pileOfCopies(page, 10);
    await pickTool(page, "Eraser");
    const { box } = board;

    await sweep(board, false);
    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + ACROSS_THE_PILE.from.x, box.y + ACROSS_THE_PILE.from.y, {
      steps: 12,
    });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    expect(await sceneElements(page)).toHaveLength(10);
  });
});

test.describe("the eraser's fade on screen", () => {
  /** How far from white the canvas is at a canvas-relative point. */
  function strengthAt(page: Page, at: { x: number; y: number }): Promise<number> {
    return page.evaluate((at) => {
      const canvas = document.querySelector("canvas")!;
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const [r, g, b] = canvas
        .getContext("2d")!
        .getImageData(Math.round(at.x * scale), Math.round(at.y * scale), 1, 1).data;
      return 255 * 3 - (r! + g! + b!);
    }, at);
  }

  test("Escape puts the colour back, not only the marks", async ({ page }) => {
    // The marks list can be empty while the painter still shows a faded layer; this
    // reads the pixels.
    const board = await openBoard(page);
    await pileOfCopies(page, 1);
    await pickTool(page, "Eraser");
    const middle = { x: 720, y: 370 };
    const solid = await strengthAt(page, middle);

    await sweep(board, false);
    await expect.poll(() => strengthAt(page, middle)).toBeLessThan(solid * 0.35);
    await page.keyboard.press("Escape");
    await page.mouse.up();

    await expect.poll(() => strengthAt(page, middle)).toBeGreaterThan(solid * 0.9);
  });

  /**
   * A frame's child that sticks out of it is painted inside a clip, and restoring the
   * clip put the canvas alpha back behind the painter's back. The next marked shape
   * found the faded alpha still "set" in the painter's cache and was drawn at full
   * strength.
   */
  test("a marked shape painted after a clipped frame child still fades", async ({ page }) => {
    const board = await openBoard(page);
    await page.evaluate(() => {
      const engine = window.__drawEngine!;
      const { scale } = engine.camera;
      const at = (x: number, y: number) => engine.screenToWorld(x, y);
      const base = {
        angle: 0,
        strokeColor: "#1e1e1e",
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
      };
      const box = (id: string, x: number, y: number, w: number, h: number, extra = {}) => ({
        ...base,
        id,
        type: "rectangle",
        ...at(x, y),
        width: w / scale,
        height: h / scale,
        backgroundColor: "#ffc9c9",
        ...extra,
      });
      const elements = [
        {
          ...box("frame", 600, 250, 300, 200),
          type: "frame",
          backgroundColor: "transparent",
          name: "F",
        },
        // In the frame, and sticking out of its right edge: painted inside a clip.
        box("child", 850, 300, 150, 80, { frameId: "frame" }),
        // Outside the frame, after the child in paint order.
        box("after", 650, 500, 100, 60),
      ];
      engine.loadScene(JSON.stringify({ type: "osidraw", version: 1, source: "e2e", elements }));
    });
    await pickTool(page, "Eraser");
    const { box } = board;
    const after = { x: 700, y: 530 };
    const solid = await strengthAt(page, after);

    // Through the child's outside part, down clear of the frame, then across the shape.
    await page.mouse.move(box.x + 990, box.y + 340);
    await page.mouse.down();
    await page.mouse.move(box.x + 940, box.y + 340, { steps: 4 });
    await page.mouse.move(box.x + 940, box.y + 530, { steps: 6 });
    await page.mouse.move(box.x + 620, box.y + 530, { steps: 8 });
    await expect
      .poll(() =>
        page.evaluate(() => window.__drawEngine!.debugSnapshot().interaction.markedForErasure),
      )
      .toEqual(["after", "child"]);

    await expect
      .poll(() => strengthAt(page, after), { message: "the shape after the clip fades too" })
      .toBeLessThan(solid * 0.35);
    await page.mouse.up();
  });

  test("the trail stops with Escape, though the button is still down", async ({ page }) => {
    const board = await openBoard(page);
    await pileOfCopies(page, 1);
    await pickTool(page, "Eraser");
    const { box } = board;

    await sweep(board, false);
    await expect(page.locator(".eraser-trail-canvas"), "setup: a trail while sweeping").toHaveCount(
      1,
    );
    await page.keyboard.press("Escape");
    // Long enough for what was drawn before Escape to fade out.
    await page.waitForTimeout(400);

    // Sampled after each move, a frame later, and not retried: a trail decays in a
    // fifth of a second, so a waiting assertion would always end up seeing none.
    const seen: number[] = [];
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(box.x + 700, box.y + 400 + step * 30);
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      seen.push(await page.locator(".eraser-trail-canvas").count());
    }
    expect(seen, "no trail drawn after Escape").toEqual([0, 0, 0, 0, 0, 0]);
    await page.mouse.up();
  });
});

test.describe("the pen's eraser end", () => {
  /**
   * A stroke with a pen turned round: pointer button 5, as Excalidraw reads it.
   *
   * Dispatched rather than performed: neither CDP nor Playwright's mouse can press the
   * eraser button — CDP's mouse has left, middle, right, back and forward, and nothing
   * for a pen's other end.
   */
  async function penEraserStroke(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    await page.evaluate(
      ({ from, to }) => {
        const canvas = document.querySelector("canvas")!;
        const box = canvas.getBoundingClientRect();
        const fire = (
          type: string,
          at: { x: number; y: number },
          button: number,
          buttons: number,
        ) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: "pen",
              isPrimary: true,
              clientX: box.left + at.x,
              clientY: box.top + at.y,
              button,
              buttons,
            }),
          );
        fire("pointerdown", from, 5, 32);
        fire("pointermove", to, -1, 32);
        fire("pointerup", to, 5, 0);
      },
      { from, to },
    );
  }

  test("erases what it crosses, and hands back the tool that was in hand", async ({ page }) => {
    await openBoard(page);
    await pileOfCopies(page, 5);
    await pickTool(page, "Rectangle");

    await penEraserStroke(page, ACROSS_THE_PILE.from, ACROSS_THE_PILE.to);

    await expect.poll(async () => (await sceneElements(page)).length).toBe(0);
    expect(await page.evaluate(() => window.__drawEngine!.getTool())).toBe("rectangle");
  });
});
