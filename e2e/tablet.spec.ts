import { expect, type Page, test } from "@playwright/test";
import { openBoard } from "./board.ts";

/**
 * The tablet layout.
 *
 * The brief's contract: a tablet is not a small desktop. The style panel is the
 * oracle's compact column of icon buttons and popovers, not the full inspector, and the
 * top bar's parts — the menu, the title, the status chips, the toolbar, Share and Help —
 * never overlap one another at any width from 600 px up. The desktop at 1280 keeps
 * exactly the look it has today.
 *
 * Viewports are fixed and `/v1/**` is stubbed (`openBoard`), so a failure here means the
 * layout changed — never the viewport, the data or the network.
 */

/** A box on screen, with a name for the failure message. */
interface ChromeBox {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The chrome that floats over the board, part by part.
 *
 * The parts and not the header's own box: the header spans the whole width, so it holds
 * the toolbar's place in the row and would "overlap" it by construction.
 */
const CHROME_PARTS: readonly (readonly [string, string])[] = [
  [".draw-header .menu-btn", "menu"],
  [".draw-header .board-title", "title"],
  [".draw-header .save-status", "chips"],
  [".draw-header .share-btn", "share"],
  [".draw-header .help-btn", "help"],
  ['[aria-label="Drawing tools"]', "toolbar"],
  ['[aria-label="Style panel"]', "style panel"],
  ['[aria-label="Style inspector"]', "style inspector"],
];

async function chromeBoxes(page: Page): Promise<ChromeBox[]> {
  return page.evaluate(
    (parts) => {
      const boxes: {
        name: string;
        left: number;
        top: number;
        right: number;
        bottom: number;
      }[] = [];
      for (const [selector, name] of parts) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
          const r = node.getBoundingClientRect();
          if (r.right <= r.left || r.bottom <= r.top) continue;
          // A box nobody can see is not a box: the folded status chips stay in the
          // document so their width can be measured, and they are out of the way.
          const style = getComputedStyle(node);
          if (style.visibility === "hidden" || style.display === "none") continue;
          boxes.push({ name, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
        }
      }
      return boxes;
    },
    CHROME_PARTS as readonly (readonly [string, string])[],
  );
}

function boxesIntersect(
  a: ChromeBox,
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** A rectangle on the board, selected — so the style panel has something to act on. */
async function selectRectangle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const engine = window.__drawEngine!;
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    const id = engine.insertDefaultShape("rectangle", canvas.width / 2, canvas.height / 2);
    if (id) engine.select([id]);
  });
}

/** The top bar's parts: inside the screen, and none of them over another. */
async function expectTopBarHolds(page: Page): Promise<void> {
  const boxes = await chromeBoxes(page);
  expect(boxes.length, "there is chrome at all").toBeGreaterThan(0);
  const size = page.viewportSize()!;
  const slack = 0.5; // half-pixel rounding in the compositor, no more.

  for (const box of boxes) {
    expect(box.left, `${box.name} left edge`).toBeGreaterThanOrEqual(-slack);
    expect(box.right, `${box.name} right edge`).toBeLessThanOrEqual(size.width + slack);
    expect(box.top, `${box.name} top edge`).toBeGreaterThanOrEqual(-slack);
    expect(box.bottom, `${box.name} bottom edge`).toBeLessThanOrEqual(size.height + slack);
  }

  for (const a of boxes) {
    for (const b of boxes) {
      if (a === b) continue;
      expect(boxesIntersect(a, b), `${a.name} overlaps ${b.name}`).toBe(false);
    }
  }
}

const TABLETS = [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 820, height: 1180 },
  { width: 600, height: 960 },
] as const;

