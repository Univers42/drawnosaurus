import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  camera,
  focusBoard,
  openBoard,
  sceneElements,
  selection,
  type SceneElement,
  type SelectHandle,
} from "./board.ts";

/**
 * Tab's shape switch (`docs/reference/shapeSwitch.md`), as Excalidraw's
 * `ConvertElementTypePopup` behaves: the first Tab opens it under the selection, each Tab
 * after that switches rectangle → diamond → ellipse and Shift+Tab goes back, and the
 * shape keeps its label and its arrows. `ci_shape_convert.rs` pins the switch itself and
 * `shapeSwitch.test.ts` the keys; this proves the board hands them over.
 */

const panel = (page: Page) => page.getByRole("toolbar", { name: "Switch shape" });
const boardElement = (page: Page) => page.locator('.draw-chrome [role="application"]');
const byId = async (page: Page, id: string): Promise<SceneElement> =>
  (await sceneElements(page)).find((element) => element.id === id)!;

/**
 * A rectangle whose own `width` and `height` are negative — the state a resize drag that
 * crosses the anchor leaves behind, loaded straight in because no keyboard gesture here
 * produces one: the engine's Shift+H / Shift+V mirror (`host/keys.ts:233-236`) keeps a
 * *box's* own size positive
 * (`edit/flip.rs`, "Boxes … land on their mirror image with the same width and height"), and
 * `Alt+Arrow` is not a mirror at all — it walks the flowchart
 * (`flowchart.rs:936-940`, "Alt+Arrow: selects the node linked in that direction").
 */
