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
