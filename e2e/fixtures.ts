import { test as base, expect } from "@playwright/test";

/**
 * The base test, plus one rule: a spec fails if the page threw.
 *
 * This is here because of how the bucket fill's crash presented. A `todo!()` in the
 * engine aborts the WASM module, and everything that touches it afterwards fails with
 * `already mutably borrowed` — so the spec reported a wrong element count, twenty lines
 * away from the click that actually broke, and looked for all the world like a flaky
 * test. The panic itself was sitting in the console the whole time.
 *
 * An uncaught error in the page is never acceptable here, so it is worth failing on
 * without a spec having to ask.
 */
export const test = base.extend<{ pageMustNotThrow: void }>({
  pageMustNotThrow: [
    async ({ page }, use) => {
      const thrown: string[] = [];
      page.on("pageerror", (error) => thrown.push(error.message.split("\n")[0] ?? String(error)));
      await use();
      expect(thrown, "the page threw — look here before the assertion below it").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
