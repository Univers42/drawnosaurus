import { expect, type Page, test } from "@playwright/test";
import { camera, elementKinds, openBoard, sceneElements, type Board } from "./board.ts";

/**
 * The phone layout.
 *
 * The brief's contract: a phone instead of a scaled-down desktop — a bottom tool bar, a
 * compact style strip that covers nothing the person drew, overlays that fit the narrowest
 * screen this suite runs, and touch that draws with one finger and pans and pinches with
 * two. Viewports are fixed, `/v1/**` is stubbed (`openBoard`), and every gesture is real
 * touch input through CDP, so a failure here means the layout or the input handling
 * changed — never the viewport, the data, or the network.
 */

type Point = { x: number; y: number };

/** Everything fixed chrome that floats over the board, with a name for failure messages. */
interface ChromeBox {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function chromeBoxes(page: Page): Promise<ChromeBox[]> {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".draw-chrome header.draw-header, .draw-chrome [data-viewport-ui]",
      ),
    );
    return nodes
      .map((node) => {
        const r = node.getBoundingClientRect();
        return {
          name: node.getAttribute("aria-label") ?? node.tagName.toLowerCase(),
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        };
      })
      .filter((box) => box.right > box.left && box.bottom > box.top);
  });
}

function expectInside(box: ChromeBox, size: { width: number; height: number }): void {
  const slack = 0.5; // half-pixel rounding in the compositor, no more.
  expect(box.left, `${box.name} left edge`).toBeGreaterThanOrEqual(-slack);
  expect(box.right, `${box.name} right edge`).toBeLessThanOrEqual(size.width + slack);
  expect(box.top, `${box.name} top edge`).toBeGreaterThanOrEqual(-slack);
  expect(box.bottom, `${box.name} bottom edge`).toBeLessThanOrEqual(size.height + slack);
}