async function placeMirroredRectangle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const engine = window.__drawEngine!;
    engine.loadScene(
      JSON.stringify({
        type: "osidraw",
        version: 1,
        source: "e2e",
        elements: [
          {
            id: "shape",
            type: "rectangle",
            x: 520,
            y: 420,
            width: -300,
            height: -160,
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
  });
}

/** A labelled rectangle and a node grown off it with Ctrl+Right, the first one selected. */
async function labelledPair(page: Page): Promise<{ first: string; arrow: string }> {
  await page.keyboard.press("Control+/");
  await page.keyboard.type("add rectangle");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("hello world");
  await page.keyboard.press("Escape");
  const [first] = await selection(page);
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("Alt+ArrowLeft");
  expect(await selection(page)).toEqual([first]);
  const arrow = (await sceneElements(page)).find((element) => element.type === "arrow")!;
  return { first: first!, arrow: arrow.id };
}

test("Tab opens the switch, then walks the shape round and back, label and arrow kept", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  const { first, arrow } = await labelledPair(page);

  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeVisible();
  expect((await byId(page, first)).type, "the first Tab only opens it").toBe("rectangle");
  await expect(panel(page).getByRole("button", { name: "Rectangle" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const kinds: string[] = [];
  for (const key of ["Tab", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    kinds.push((await byId(page, first)).type);
  }
  expect(kinds).toEqual(["diamond", "ellipse", "diamond"]);
  await expect(panel(page).getByRole("button", { name: "Diamond" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(boardElement(page), "Tab never left the board").toBeFocused();

  const shape = await byId(page, first);
  const label = await byId(page, shape.boundTextId!);
  // What was typed; `text` is its layout, and a diamond's narrower middle may wrap it — as
  // the oracle's switch re-lays a label out in its new shape, by the font's own metrics.
  expect(label.originalText).toBe("hello world");
  expect(label.containerId).toBe(first);
  expect((await byId(page, arrow)).startBinding).toBe(first);

  // Hung under the selection's bottom-left corner.
  const at = (await panel(page).boundingBox())!;
  const view = await camera(page);
  const bottom = (shape.y + shape.height) * view.scale + view.y + board.box.y;
  expect(at.y).toBeGreaterThan(bottom);

  // A click picks a type outright, and each switch is one step of undo.
  await panel(page).getByRole("button", { name: "Ellipse" }).click();
  expect((await byId(page, first)).type).toBe("ellipse");
  await page.keyboard.press("Control+z");
  expect((await byId(page, first)).type).toBe("diamond");

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

// Reported from real use: after Ctrl+Arrow, Tab went to the header instead of the node.
test("right after Ctrl+Arrow grows a node, Tab switches that node's shape", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await page.keyboard.press("Control+/");
  await page.keyboard.type("add rectangle");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+ArrowRight");
  const [grown] = await selection(page);

  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeVisible();
  await expect(boardElement(page), "not the header").toBeFocused();
  await page.keyboard.press("Tab");
  expect((await byId(page, grown!)).type).toBe("diamond");
  await page.keyboard.press("Tab");
  expect((await byId(page, grown!)).type).toBe("ellipse");
  await expect(boardElement(page)).toBeFocused();
});

test("a press on the canvas closes the switch", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await labelledPair(page);
  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeVisible();
  await focusBoard(board);
  await expect(panel(page)).toHaveCount(0);
});

test("with nothing to switch, Tab moves focus on as it does anywhere", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await expect(boardElement(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel(page)).toHaveCount(0);
  await expect(boardElement(page)).not.toBeFocused();
});

// A **mirrored** shape — `width` and `height` under zero, which is what a drag across an
// edge leaves behind. `boundsOf` read `x + width` as its right edge, so the panel hung off
// the shape's own top-right instead of under its bottom-left: the fourth consumer of that
// box, and the one where the box's own top and bottom are both read. `camera.test.ts` pins
// the maths; this is the panel on screen. `docs/reference/camera.md`.
test("a mirrored shape hangs the switch under its bottom-left corner", async ({
  page,
}, testInfo) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeMirroredRectangle(page);
  const [shape] = await sceneElements(page);
  expect(shape!.width, "the shape is mirrored").toBeLessThan(0);
  expect(shape!.height, "…on both axes").toBeLessThan(0);

  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeVisible();

  // Its own corners, not `x + width` and `y + height`, which for a mirrored shape are its
  // top-left.
  const left = Math.min(shape!.x, shape!.x + shape!.width);
  const bottom = Math.max(shape!.y, shape!.y + shape!.height);
  const at = (await panel(page).boundingBox())!;
  const view = await camera(page);
  const screenLeft = left * view.scale + view.x + board.box.x;
  const screenBottom = bottom * view.scale + view.y + board.box.y;
  expect(at.y, "the panel hangs below the shape's bottom edge").toBeGreaterThan(screenBottom);
  expect(at.x, "…and left of its left edge").toBeLessThan(screenLeft);

  await page.screenshot({ path: testInfo.outputPath("mirrored-panel.png") });
});

// ── The linear branch ────────────────────────────────────────────────────────
//
// `LINEAR_TYPES` and the linear half of `convertElementTypes`
// (`ConvertElementTypePopup.tsx@1118751f:113-120`, `:519-639`). The specs above pin the
// closed shapes; these pin lines and arrows, and they assert what *survived* — a spec that
// only read the type back would pass against a switch that dropped the id and the points.

/** The linear type an element is at, read off the two fields the oracle reads it from
 *  (`packages/element/src/typeChecks.ts@1118751f:375-389`). */
const linearType = (element: SceneElement): string => {
  if (element.type === "line") return "line";
  if (element.elbowed) return "elbowArrow";
  return element.roundness != null ? "curvedArrow" : "sharpArrow";
};

/** The line, as the board holds it now. */
const theLine = async (page: Page): Promise<SceneElement> =>
  (await sceneElements(page)).find((element) => element.id === "line")!;

/** A line, an arrow bound to a shape, and a rectangle, loaded straight in. */
async function placeLinearBoard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const engine = window.__drawEngine!;
    const base = {
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
    };
    engine.loadScene(
      JSON.stringify({
        type: "osidraw",
        version: 1,
        source: "e2e",
        elements: [
          {
            ...base,
            id: "line",
            type: "line",
            x: 200,
            y: 200,
            width: 240,
            height: 140,
            points: [
              [0, 0],
              [240, 140],
            ],
            groupIds: ["g"],
          },
          {
            ...base,
            id: "box",
            type: "rectangle",
            x: 600,
            y: 400,
            width: 200,
            height: 120,
            boundElements: [{ id: "bound", type: "arrow" }],
          },
          {
            ...base,
            id: "bound",
            type: "arrow",
            x: 100,
            y: 500,
            width: 500,
            height: -40,
            roundness: 8,
            endArrowhead: "arrow",
            points: [
              [0, 0],
              [500, -40],
            ],
            endBinding: "box",
          },
        ],
      }),
    );
    (engine as unknown as SelectHandle).select(["line"]);
  });
}

test("Tab walks a line through the four linear types and back, keeping id, points and group", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeLinearBoard(page);
  const before = (await sceneElements(page)).find((element) => element.id === "line")!;

  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeVisible();
  // Four buttons, and the line's own type pressed — the oracle's panel offers `SHAPES`
  // for the family the selection is in and marks the shared one.
  await expect(panel(page).getByRole("button")).toHaveCount(4);
  await expect(panel(page).getByRole("button", { name: "Line" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(linearType(await theLine(page)), "the first Tab only opens it").toBe("line");

  /** The two ends the line was drawn between, in world terms, wherever its points are. */
  const ends = (element: SceneElement) => {
    const points = element.points!;
    const first = points.at(0)!;
    const last = points.at(-1)!;
    return [
      [element.x + first[0], element.y + first[1]],
      [element.x + last[0], element.y + last[1]],
    ];
  };
  const drawnEnds = ends(before);

  const seen: string[] = [];
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press("Tab");
    const now = await theLine(page);
    const at = linearType(now);
    seen.push(at);
    // Every step: the same element, still between the same two ends, the same group, and
    // still selected.
    expect(now.id, "the id survives").toBe("line");
    expect(ends(now), `step ${step}: the two ends survive`).toEqual(drawnEnds);
    expect(now.groupIds, "its group survives").toEqual(["g"]);
    expect(now.x, "its place survives").toBe(before.x);
    expect(now.y).toBe(before.y);
    expect(await selection(page), "and it stays selected").toEqual(["line"]);
    // The points survive verbatim everywhere except the elbow, which is the one conversion
    // that re-routes: `convertLineToElbow` builds an orthogonal path between the same ends
    // (`ConvertElementTypePopup.tsx@1118751f:567-594`), and coming back off it restores the
    // remembered points rather than un-routing the runs (`:551-556`).
    if (at === "elbowArrow") {
      expect(now.points!.length, "an orthogonal route has a corner").toBeGreaterThan(2);
    } else {
      expect(now.points, `step ${step}: the points are its own`).toEqual(before.points);
    }
  }
  expect(seen, "LINEAR_TYPES, in the order the oracle walks them").toEqual([
    "sharpArrow",
    "curvedArrow",
    "elbowArrow",
    "line",
  ]);
  // And the round trip is exact: off the elbow and back, the line is the line.
  const roundTripped = await theLine(page);
  expect(roundTripped.points, "the whole walk came back to the drawn points").toEqual(
    before.points,
  );

  // Shift+Tab goes back the other way, and the panel marks where it landed.
  await page.keyboard.press("Shift+Tab");
  const back = (await sceneElements(page)).find((element) => element.id === "line")!;
  expect(linearType(back)).toBe("elbowArrow");
  await expect(panel(page).getByRole("button", { name: "Elbow arrow" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("a line switched to an arrow and back by click is the line it was", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeLinearBoard(page);
  const before = (await sceneElements(page)).find((element) => element.id === "line")!;

  await page.keyboard.press("Tab");
  await panel(page).getByRole("button", { name: "Sharp arrow" }).click();
  const arrow = (await sceneElements(page)).find((element) => element.id === "line")!;
  expect(linearType(arrow)).toBe("sharpArrow");
  expect(arrow.points, "the click kept the points").toEqual(before.points);

  // A line has no heads; the oracle's `newLinearElement` writes both to null whatever the
  // spread carried, and a *line* is what came out of the panel, not a sharp arrow with
  // its heads taken away.
  await panel(page).getByRole("button", { name: "Line" }).click();
  const back = (await sceneElements(page)).find((element) => element.id === "line")!;
  expect(linearType(back), "the round trip").toBe("line");
  expect(back.points).toEqual(before.points);
  expect(back.groupIds).toEqual(["g"]);
  expect(back.x).toBe(before.x);
  expect(back.endArrowhead ?? null, "a line has no head at either end").toBeNull();

  // Escape ends the selection as well as the panel — the oracle's `actionDeselect` has the
  // same keyTest (`actionDeselect.ts@1118751f:132-155`) — so the line is picked again
  // before Tab, the way a person would.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  expect(await selection(page), "Escape deselected, as the oracle's does").toEqual([]);
});

test("one switch is one step of undo, not two and not none", async ({ page }) => {
  // On a board whose only edit is the switch. Measured anywhere else it says nothing: the
  // round trip above is three clicks and therefore three steps, and a second Ctrl+Z there
  // is the step before it rather than a fork in this one.
  const board = await openBoard(page);
  await focusBoard(board);
  await placeLinearBoard(page);
  const before = await theLine(page);

  await page.keyboard.press("Tab");
  await panel(page).getByRole("button", { name: "Curved arrow" }).click();
  const switched = await theLine(page);
  expect(linearType(switched)).toBe("curvedArrow");
  expect(switched.points, "and it kept its points").toEqual(before.points);

  // Not none: one undo is the whole switch, points and all.
  await page.keyboard.press("Control+z");
  const undone = await theLine(page);
  expect(linearType(undone), "one undo took the whole switch back").toBe("line");
  expect(undone.points, "and brought the points with it").toEqual(before.points);

  // Not two: there was no second step, so a second undo takes nothing else off the board.
  await page.keyboard.press("Control+z");
  const still = await theLine(page);
  expect(linearType(still), "and there was no second step").toBe("line");
  expect(still.points, "nor did that take anything").toEqual(before.points);
  expect((await sceneElements(page)).length, "nor anything else").toBe(3);
});

test("a bound arrow has nothing to switch, and Tab moves focus on", async ({ page }) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeLinearBoard(page);
  await page.evaluate(() => {
    (window.__drawEngine as unknown as SelectHandle).select(["bound"]);
  });

  // The oracle's `isEligibleLinearElement` (`ConvertElementTypePopup.tsx@1118751f:666-672`)
  // refuses a bound arrow, so `actionToggleShapeSwitch`'s predicate is false and Tab does
  // not even open the panel — it is focus moving on, as anywhere else on the page.
  await expect
    .poll(() => page.evaluate(() => window.__drawEngine!.canConvertSelection()))
    .toBe(false);
  await page.keyboard.press("Tab");
  await expect(panel(page)).toHaveCount(0);

  const arrow = (await sceneElements(page)).find((element) => element.id === "bound")!;
  expect(arrow.type, "and it is still an arrow").toBe("arrow");
  expect(arrow.endBinding, "still bound where it was").toBe("box");
});

test("a closed shape in the selection wins the switch, and the line is left alone", async ({
  page,
}) => {
  const board = await openBoard(page);
  await focusBoard(board);
  await placeLinearBoard(page);
  await page.evaluate(() => {
    (window.__drawEngine as unknown as SelectHandle).select(["line", "box"]);
  });

  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeVisible();
  // The generic branch has preference (`ConvertElementTypePopup.tsx@1118751f:648-653`),
  // so three buttons, not four.
  await expect(panel(page).getByRole("button")).toHaveCount(3);
  await page.keyboard.press("Tab");

  const scene = await sceneElements(page);
  expect(
    scene.find((element) => element.id === "box")!.type,
    "the shape walked its own round",
  ).toBe("diamond");
  expect(linearType(scene.find((element) => element.id === "line")!), "the line held").toBe("line");
});
