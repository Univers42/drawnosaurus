import { expect, test } from "@playwright/test";
import { openApp } from "./drawing.ts";

test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

/**
 * A phone browser shows and hides its own bars as the page moves, and `100vh` is the page
 * with them hidden — so a page that tall has its bottom under them, and on a phone the
 * bottom is the toolbar. Playwright cannot show those bars, so this reads the rules
 * themselves: nothing may be sized by `100vh`, only by `100dvh`, the page as it is seen.
 */
test("nothing is sized by 100vh, the height a phone's browser bars cover the bottom of", async ({
  page,
}) => {
  await openApp(page);
  const tall = await page.evaluate(() => {
    const found: string[] = [];
    const walk = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          const { height, minHeight, maxHeight } = rule.style;
          if ([height, minHeight, maxHeight].some((value) => /\b100vh\b/.test(value))) {
            found.push(rule.selectorText);
          }
        }
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        // A sheet from another origin cannot be read; the app serves its own.
      }
    }
    return found;
  });
  expect(tall, "rules that size by 100vh").toEqual([]);
});