for (const viewport of TABLETS) {
  test.describe(`tablet ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("the top bar's parts never overlap and never leave the screen", async ({ page }) => {
      await openBoard(page);
      await selectRectangle(page);
      await expectTopBarHolds(page);
    });

    test("the style panel is the compact column and covers little of the board", async ({
      page,
    }) => {
      await openBoard(page);
      await selectRectangle(page);

      // The oracle's compact panel, not the desktop's inspector: a narrow column of
      // buttons, each opening a popover (`Actions.scss@1118751f:95-179`).
      const panel = page.getByRole("complementary", { name: "Style panel" });
      await expect(panel, "the compact panel is there").toBeVisible();
      await expect(
        page.getByRole("complementary", { name: "Style inspector" }),
        "the full inspector is not",
      ).toHaveCount(0);

      const box = (await panel.boundingBox())!;
      const size = page.viewportSize()!;
      const covered = (box.width * box.height) / (size.width * size.height);
      expect(covered, "the style panel's share of the screen").toBeLessThan(0.15);
    });

    test("the menu is above the tool bar's row", async ({ page }) => {
      await openBoard(page);
      await page.getByRole("button", { name: "Open main menu" }).click();
      const menu = page.getByRole("menu", { name: "Main menu" });
      await expect(menu).toBeVisible();

      // The top bar is above the tool bar's row — the oracle's own rule (`MobileMenu.tsx
      // @1118751f:150-153`): the top bar is on top. What is at the middle of the menu's
      // first row is that row, not the tool bar painted over it.
      const over = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('[role="menuitem"]');
        if (!row) return { hit: false, what: "the menu is not open" };
        const r = row.getBoundingClientRect();
        const at = document.elementFromPoint(r.right - 20, r.top + r.height / 2);
        return {
          hit: at === row || (at !== null && row.contains(at)),
          what: (at as HTMLElement | null)?.className?.toString() ?? "nothing",
        };
      });
      expect(over.hit, `the menu's first row is on top (${over.what})`).toBe(true);
    });

    test("a stroke colour picked in the compact panel reaches the shape", async ({ page }) => {
      await openBoard(page);
      await selectRectangle(page);

      const panel = page.getByRole("complementary", { name: "Style panel" });
      await expect(panel).toBeVisible();
      await panel.getByRole("button", { name: "Stroke" }).click();

      const picker = page.getByRole("dialog", { name: "Stroke colour picker" });
      await expect(picker, "the stroke picker's popover opened").toBeVisible();
      await picker.getByRole("button", { name: /^Red —/ }).click();
      await expect(picker, "the popover closed again").toBeHidden();

      const stroke = await page.evaluate(() => {
        const engine = window.__drawEngine!;
        const element = JSON.parse(engine.exportJson()).elements.find(
          (el: { type: string }) => el.type === "rectangle",
        );
        return element.strokeColor;
      });
      expect(stroke, "the shape's stroke is the colour that was picked").toBe("#e03131");
    });

    test("the compact panel's own popover opens on screen and changes the shape", async ({
      page,
    }) => {
      await openBoard(page);
      await selectRectangle(page);

      const panel = page.getByRole("complementary", { name: "Style panel" });
      await panel.getByRole("button", { name: "Shape properties" }).click();

      const popover = page.getByRole("dialog", { name: "Shape properties" });
      await expect(popover, "the popover opened").toBeVisible();

      const size = page.viewportSize()!;
      const box = (await popover.boundingBox())!;
      expect(box.x, "the popover's left edge").toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width, "the popover's right edge").toBeLessThanOrEqual(size.width + 0.5);
      expect(box.y, "the popover's top edge").toBeGreaterThanOrEqual(-0.5);
      expect(box.y + box.height, "the popover's bottom edge").toBeLessThanOrEqual(
        size.height + 0.5,
      );

      await popover
        .getByRole("group", { name: "Stroke width" })
        .getByRole("button", { name: "L" })
        .click();

      const width = await page.evaluate(() => {
        const engine = window.__drawEngine!;
        const element = JSON.parse(engine.exportJson()).elements.find(
          (el: { type: string }) => el.type === "rectangle",
        );
        return element.strokeWidth;
      });
      expect(width, "the shape's stroke width").toBe(4);
    });
  });
}

test.describe("desktop 1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the desktop's own chrome is exactly as it was", async ({ page }) => {
    await openBoard(page);
    await selectRectangle(page);

    // The full inspector, as it is on a desktop: the same panel, the same place.
    const inspector = page.getByRole("complementary", { name: "Style inspector" });
    await expect(inspector, "the desktop's inspector").toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Style panel" }),
      "no compact panel on a desktop",
    ).toHaveCount(0);

    const box = (await inspector.boundingBox())!;
    expect(box.width, "the inspector's width").toBe(216);
    expect(box.x, "the inspector's left edge").toBe(14);
    expect(box.y, "the inspector's top edge").toBe(66);

    // And the toolbar still sits centred in the header's row, where it has always been.
    const toolbar = page.getByRole("toolbar", { name: "Drawing tools" });
    const bar = (await toolbar.boundingBox())!;
    expect(bar.x + bar.width / 2, "the toolbar's centre").toBeCloseTo(640, 0);
    expect(bar.y, "the toolbar's top edge").toBe(14);
  });
});
