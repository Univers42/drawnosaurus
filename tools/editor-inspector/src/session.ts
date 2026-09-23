/**
 * The browser the inspector drives, and everything it needs to make a board reproducible.
 *
 * One page, held open across tool calls, because state is the point: an agent asks for
 * the scene, then drives a gesture, then asks again. Reopening per call would throw away
 * exactly what it came for.
 */

import { chromium, type Browser, type Page } from "playwright";

/** Where `make dev` serves the web app. */
const DEFAULT_BASE_URL = "http://127.0.0.1:5373";

/**
 * The viewport the browser suite pins.
 *
 * The same size on purpose: a finding here has to be reproducible as a spec, and chrome
 * is laid out relative to the viewport, so a different size moves every landmark.
 */
const VIEWPORT = { width: 1280, height: 800 } as const;

export interface EventRecord {
  at: number;
  kind: string;
  detail: string;
}

export class InspectorSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly events: EventRecord[] = [];
  /** Console errors and page exceptions, which are otherwise invisible to an agent. */
  private readonly pageErrors: string[] = [];

  get isOpen(): boolean {
    return this.page !== null;
  }

  /** The open page, or an error saying what to do about it. */
  requirePage(): Page {
    if (!this.page) {
      throw new Error("No board is open. Call open_board first.");
    }
    return this.page;
  }

  async open(baseUrl = DEFAULT_BASE_URL, slug = "inspector"): Promise<{ url: string }> {
    await this.close();

    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    // Surfaced rather than swallowed. A WASM panic aborts the instance and every later
    // call fails with something unrelated twenty lines downstream; the first error is
    // the only one worth reading, so it is kept.
    page.on("pageerror", (error) => this.pageErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") this.pageErrors.push(message.text());
    });

    // The realtime channel. Left unhandled it fails and reconnects on a timer for the
    // whole session — background work under every measurement.
    await page.routeWebSocket(/\/(live|ws)$/, () => {});

    // Stubbed rather than served, exactly as the browser suite does it: an inspector that
    // needs a database reports the database's problems as the editor's.
    await page.route("**/v1/**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { etag: '"inspector"' },
        body: JSON.stringify({ slug, elements: [], appState: {} }),
      });
    });

    // `/boards/` — plural, matching the SvelteKit route. The same path the browser
    // suite uses, so a repro found here transcribes into a spec unchanged.
    const url = `${baseUrl}/boards/${slug}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 15_000 });

    // `__drawEngine` is set under `import.meta.env.DEV` only. Its absence almost always
    // means the URL is a production build rather than `vite dev`, so say that instead of
    // timing out with nothing.
    try {
      await page.waitForFunction(() => Boolean((window as never as DebugWindow).__drawEngine), {
        timeout: 15_000,
      });
    } catch {
      await this.close();
      throw new Error(
        `The engine never appeared at ${url}. window.__drawEngine exists only in DEV ` +
          `builds — run \`make dev\` and point the inspector at that, not at a container.`,
      );
    }

    this.page = page;
    this.record("open_board", url);
    return { url };
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }

  record(kind: string, detail: string): void {
    this.events.push({ at: Date.now(), kind, detail });
    // Bounded: this runs for the length of a session and an unbounded log of a debugging
    // aid is a leak that only shows up in the long sessions where it matters.
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  history(): EventRecord[] {
    return [...this.events];
  }

  takeErrors(): string[] {
    return this.pageErrors.splice(0, this.pageErrors.length);
  }
}

/** The DEV-only debug handle the web app hangs on `window`. */
export interface DebugWindow {
  __drawEngine?: {
    debugSnapshot(): unknown;
    exportJson(): string;
    getSelection(): string[];
    getTool(): string;
    hitTest(sx: number, sy: number, tolerance: number): unknown;
    setTool(tool: string): void;
    resetDebugCounters(): void;
    readonly camera: { x: number; y: number; scale: number };
  };
}