function boxesIntersect(
  a: ChromeBox,
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The touch input pipeline, driven by hand: CDP is the only way this suite can hold two
 * fingers down, and it goes through Chromium's own input pipeline, so the page sees the
 * same PointerEvents a real finger produces.
 */
function touch(page: Page) {
  return page.context().newCDPSession(page);
}

function single(pts: { x: number; y: number }): { x: number; y: number; id: number }[] {
  return [{ x: Math.round(pts.x), y: Math.round(pts.y), id: 1 }];
}

function pair(a: { x: number; y: number }, b: { x: number; y: number }) {
  return [
    { x: Math.round(a.x), y: Math.round(a.y), id: 1 },
    { x: Math.round(b.x), y: Math.round(b.y), id: 2 },
  ];
}

/** One finger down, along, up — a stroke drawn the way a thumb does it. */
async function touchStroke(page: Page, from: Point, to: Point, steps = 6): Promise<void> {
  const session = await touch(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: single(from) });
  for (let step = 1; step <= steps; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: single({
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      }),
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A pinch: two symmetric fingers spreading from `from` px apart to `to` px apart. */
async function pinch(
  page: Page,
  at: Point,
  spread: { from: number; to: number },
  steps = 4,
): Promise<void> {
  const session = await touch(page);
  const points = (half: number) => pair({ x: at.x - half, y: at.y }, { x: at.x + half, y: at.y });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(spread.from / 2),
  });
  for (let step = 1; step <= steps; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points((spread.from + ((spread.to - spread.from) * step) / steps) / 2),
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A two-finger drag: two fingers held one distance apart, moved together. */
async function twoFingerDrag(page: Page, at: Point, delta: Point, steps = 4): Promise<void> {
  const session = await touch(page);
  const points = (dx: number, dy: number) =>
    pair({ x: at.x - 40 + dx, y: at.y + dy }, { x: at.x + 40 + dx, y: at.y + dy });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(0, 0) });
  for (let step = 1; step <= steps; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points((delta.x * step) / steps, (delta.y * step) / steps),
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A long press: one finger down, still, until the menu-timeout runs out under it. */
async function longPress(page: Page, at: Point): Promise<void> {
  const session = await touch(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: single(at) });
  await page.waitForTimeout(700);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Where the canvas is clear of chrome, in viewport coordinates. */
function openArea(board: Board): { x: number; y: number } {
  const midX = board.box.x + board.box.width / 2;
  const midY = board.box.y + 90 + (board.box.height - 220) / 2;
  return { x: midX, y: midY };
}

/**
 * A shape's on-screen box, taken from the engine — not from a formula of ours.
 *
 * The same conversion `clickElement` trusted before this spec existed: the element's
 * model box through the camera, on the canvas element's client rect.
 */
async function shapeScreenBox(page: Page, index: number) {
  return page.evaluate((which) => {
    const engine = window.__drawEngine!;
    const element = JSON.parse(engine.exportJson()).elements[which];
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    const { x, y, scale } = engine.camera;
    return {
      name: `shape ${element.type}`,
      left: canvas.left + element.x * scale + x,
      top: canvas.top + element.y * scale + y,
      right: canvas.left + (element.x + element.width) * scale + x,
      bottom: canvas.top + (element.y + element.height) * scale + y,
    };
  }, index);
}

/** Asserts a shape's screen box is clear of every floating bar. */
async function expectShapeUncovered(page: Page, index: number): Promise<void> {
  const shape = await shapeScreenBox(page, index);
  for (const chrome of await chromeBoxes(page)) {
    expect(boxesIntersect(chrome, shape), `${chrome.name} covers ${shape.name}`).toBe(false);
  }
}

test.describe("phone portrait 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the chrome stays inside the screen and the bars do not overlap", async ({ page }) => {
    await openBoard(page);
    const boxes = await chromeBoxes(page);
    expect(boxes.length, "there is chrome at all").toBeGreaterThan(0);
    const size = page.viewportSize()!;
    for (const box of boxes) expectInside(box, size);
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        expect(boxesIntersect(a, b), `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });

  test("a rectangle drawn by touch is never covered by chrome", async ({ page }) => {
    const board = await openBoard(page);
    const area = openArea(board);

    // The shapes button on the bottom bar opens its popover; pick the rectangle.
    await page.getByRole("button", { name: /^Shapes \(/ }).click();
    await page.getByRole("menuitemradio", { name: "Rectangle" }).click();
    await touchStroke(page, { x: area.x - 70, y: area.y - 40 }, { x: area.x + 70, y: area.y + 60 });

    const kinds = await elementKinds(page);
    expect(kinds).toContain("rectangle");
    await expectShapeUncovered(page, kinds.lastIndexOf("rectangle"));
  });

  test("the style strip changes a stroke colour and its popover closes", async ({ page }) => {
    await openBoard(page);
    // The strip is the selection's: with nothing selected and no tool in hand there is
    // nothing for it to act on, so the oracle does not show it (the same predicate the
    // desktop's panel uses).
    await expect(
      page.getByRole("toolbar", { name: "Shape actions" }),
      "no strip without a selection",
    ).toBeHidden();

    // A rectangle, selected: the strip's rows are what a selection fills in.
    await page.evaluate(() => {
      const engine = window.__drawEngine!;
      const canvas = document.querySelector("canvas")!.getBoundingClientRect();
      const id = engine.insertDefaultShape("rectangle", canvas.width / 2, canvas.height / 2);
      if (id) engine.select([id]);
    });

    const strip = page.getByRole("toolbar", { name: "Shape actions" });
    await expect(strip).toBeVisible();

    await strip.getByRole("button", { name: "Stroke" }).click();
    const dialog = page.getByRole("dialog", { name: "Stroke colour picker" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Red —/ }).click();
    await expect(dialog).toBeHidden();

    // And the shape is red: the pick reached the engine, not only the picker.
    const stroke = await page.evaluate(() => {
      const engine = window.__drawEngine!;
      const element = JSON.parse(engine.exportJson()).elements.find(
        (el: { type: string }) => el.type === "rectangle",
      );
      return element.strokeColor;
    });
    expect(stroke, "the shape's stroke is the colour that was picked").toBe("#e03131");
  });

  test("a pinch zooms, a two-finger drag pans, neither draws", async ({ page }) => {
    const board = await openBoard(page);
    const at = openArea(board);

    const start = await camera(page);
    await pinch(page, at, { from: 170, to: 90 });
    const zoomed = await camera(page);
    expect(zoomed.scale).not.toBeCloseTo(start.scale, 3);

    await pinch(page, at, { from: 90, to: 170 });
    const restored = await camera(page);
    expect(restored.scale).toBeCloseTo(start.scale, 0);

    const beforePan = await camera(page);
    await twoFingerDrag(page, at, { x: -90, y: 45 });
    const panned = await camera(page);
    expect(panned.x).not.toBeCloseTo(beforePan.x, 2);
    expect(panned.y).not.toBeCloseTo(beforePan.y, 2);

    expect(await sceneElements(page), "gestures draw nothing").toEqual([]);
  });
});

test.describe("phone narrow 360×740", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("every dialog, the menus and the vectorizer fit inside 360 px", async ({ page }) => {
    await openBoard(page);
    await page.waitForLoadState("networkidle");
    const size = page.viewportSize()!;

    async function expectFits(name: string, element: { boundingBox: () => Promise<unknown> }) {
      const box = (await element.boundingBox()) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      expectInside(
        {
          name,
          left: box.x,
          top: box.y,
          right: box.x + box.width,
          bottom: box.y + box.height,
        },
        size,
      );
    }

    async function expectDialogFits(name: string): Promise<void> {
      const open = page.locator(".modal-backdrop").first();
      await expect(open, `${name} opened`).toBeVisible();
      // The backdrop is `inset: 0` — full screen by construction — so the test measures
      // the card the dialog is actually drawn with, not the scrim around it.
      await expectFits(name, open.locator(".modal-card, .palette-card"));
      await page.keyboard.press("Escape");
      await expect(open, `${name} closed again`).toBeHidden();
    }

    const paletteInput = page.getByRole("combobox", { name: "Command palette" });

    async function runCommand(label: string): Promise<void> {
      await page.keyboard.press("ControlOrMeta+/");
      await expect(paletteInput).toBeVisible();
      await paletteInput.fill(label);
      // The option's accessible name carries its shortcut with it ("Export… Ctrl+Shift+E"),
      // so the label is a prefix of the name, not the whole of it.
      const pattern = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/…$/, "…?");
      await page
        .getByRole("option", { name: new RegExp(`^${pattern}`) })
        .first()
        .click();
      await expect(paletteInput).toBeHidden();
    }

    // Share and the shortcuts, off the header; the main menu where its trigger is.
    await page.getByRole("button", { name: "Share & collaborate" }).click();
    await expectDialogFits("share");
    await page.getByRole("button", { name: "Open main menu" }).click();
    await expectFits("main menu", page.getByRole("menu", { name: "Main menu" }));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expectDialogFits("shortcuts");

    for (const command of ["Export…", "Templates…", "Mermaid to diagram…"]) {
      await runCommand(command);
      await expectDialogFits(command);
    }

    // The embed dialog the way a phone reaches it: the More menu on the bottom bar.
    await page.getByRole("button", { name: "More tools" }).click();
    await page.getByRole("menuitemradio", { name: "Embed web page" }).click();
    await expectDialogFits("embed");

    // A rectangle at the centre, a long press to open the canvas menu beside it — and
    // out of that menu, the Vectorize dialog, which needs an image to exist at all.
    await runCommand("Add rectangle");
    const centre = await page.evaluate(() => {
      const engine = window.__drawEngine!;
      const canvas = document.querySelector("canvas")!.getBoundingClientRect();
      const element = JSON.parse(engine.exportJson()).elements.find(
        (el: { type: string; isDeleted?: boolean }) => el.type === "rectangle" && !el.isDeleted,
      );
      const { x, y, scale } = engine.camera;
      return {
        x: canvas.left + (element.x + element.width / 2) * scale + x,
        y: canvas.top + (element.y + element.height / 2) * scale + y,
      };
    });
    await longPress(page, centre);
    const menu = page.getByRole("menu", { name: "Canvas menu" });
    await expect(menu, "the long press opened the canvas menu").toBeVisible();
    await expectFits("canvas menu", menu);
    await page.keyboard.press("Escape");

    // One image, placed through the engine as the dialog does, is the vectorize row's
    // own condition (`menuElementFromSelection`: a lone image). The picture is a real
    // 2×2 PNG so the element has something to trace: its fits test needs no recognition.
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas")!.getBoundingClientRect();
      window.__drawEngine!.insertImage(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8//8/AzGAiShVowoJAgCCrgEDBXS/PgAAAABJRU5ErkJggg==",
        2,
        2,
        canvas.left + canvas.width / 2,
        canvas.top + canvas.height / 3,
      );
    });
    const kinds = await elementKinds(page);
    expect(kinds).toContain("image");
    const imageAt = await page.evaluate((index) => {
      const engine = window.__drawEngine!;
      const canvas = document.querySelector("canvas")!.getBoundingClientRect();
      const element = JSON.parse(engine.exportJson()).elements[index];
      const { x, y, scale } = engine.camera;
      return {
        x: canvas.left + (element.x + element.width / 2) * scale + x,
        y: canvas.top + (element.y + element.height / 2) * scale + y,
      };
    }, kinds.lastIndexOf("image"));
    await longPress(page, imageAt);
    await page.getByRole("menuitem", { name: "Vectorize image…" }).click();
    await expectDialogFits("vectorize");
  });
});

test.describe("phone landscape 844×390", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test("the chrome fits the short screen", async ({ page }) => {
    await openBoard(page);
    const boxes = await chromeBoxes(page);
    const size = page.viewportSize()!;
    for (const box of boxes) expectInside(box, size);
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        expect(boxesIntersect(a, b), `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });
});

/**
 * The phone's main menu.
 *
 * The bottom bar is under the menu, not over it: the oracle's own rule is that the top
 * bar is on top (`MobileMenu.tsx@1118751f:150-153`), so a menu opened from it paints
 * over the bottom bar rather than under it. Every row must therefore be reachable and
 * tappable, the menu must stay inside the screen, and a row must show no keyboard
 * shortcut — there is no keyboard on a phone.
 */
async function expectMenuIsUsable(page: Page): Promise<void> {
  await openBoard(page);

  // A shape selected: the style strip is on the bottom bar, over the menu's lower part.
  await page.evaluate(() => {
    const engine = window.__drawEngine!;
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    const id = engine.insertDefaultShape("rectangle", canvas.width / 2, canvas.height / 2);
    if (id) engine.select([id]);
  });

  await page.getByRole("button", { name: "Open main menu" }).click();
  const menu = page.getByRole("menu", { name: "Main menu" });
  await expect(menu).toBeVisible();

  // The menu's box is inside the screen.
  const size = page.viewportSize()!;
  const box = (await menu.boundingBox())!;
  expect(box.x, "the menu's left edge").toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, "the menu's right edge").toBeLessThanOrEqual(size.width + 0.5);
  expect(box.y, "the menu's top edge").toBeGreaterThanOrEqual(-0.5);
  expect(box.y + box.height, "the menu's bottom edge").toBeLessThanOrEqual(size.height + 0.5);

  // Scroll the menu to its end: the rows that hang below the screen are reachable.
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".dropdown-menu-container");
    if (container) container.scrollTop = container.scrollHeight;
  });

  // What is at the middle of the first canvas-background swatch is the swatch, and what
  // is at the middle of the menu's last row is that row: nothing is painted over them.
  const hits = await page.evaluate(() => {
    const swatch = document.querySelector<HTMLElement>(
      '[aria-label="Canvas background"] .swatch',
    );
    const stamp = document.querySelector<HTMLElement>('[data-testid="build-stamp"]');
    if (!swatch || !stamp) return { swatch: false, stamp: false, over: "the menu is not open" };
    const at = (node: HTMLElement): Element | null => {
      const r = node.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    };
    const overSwatch = at(swatch);
    const overStamp = at(stamp);
    return {
      swatch: overSwatch === swatch || (overSwatch !== null && swatch.contains(overSwatch)),
      stamp: overStamp === stamp || (overStamp !== null && stamp.contains(overStamp)),
      over: `${overSwatch?.className ?? "nothing"} / ${overStamp?.className ?? "nothing"}`,
    };
  });
  expect(hits.swatch, `the first canvas background swatch is on top (${hits.over})`).toBe(true);
  expect(hits.stamp, `the menu's last row is on top (${hits.over})`).toBe(true);
}

for (const viewport of [
  { width: 390, height: 664 },
  { width: 360, height: 600 },
]) {
  test.describe(`phone menu ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("the menu is above the bottom bar and every row can be reached", async ({ page }) => {
      await expectMenuIsUsable(page);
    });

    test("no row of the menu shows a keyboard shortcut", async ({ page }) => {
      await openBoard(page);
      await page.getByRole("button", { name: "Open main menu" }).click();
      const menu = page.getByRole("menu", { name: "Main menu" });
      await expect(menu).toBeVisible();
      await expect(
        menu.locator(".dropdown-menu-item__shortcut"),
        "the menu shows a shortcut",
      ).toHaveCount(0);
    });
  });
}

test.describe("desktop menu 1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the menu still shows its keyboard shortcuts", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Open main menu" }).click();
    const menu = page.getByRole("menu", { name: "Main menu" });
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Ctrl+O")).toBeVisible();
  });
});
