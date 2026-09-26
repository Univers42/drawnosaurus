import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  camera,
  focusBoard,
  openBoard,
  sceneElements,
  selection,
  waitForCameraLanded,
  type Board,
  type SceneElement,
} from "./board.ts";

/**
 * Mermaid in, the oracle's two ways (`TTDDialog/MermaidToExcalidraw.tsx`, and a pasted
 * definition in `App.tsx@1118751f:4686-4708`): the dialog previews what it will place and
 * Insert puts it in the middle of the view, fitted; a paste puts it at the pointer and
 * leaves the camera alone. What the converter makes of every type is `mermaidFuzz.spec.ts`.
 */

const dialog = (page: Page) => page.getByRole("dialog", { name: "Mermaid to diagram" });

/** Pixels the preview has drawn, against its own corner. */
function previewInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="Mermaid preview"] canvas');
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || canvas.width === 0) return 0;
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ([0, 1, 2].some((c) => Math.abs(data[i + c]! - corner[c]!) > 12)) ink += 1;
    }
    return ink;
  });
}

async function openDialog(page: Page, board: Board): Promise<void> {
  // The dialog keeps the last definition; each test starts from the oracle's example.
  await page.evaluate(() => localStorage.removeItem("drawnosaurus:mermaid-definition"));
  await focusBoard(board);
  await page.keyboard.press("Control+/");
  await page.keyboard.type("mermaid");
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
}

const labelOf = (elements: SceneElement[], shape: SceneElement) =>
  elements.find((element) => element.id === shape.boundTextId)?.originalText;

test("the palette opens the dialog, it previews as typed, and Ctrl+Enter inserts in view", async ({
  page,
}) => {
  const board = await openBoard(page);
  await openDialog(page, board);
  const syntax = dialog(page).getByRole("textbox");
  await expect(syntax).toBeFocused();
  await expect(syntax, "the oracle's example to start from").toHaveValue(/Christmas/);

  await syntax.fill("flowchart LR\n A[Start] --> B{Ready?}\n B -->|yes| C[Ship]");
  await expect(dialog(page).getByRole("button", { name: /Insert/ })).toBeEnabled();
  await expect.poll(() => previewInk(page), { timeout: 10_000 }).toBeGreaterThan(300);
  await page.keyboard.press("Control+Enter");
  await expect(dialog(page)).toHaveCount(0);

  const elements = await sceneElements(page);
  const shapes = elements.filter((e) => ["rectangle", "diamond", "ellipse"].includes(e.type));
  const byLabel = new Map(shapes.map((shape) => [labelOf(elements, shape), shape]));
  expect([...byLabel.keys()].sort()).toEqual(["Ready?", "Ship", "Start"]);
  expect(byLabel.get("Ready?")!.type).toBe("diamond");
  const arrows = elements.filter((e) => e.type === "arrow");
  const pairs = arrows.map((a) => [a.startBinding, a.endBinding]);
  expect(pairs).toContainEqual([byLabel.get("Start")!.id, byLabel.get("Ready?")!.id]);
  expect(pairs).toContainEqual([byLabel.get("Ready?")!.id, byLabel.get("Ship")!.id]);
  const edge = arrows.find((a) => a.endBinding === byLabel.get("Ship")!.id)!;
  expect(elements.find((e) => e.containerId === edge.id)?.originalText).toBe("yes");
  expect((await selection(page)).length).toBe(elements.length);

  // Fitted: every shape is on screen.
  const view = await waitForCameraLanded(page);
  for (const shape of shapes) {
    const left = shape.x * view.scale + view.x;
    const top = shape.y * view.scale + view.y;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + shape.width * view.scale).toBeLessThanOrEqual(board.box.width);
    expect(top + shape.height * view.scale).toBeLessThanOrEqual(board.box.height);
  }

  // One step of undo takes the whole diagram back.
  await focusBoard(board);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await sceneElements(page)).length).toBe(0);
});

test("a definition Mermaid cannot read says why, and offers nothing to insert", async ({
  page,
}) => {
  const board = await openBoard(page);
  await openDialog(page, board);
  await dialog(page).getByRole("textbox").fill("flowchart TD\n A[never closed --> B");
  await expect(dialog(page).getByRole("alert")).toContainText(/error/i);
  await expect(dialog(page).getByRole("button", { name: /Insert/ })).toBeDisabled();
  await page.keyboard.press("Control+Enter");
  await expect(dialog(page)).toBeVisible();
  expect(await sceneElements(page)).toHaveLength(0);
});

test("a type with no shapes of its own comes in as a picture, badged as one", async ({ page }) => {
  const board = await openBoard(page);
  await openDialog(page, board);
  await dialog(page).getByRole("textbox").fill('pie title Pets\n "Dogs" : 386\n "Cats" : 85');
  await expect(dialog(page).getByRole("button", { name: /Insert/ })).toBeEnabled();
  await dialog(page).getByRole("button", { name: /Insert/ }).click();

  const elements = await sceneElements(page);
  expect(elements.map((e) => e.type).sort()).toEqual(["image", "text"]);
  const image = elements.find((e) => e.type === "image")!;
  const badge = elements.find((e) => e.type === "text")!;
  expect((image as { dataUrl?: string }).dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(badge.text).toBe("Mermaid diagram · image, not editable");
  expect(badge.groupIds).toEqual(image.groupIds);
  expect(badge.y).toBeGreaterThan(image.y + image.height);
});

test("a pasted definition lands at the pointer as its diagram, the camera left alone", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const board = await openBoard(page);
  await focusBoard(board);
  await page.evaluate(() =>
    navigator.clipboard.writeText("graph TD\n  A[Paste] --> B(Here)\n  A --> C((There))"),
  );
  const target = { x: 800, y: 420 };
  await page.mouse.move(board.box.x + target.x, board.box.y + target.y);
  const before = await camera(page);
  const pointer = await page.evaluate(
    (at) => window.__drawEngine!.screenToWorld(at.x, at.y),
    target,
  );

  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await sceneElements(page)).length).toBe(8);
  const elements = await sceneElements(page);
  const shapes = elements.filter((e) => e.boundTextId && e.type !== "arrow");
  expect(shapes.map((shape) => labelOf(elements, shape)).sort()).toEqual(["Here", "Paste", "There"]);
  expect(await camera(page)).toEqual(before);

  // Its bounding box centred on the pointer, as a paste of elements is.
  const left = Math.min(...elements.map((e) => e.x));
  const right = Math.max(...elements.map((e) => e.x + e.width));
  const top = Math.min(...elements.map((e) => e.y));
  const bottom = Math.max(...elements.map((e) => e.y + e.height));
  expect(Math.abs((left + right) / 2 - pointer.x)).toBeLessThan(2);
  expect(Math.abs((top + bottom) / 2 - pointer.y)).toBeLessThan(2);
});

test("pasted text that only starts like Mermaid places no diagram", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const board = await openBoard(page);
  await focusBoard(board);
  await page.evaluate(() => navigator.clipboard.writeText("graph paper, 5 mm squares"));
  await page.mouse.move(board.box.x + 800, board.box.y + 420);
  await page.keyboard.press("Control+v");
  // Given its time to convert and fail; the fixture fails the test had anything thrown.
  await page.waitForTimeout(1_500);
  expect(await sceneElements(page)).toHaveLength(0);
});
