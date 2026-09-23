import fs from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openBoard } from "../../e2e/board.ts";
import { LINKS, type Link } from "./links.ts";

/**
 * Pastes every link in `links.ts` into a real board and looks at what comes up.
 *
 * Through the app, not around it: the link goes to the engine as the embed dialog sends
 * it, and the frame is the one the board puts on the canvas — its sandbox, its referrer,
 * its `allow` — so a failure here is one someone would see.
 *
 * What each frame is judged by:
 *
 * - **refused** — the engine would not take the link. Right for the links that must be
 *   refused; for any other it is a rule missing.
 * - **blocked** — the provider refused to be framed (`X-Frame-Options`,
 *   `frame-ancestors`): the rewrite sent it to a page that is not an embed. Our bug.
 * - **http N** — the frame's page answered with an error. Usually content that no
 *   longer exists; a rewrite to a wrong address looks the same, so read the URL.
 * - **provider error** — the page loaded and shows the provider's own error: YouTube's
 *   "Error 153" is ours (it is what a missing referrer produces); "Video unavailable" is
 *   the content's.
 * - **ok** — it came up.
 */

const OUT = path.resolve(process.env.EMBED_CHECK_OUT ?? "test-results/embed-check");

/** The provider's own words for "this did not work", as they appear in the frame. */
const ERROR_TEXT = [
  /error 15\d/i,
  /video player configuration error/i,
  /video unavailable/i,
  /an error occurred/i,
  /this video is (private|unavailable)/i,
  /sorry/i,
  /page not found/i,
  /not found/i,
  /something went wrong/i,
  /content (is )?(unavailable|not available)/i,
  /refused to connect/i,
  /log in|sign in/i,
];

interface Result {
  n: number;
  provider: string;
  pasted: string;
  expect: Link["expect"];
  framed: string | null;
  verdict: string;
  detail: string;
}

/**
 * Lets every request that is not the app's own go to the network.
 *
 * `openBoard` stubs every `/v1/` request for the suite, where nothing leaves the page.
 * Here the frames are real, and some providers call APIs of their own under `/v1/` —
 * Loom does — which the stub answered with the board's JSON. Registered after it, so it
 * is asked first, and `continue` goes straight to the network, past the stub.
 */
async function letProvidersThrough(page: Page): Promise<void> {
  const app = new URL(page.url()).origin;
  await page.route(
    (url) => url.origin !== app,
    (route) => route.continue(),
  );
}

async function frameFor(page: Page): Promise<Frame | null> {
  const handle = await page.locator('iframe[title="Embedded page"]').elementHandle();
  return handle ? handle.contentFrame() : null;
}

async function textOf(frame: Frame): Promise<string> {
  try {
    return await frame.evaluate(() => (document.body?.innerText ?? "").slice(0, 2000));
  } catch {
    return "";
  }
}

test("every link comes up", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const board = await openBoard(page, "embed-check");
  await letProvidersThrough(page);
  const messages: string[] = [];
  page.on("console", (message) => messages.push(message.text()));
  const documents: { url: string; status: number }[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "document" && response.frame() !== page.mainFrame()) {
      documents.push({ url: response.url(), status: response.status() });
    }
  });

  const results: Result[] = [];
  for (const [index, link] of LINKS.entries()) {
    const n = index + 1;
    messages.length = 0;
    documents.length = 0;
    await page.evaluate(() => {
      const engine = window.__drawEngine! as unknown as { clear(): void };
      engine.clear();
    });
    await expect(page.locator('iframe[title="Embedded page"]')).toHaveCount(0);

    const middle = { x: board.box.width / 2, y: board.box.height / 2 };
    const id = await page.evaluate(
      ({ url, at }) => window.__drawEngine!.insertEmbed(url, at.x, at.y),
      { url: link.url, at: middle },
    );
    const record = (verdict: string, detail = "", framed: string | null = null) => {
      results.push({
        n,
        provider: link.provider,
        pasted: link.url,
        expect: link.expect,
        framed,
        verdict,
        detail,
      });
      console.log(
        `${String(n).padStart(3)} ${verdict.padEnd(15)} ${link.provider.padEnd(16)} ${link.url.slice(0, 90)}${detail ? `  — ${detail}` : ""}`,
      );
    };
    if (!id) {
      record("refused");
      continue;
    }

    const iframe = page.locator('iframe[title="Embedded page"]');
    await expect(iframe).toHaveCount(1);
    const framed = (await iframe.getAttribute("src")) ?? "(srcdoc)";
    // Long enough for a player's script to have decided what it is showing.
    await page.waitForTimeout(6000);
    const frame = await frameFor(page);
    const text = frame ? await textOf(frame) : "";
    const blockedBy = messages.find((line) =>
      /refused to (display|frame)|frame-ancestors|x-frame-options/i.test(line),
    );
    const answer = documents.find((d) => !d.url.startsWith("about:"));
    const errorText = ERROR_TEXT.map((re) => re.exec(text)?.[0]).find(Boolean);

    await iframe
      .screenshot({
        path: path.join(
          OUT,
          `${String(n).padStart(3, "0")}-${link.provider.replace(/\W+/g, "_")}.png`,
        ),
      })
      .catch(() => undefined);

    if (frame?.url().startsWith("chrome-error:") || blockedBy) {
      record("blocked", blockedBy?.slice(0, 140) ?? frame?.url() ?? "", framed);
    } else if (answer && answer.status >= 400) {
      record(`http ${answer.status}`, answer.url.slice(0, 120), framed);
    } else if (errorText) {
      record(
        "provider error",
        `"${errorText}" — ${text.replace(/\s+/g, " ").slice(0, 120)}`,
        framed,
      );
    } else {
      record("ok", text.replace(/\s+/g, " ").slice(0, 80), framed);
    }
  }

  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const tally = new Map<string, number>();
  for (const r of results) tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);
  console.log(`\n${results.length} links:`, Object.fromEntries(tally));

  // The one hard rule: nothing that should be refused was framed.
  const leaked = results.filter((r) => r.expect === "refuse" && r.verdict !== "refused");
  expect(leaked, "framed a link that must be refused").toEqual([]);
});

test("YouTube's Error 153 is the missing referrer", async ({ page }) => {
  // The report this started from, reproduced without the app: the same player, framed
  // once as the board used to frame it and once as it does now.
  await openBoard(page, "embed-check-referrer");
  const src = "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1";
  const verdicts: Record<string, string> = {};
  for (const policy of ["no-referrer", "strict-origin-when-cross-origin"]) {
    await page.evaluate(
      ({ src, policy }) => {
        document.querySelectorAll("iframe[data-probe]").forEach((node) => node.remove());
        const iframe = document.createElement("iframe");
        iframe.dataset.probe = policy;
        iframe.src = src;
        iframe.referrerPolicy = policy as ReferrerPolicy;
        iframe.sandbox.add(
          "allow-scripts",
          "allow-same-origin",
          "allow-popups",
          "allow-presentation",
        );
        iframe.width = "560";
        iframe.height = "315";
        document.body.append(iframe);
      },
      { src, policy },
    );
    await page.waitForTimeout(6000);
    const handle = await page.locator(`iframe[data-probe="${policy}"]`).elementHandle();
    const frame = await handle?.contentFrame();
    const text = frame ? await textOf(frame) : "";
    verdicts[policy] = /error 153|configuration error/i.test(text) ? "Error 153" : "plays";
    await page
      .locator(`iframe[data-probe="${policy}"]`)
      .screenshot({ path: path.join(OUT, `referrer-${policy}.png`) })
      .catch(() => undefined);
  }
  console.log("YouTube by referrer policy:", verdicts);
});
