import type { Browser, BrowserContext, Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { openBoard, relay } from "./board.ts";

/**
 * Who the Share dialog says is on the board: "Collaborator avatars" and "User list" in
 * `prompt/design.md:1618,1626`, both rendered by the one block in
 * `DrawShareModal.svelte:262-281` — a row per collaborator, the sharer's own row first,
 * and a "N online" badge over them.
 *
 * The registry called this "implemented, untested" (`registry.ts:2511-2524`), and in one
 * sense that was wrong in the other direction: the list rendered, so the count and the
 * names were there, and nothing said what they should *be*. Four things a person can
 * check, each asserted here as a whole so no half-rendered block can satisfy it:
 *
 * - **who is listed, under what name** — the sharer's own row reads "You (Host)", and
 *   everyone else appears under the name they announced, not one the dialog made up;
 * - **the avatars, and the boundary** — one per person including the sharer, every one
 *   rendered, and nothing folded into a "+N" (`DrawShareModal.svelte:272-279` renders
 *   every peer; the only boundary is the list's own `max-height: 150px`, so it scrolls);
 * - **someone leaving** — the row goes, the badge counts down, and no stale name lingers
 *   (`realtimeClient.ts:623-636` drops a peer on the server's `gone`);
 * - **the empty case** — a board nobody else has joined, which is a list of one and the
 *   easiest thing in this file to pass without ever exercising.
 *
 * Two clients are two browser contexts on one relay, the pattern `e2e/peers.spec.ts` and
 * `e2e/share.spec.ts` already use: `relay()` stands in for the API's live route and
 * `openBoard`'s `hash` puts the second page in the first one's room.
 *
 * What this does **not** pin, and why: a peer who goes silent without a goodbye (tab
 * crash, network drop) is swept by `PEER_STALE_MS = 45_000` on a 10s timer
 * (`realtimeClient.ts:108-109,735-748`), so the earliest honest check of it is 55s —
 * past this config's 30s test timeout, with no knob to shorten it. A test that waited
 * out a wall clock on a shared machine is a flaky test, and a flaky spec is a bug to fix
 * rather than retry. That line is left open on purpose.
 *
 * One thing a reader should know before believing the leave test: `relay()` does announce
 * a closing socket as `gone` (`e2e/board.ts:248-251`), but Playwright's
 * `WebSocketRoute.onClose` does not fire when the *page* closes, so that path is never
 * reached from a spec. Measured, not assumed: with the guest's tab closed and 8s waited
 * out, the host still showed the guest's cursor — and the cursor went the moment that same
 * `gone` frame was handed to the host by hand. So the leave test hands it over itself.
 */

const VIEWPORT = { width: 1280, height: 800 } as const;

/** The name the sharer themselves is listed under — `DrawShareModal.svelte:268-270`. */
const HOST_ROW = "You (Host)";

/** A "+N" the list folded its tail into, if it ever did. */
const FOLDED = /(^|\D)\+\s*\d+/;

/**
 * A name nobody typed. `getCollaboratorProfile` makes one per browser session and
 * writes it to `sessionStorage` (`realtimeClient.ts:157-171`); nothing in the app asks a
 * person for their own, so "Dino 417" is the whole of what a joiner announces.
 */
const GENERATED_NAME = /^Dino \d{3}$/;
const GENERATED = "<generated>";

interface Joiner {
  context: BrowserContext;
  page: Page;
  /** A page error is a failed assertion in a spec that never asked for one. */
  thrown: string[];
}

/** The host's board, and the room key its fragment carries for anyone joining it. */
async function hosting(page: Page) {
  const live = relay();
  // The host's own connection, kept so a departure can be announced to it. `relay()`
  // numbers its sockets in the order they join and says "gone" about one when it
  // closes — but Playwright's `WebSocketRoute.onClose` does not fire when the *page*
  // closes (`e2e/board.ts:248-251` is therefore never reached in a spec), so the frame
  // the server would send is sent here instead. Only the server's half is simulated;
  // the page's half, which is the untested part, is real.
  let host: WebSocketRoute | undefined;
  let joined = 0;
  const join = (socket: WebSocketRoute) => {
    joined += 1;
    if (joined === 1) host = socket;
    live.join(socket);
  };
  const board = await openBoard(page, "e2e", { live: join });
  const hash = new URL(page.url()).hash;
  expect(hash, "the sharer got no room key, so no colleague can ever reach them").toMatch(
    /^#room=/,
  );
  /** What a server sends when the connection numbered `id` drops. */
  const gone = (id: number) => host?.send(`{"type":"gone","socket":"${id}"}`);
  return { live, board, hash, gone };
}

/**
 * A second person, in a context of their own — `getCollaboratorProfile` reads the name
 * from `sessionStorage` once and never asks again (`realtimeClient.ts:157-171`), so two
 * pages sharing a context would answer to the same name.
 */
async function joining(
  browser: Browser,
  live: ReturnType<typeof relay>,
  hash: string,
  name: string,
): Promise<Joiner> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript((who) => sessionStorage.setItem("drawnosaurus:userName", who), name);
  const page = await context.newPage();
  const thrown: string[] = [];
  page.on("pageerror", (error) => thrown.push(error.message.split("\n")[0] ?? String(error)));
  await openBoard(page, "e2e", { live: live.join, hash });
  return { context, page, thrown };
}

