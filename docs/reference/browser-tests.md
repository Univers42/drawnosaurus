# Browser tests

`CLAUDE.md` points here. Playwright, and the config exists to enforce one rule: **a browser
test is reproducible or it is worthless.** Every number below is in `playwright.config.ts`
unless it says otherwise.

## The config is the contract

**No retries, one worker, fixed 1280×800 viewport.** A flaky spec is a bug to fix, never to
retry. Kept out of `make quality` on purpose — the browser suite is not part of the gate.

## The rules a spec has to follow

- **No spec may need the API or Mongo.** Every spec stubs `/v1/**` and the websocket through
  `e2e/board.ts`.
- **Gestures start inside `OPEN_CANVAS`.** The chrome floats _over_ the canvas, so a gesture
  that starts under the toolbar, the inspector or the zoom bar is swallowed silently. Start
  inside it.
- **`focusBoard()` before pressing keys.** The key listener is on the editor, not the
  window. Then `clickElement()` to select — never remembered coordinates.
- **A transparent-background shape is hit on its outline only.**
- **A spec about where the camera lands** uses
  `page.emulateMedia({ reducedMotion: "reduce" })`, or `waitForCameraStable` /
  `waitForCameraLanded`. Without it the spec measures the animation, not the result.
- **CI's fonts differ from the Docker image's** (`monospace` is wider on CI), so never assert
  on font-metric pixel values.

## Two supporting pieces

`e2e/fixtures.ts` **fails any spec where the page threw.** That matters more than it looks: a
`todo!()` in the engine aborts the WASM module, and every later call fails with
`already mutably borrowed`, twenty lines from the actual cause. **That error message means
"an earlier call panicked the module", not "a borrow is wrong here".**

The specs read the engine through `window.__drawEngine`, set by `DrawSurface` only under
`import.meta.env.DEV`. It is a debugging affordance, not an API — and it is why the config
runs `vite dev` rather than a preview build.

## Input is real, with one exception

Input goes through CDP everywhere except `dispatchWheelAt`, which synthesises a `WheelEvent`
because `deltaMode` is set by the platform before the page sees it, and Chromium only ever
reports pixels. **Reach for a dispatched event only when the browser genuinely cannot produce
the input, and say why in situ.**

## Running it

`make test-e2e` runs Playwright **on the host** and runs `playwright install chromium` first.
It picks its browser cache as `$(or $(PLAYWRIGHT_BROWSERS_PATH),$(HOME)/.cache/ms-playwright)`,
and only redirects to `/sgoinfre/students/$USER/.cache/ms-playwright` when that directory
exists — which on this computer it does not, so here the cache is `$HOME/.cache/ms-playwright`.

The pinned Playwright image carries its own browsers at `/ms-playwright`, and running the
suite there is what the gate does. **The ways the host can break the suite — trace `ENOENT`
on this network filesystem, the 4.7G `$HOME` quota on the lab machines, and
`chromium-headless-shell` not being `chromium` — are all in `docs/reference/e2e-host.md`.
Read it before you believe a host failure found anything.**

The suite's own Vite takes port **5473** (`E2E_PORT`, `playwright.config.ts`), deliberately
not 4373, so it and `make dev` can run at once.