async function openShare(page: Page): Promise<void> {
  // The one page this spec stubs beyond `openBoard`'s: `/v1/share` answers the dialog's
  // links, and it is told a full `ShareInfo` the way `e2e/share.spec.ts` tells it —
  // `DrawShareModal.svelte:94` reads `info?.tunnel.state`, and a `200 {}` from anything
  // that is not the API kills the dialog outright (reported, not fixed here).
  await page.route("**/v1/share", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lan: [{ origin: "http://c2r19s1.42madrid.com:5273", over: "wired" }],
        public: null,
        tunnel: { state: "off" },
        canManage: true,
      }),
    }),
  );
  await page.getByRole("button", { name: /share/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/**
 * The whole "Active Collaborators" block, read at once.
 *
 * Count, names, badge and avatars together, so no assertion can pass because one of them
 * arrived before another: a count of 2 with the second name still missing is not a
 * people list, it is a race this spec would otherwise be reading as a pass. Every
 * assertion below is on this object, never on a bare count.
 */
async function peopleBlock(page: Page) {
  const section = page.locator('[role="dialog"] .peers-section');
  const text = (values: string[]) => values.map((value) => value.trim());
  return {
    rows: await section.locator(".peer-item").count(),
    names: text(await section.locator(".peer-item .name").allTextContents()),
    avatars: text(await section.locator(".peer-item .avatar").allTextContents()),
    online: ((await section.locator(".count-badge").textContent()) ?? "").trim(),
    /** True when the list has hidden people behind a "+N". */
    folded: FOLDED.test(((await section.textContent()) ?? "").trim()),
  };
}

/** What the block must say, given these people — the host first, then the rest. */
function expected(...names: string[]) {
  return {
    rows: names.length + 1,
    names: [HOST_ROW, ...names],
    // The sharer's own avatar is the literal "You"; everyone else's is their name's
    // first two letters, upper-cased — so the initials come from the name and not from
    // the client id, which is what makes them worth asserting.
    avatars: ["You", ...names.map((name) => name.slice(0, 2).toUpperCase())],
    online: `${names.length + 1} online`,
    folded: false,
  };
}

test("a board nobody else has joined lists the sharer alone", async ({ page }, testInfo) => {
  const { board } = await hosting(page);
  await openShare(board.page);

  await expect
    .poll(() => peopleBlock(board.page), {
      message: "the empty people list is not one row, or the badge does not say so",
    })
    .toEqual(expected());
  // Spelled out because `expected()` with no names is the degenerate case this file is
  // most able to pass without ever looking at: a list of nothing, counted as correct.
  expect((await peopleBlock(board.page)).names).toEqual([HOST_ROW]);
  await board.page.screenshot({ path: testInfo.outputPath("01-empty-board.png") });
});

test("someone who joins is listed under the name they announced, while the dialog is open", async ({
  page,
  browser,
}, testInfo) => {
  const { live, board, hash } = await hosting(page);
  await openShare(board.page);
  expect((await peopleBlock(board.page)).names, "the list was not empty to begin with").toEqual([
    HOST_ROW,
  ]);

  const guest = await joining(browser, live, hash, "Ruth Okonkwo");
  try {
    await expect
      .poll(() => peopleBlock(board.page), {
        message: "the sharer's open dialog never picked the person who joined up",
      })
      .toEqual(expected("Ruth Okonkwo"));
    expect(guest.thrown, "the person who joined saw an error").toEqual([]);
    await board.page.screenshot({ path: testInfo.outputPath("02-one-joiner.png") });
  } finally {
    await guest.context.close();
  }
});

test("every collaborator gets a row, and the list folds nobody into a count", async ({
  page,
  browser,
}, testInfo) => {
  // Four people is past the block's own `max-height: 150px` (four rows of a 26px avatar
  // plus gaps), which is the only boundary this dialog has.
  test.slow();
  const { live, board, hash } = await hosting(page);
  await openShare(board.page);

  const names = ["Ruth Okonkwo", "Sam Ferreira", "Wren Aoki"];
  const guests: Joiner[] = [];
  try {
    for (const name of names) guests.push(await joining(browser, live, hash, name));
    await expect
      .poll(() => peopleBlock(board.page), {
        message: "the list did not reach one row per collaborator",
      })
      .toEqual(expected(...names));
    for (const guest of guests)
      expect(guest.thrown, "a person on the board saw an error").toEqual([]);
    await board.page.screenshot({ path: testInfo.outputPath("03-four-people.png") });
  } finally {
    for (const guest of guests) await guest.context.close();
  }
});

test("someone who leaves is dropped from the list, not left behind in it", async ({
  page,
  browser,
}, testInfo) => {
  const { live, board, hash, gone } = await hosting(page);
  await openShare(board.page);
  const guest = await joining(browser, live, hash, "Ruth Okonkwo");
  try {
    await expect
      .poll(() => peopleBlock(board.page), { message: "the joiner was never listed" })
      .toEqual(expected("Ruth Okonkwo"));

    // A tab closed, as one does, and the server said so: `gone`, naming the connection
    // that went. The guest is the second socket to join, so it is connection "2".
    gone?.(2);

    await expect
      .poll(() => peopleBlock(board.page), {
        message: "the sharer's open dialog kept someone who had left",
      })
      .toEqual(expected());
    expect((await peopleBlock(board.page)).names, "a stale row lingered").not.toContain(
      "Ruth Okonkwo",
    );
    expect(guest.thrown, "the person on the board saw an error").toEqual([]);
    await board.page.screenshot({ path: testInfo.outputPath("04-after-leaving.png") });
  } finally {
    await guest.context.close();
  }
});

/**
 * Pinned as it is, not as it should be.
 *
 * The block renders its first row as "You (Host)" for whoever has it open, with nothing
 * to tell the sharer from a guest (`DrawShareModal.svelte:268-270`), so a person who
 * arrived through a shared link is told they are the host while the actual host sits in
 * the list below them under a generated name. A test asserting the correct wording would
 * leave a red bar for whoever fixes it; this one records today's behaviour, so the fix
 * has to be a deliberate change rather than a silent one.
 */
test('a guest\'s own row says "You (Host)", and the host is listed beside them', async ({
  page,
  browser,
}, testInfo) => {
  const { live, hash } = await hosting(page);
  const guest = await joining(browser, live, hash, "Ruth Okonkwo");
  try {
    await openShare(guest.page);
    // Polled rather than read once: the guest learns of the host from a frame that may
    // still be in flight when the dialog opens. The host's name is masked, because it is
    // generated per browser session and cannot be predicted.
    const masked = () =>
      peopleBlock(guest.page).then((block) => ({
        ...block,
        names: block.names.map((name, at) => (at === 0 ? name : GENERATED)),
      }));
    await expect
      .poll(masked, {
        message: "the guest's list never reached one row for the host",
        timeout: 10_000,
      })
      .toEqual({
        rows: 2,
        names: [HOST_ROW, GENERATED],
        // "DI" — the initials of "Dino …", which is where they come from.
        avatars: ["You", "DI"],
        online: "2 online",
        folded: false,
      });
    const seen = await peopleBlock(guest.page);
    // The guest's own row reads "You (Host)"…
    expect(seen.names[0], "the guest's own row").toBe(HOST_ROW);
    // …while the host is in the list beside them, under the name the host announced —
    // a generated one, because nothing in the app lets a person type their own.
    expect(seen.names.slice(1), "the host, as the guest sees them").toHaveLength(1);
    expect(seen.names[1], "the host is listed under a generated name").toMatch(GENERATED_NAME);
    expect(seen.online).toBe("2 online");
    await guest.page.screenshot({ path: testInfo.outputPath("05-guest-view.png") });
  } finally {
    await guest.context.close();
  }
});
