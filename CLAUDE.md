# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A collaborative whiteboard. The drawing engine is a **git submodule** (`engine/` →
[Univers42/draw-engine](https://github.com/Univers42/draw-engine)) — Rust compiled to WASM, running
in the browser. This repo adds what the engine deliberately lacks: persistence, an HTTP contract,
and a merge rule for concurrent editors.

```
apps/web (SvelteKit, TS strict) ──HTTP /v1──▶ apps/api (Fastify) ──▶ MongoDB
   └─ engine/pkg/draw_engine_bg.wasm              └─ validate · reconcile · denormalise
            (scene, geometry, paint)
      packages/contract — schemas + merge rule, shared by both
```

**The boundary rule:** the engine never talks to the network, the server never runs WASM. The only
thing crossing between them is an `.osidraw` scene document.

## Commands

Everything runs in Docker via the Makefile; there is no host Node requirement for the gate.
`make help` lists every target.

| Command                               | What it does                                             |
| ------------------------------------- | -------------------------------------------------------- |
| `make all`                            | submodule → WASM → deps → quality gate → running stack   |
| `make up`                             | mongo + api + web (web :5273, api :4300, mongo :27019)   |
| `make dev`                            | Vite dev server + API with hot reload on :5373 / :4373   |
| `make verify`                         | what CI runs: `quality` + integration tests              |
| `make quality`                        | typecheck + lint + format + unit tests                   |
| `make test` / `make test-integration` | unit tests / API tests against a real mongod             |
| `make test-e2e`                       | Playwright, **on the host** (installs chromium first)    |
| `make conformance`                    | the `prompt/*.md` coverage matrix                        |
| `make wasm`                           | force-rebuild `engine/pkg` after touching the Rust crate |
| `make shell`                          | bash in the tooling container                            |

Host ports are non-standard (5273/4300/27019/5373/4373) because a sibling stack owns the usual ones.
Override per invocation: `make up API_PORT=4500 WEB_PORT=5500`.

**Running one test.** Inside `make shell`, or directly on the host:

```sh
pnpm --filter @drawnosaurus/contract exec vitest run tests/reconcile.test.ts
pnpm --filter @drawnosaurus/web exec vitest run src/lib/autosave/sceneDiff.test.ts -t "resurrect"
pnpm --filter @drawnosaurus/api exec vitest run tests/integration/boards.test.ts   # needs MONGO_URL
pnpm exec playwright test e2e/zoom.spec.ts -g "the point under the cursor stays"
```

**Engine (Rust) tests** live in the submodule and use its own toolchain: `cd engine && make test`
(cargo test + the host node:test suite in Docker), `make quality` there for rustfmt/clippy.
`make bench` at the root runs the engine's criterion benchmarks.

## The engine submodule

- **`engine/pkg/` is generated, gitignored build output** and absent from a fresh clone. The web
  build, the web image and the typecheck all fail without it, so every target that consumes it
  (`up`, `build`, `dev`, `typecheck`, `quality`, `test-e2e`) declares it as a prerequisite and builds
  it on demand. `make wasm` is how you force a rebuild.
- **Consumed as TypeScript source through an alias**, not as an installed package. The alias is
  declared **once**, as `kit.alias` in `apps/web/svelte.config.js`, which SvelteKit feeds to both
  Vite's resolver and the generated tsconfig — do not add `paths` to `apps/web/tsconfig.json`, it
  would replace SvelteKit's own aliases rather than merge. `vite.config.ts` only adds
  `server.fs.allow`, without which dev 403s on files outside the project root.
- **Import deep paths, never the bare barrel.** `engine/src/index.ts` re-exports a React adapter that
  would drag `react` into a Svelte app that does not install it. An eslint `no-restricted-imports`
  rule turns that into a lint error. Use `@osionos/draw-engine/svelte`, `/types`, `/json`, `/engine`,
  `/camera`.
- **`wasm-bindgen-cli` must match the crate exactly** (`=0.2.128`). A mismatch produces glue that
  disagrees with the binary and fails in the browser, not at build time; `scripts/wasm-build.sh`
  reads the pin back out of the manifest and refuses to build on a drift.
- Never lint, format or edit `engine/**` or `third_party/**` from this repo — both are excluded in
  `eslint.config.js` and `.prettierignore`. Engine fixes belong upstream, then bump the pin.
- CI checks out `submodules: true`, deliberately **not** `recursive` — the engine carries an SSH-URL
  submodule a recursive checkout would fail on.

## Architecture

### `packages/contract` — the single source of truth

Zod schemas (`element.ts`, `board.ts`), the merge rule (`reconcile.ts`), scene bounds (`bounds.ts`),
limits. No Fastify, no Mongo, no DOM. Both apps are thin glue over it, so the element schema and the
merge rule exist once and are unit-tested without a server or a database in the way. Changes to the
wire format start here.

`bounds.ts` is a deliberate mirror of the engine's `scene/geometry.rs`, because that copy is compiled
to WASM and the API has no WASM runtime. Its semantics are pinned by tests so drift fails a test
rather than mis-framing a thumbnail.

### Autosave: the dirty-set diff

`routes/boards/[slug]/+page.svelte` keeps a plain `live: DrawElement[]` (never reads the DOM), fed by
`onSceneChange` which accepts either a `osidraw-delta` payload or a full scene. `SceneAutosaver` →
`SceneDiffTracker.diff()` (`apps/web/src/lib/autosave/`) produces the patch. Three engine behaviours
shape it, and each is a test:

1. exported JSON **drops tombstones**, so a deletion arrives as an id that vanished and the tombstone
   the server's merge needs must be synthesised;
2. **undo can resurrect** a deleted element with its original stamp, which would lose against the
   tombstone already sent — so a resurrection is re-stamped to outrank it;
3. **z-order is array position** and the engine reorders without touching stamps, so a reorder is
   invisible to a stamp diff. The client predicts the order the server will reach and sends an
   explicit `order` only on a mismatch.

The `send` callback must **not** swallow the rejection: the autosaver needs it to leave the patch
unacknowledged and arm the retry.

### Server: element-level last-write-wins

Winner per id in `reconcile.ts`: higher `version`, tie broken by `versionNonce`, then `updated` — in
that order, so clock skew only ever decides a tie the edit counts could not. Order-independent and
idempotent.

`PUT /v1/boards/:slug` **requires `If-Match`** (428 without, 409 if stale) because a full replace from
a stale tab destroys newer work. `PATCH /v1/boards/:slug/elements` — the autosave path — has no
precondition by design: it merges per element so two writers converge. `apps/api/src/boards/routes.ts`
is HTTP only; merge rules are in the contract, persistence in `repository.ts`.

Ownership resolves in exactly one function (`apps/api/src/auth.ts`) and every repository query is
scoped by its result, so cross-owner access is impossible by construction. `AUTH_MODE=dev` maps every
request to one owner; `AUTH_MODE=bearer` refuses to boot rather than serve everything to everyone.
Replacing auth is a change to `resolveOwner` and nothing else.

### Web app shape

`apps/web/src/lib/draw-chrome/` is the editor chrome. `DrawSurface.svelte` (~1k lines) is the
orchestrator that mounts the engine and owns tool/theme/selection state; everything testable is
factored into plain `.ts` modules beside it (`tools.ts`, `menu.ts`, `theme.ts`, `inspector.ts`,
`style.ts`, `camera.ts`, `shapeActions.ts`, …) each with a `.test.ts`. **Unit tests target the `.ts`
modules, not the Svelte components** — the components are covered by the browser specs. Follow that
split when adding behaviour.

`ExtendedTool = DrawTool | "sticky"` — only host-owned tools are named in `tools.ts`; re-listing the
engine's would fork the tool list and let the toolbar offer a tool `setTool` no longer accepts.

### The conformance gate

`prompt/design.md` and `prompt/shortkey.md` are the feature checklists this project is built against
(~2700 lines). `packages/conformance` parses **every line** of them and requires each to match a rule
in `src/registry.ts` — `covered` with named test files, `gap` with a reason, or `out-of-scope` with a
reason. The test also checks the named files exist and actually contain tests, that no rule is dead,
and prints the coverage percentage.

Consequences when working here: adding a line to `prompt/*.md` fails `make conformance` until a rule
is added (a recorded gap is a fine answer); renaming or deleting a test file named in the registry
fails it too. `prompt/` is in `.prettierignore` on purpose — reformatting would move every line number
in a failure message.

### Browser tests (`e2e/`)

Playwright, and the config exists to enforce that a browser test is reproducible or worthless: **no
retries, one worker, fixed 1280×800 viewport**, and no spec may depend on the API or Mongo — every
spec stubs `/v1/**` and the websocket in `e2e/board.ts`. Kept out of `make quality` on purpose.

- `e2e/fixtures.ts` fails any spec where the page threw. A `todo!()` in the engine aborts the WASM
  module and every later call fails with `already mutably borrowed`, twenty lines from the cause.
- The specs read the engine through `window.__drawEngine`, set by `DrawSurface` only under
  `import.meta.env.DEV` — a debugging affordance, not an API, and why the config runs `vite dev`
  rather than a preview build.
- `OPEN_CANVAS` is the canvas region with no floating chrome over it. The toolbar/inspector/zoom bar
  sit **on top of** the canvas, so a gesture starting under one is swallowed silently. Start gestures
  inside it; use `focusBoard()` before pressing keys (the key listener is on the editor container, not
  the window); use `clickElement()` rather than remembered coordinates, and remember a
  transparent-background shape is hit on its outline only.
- Input is real (CDP) everywhere except `dispatchWheelAt`, which synthesises a `WheelEvent` because
  `deltaMode` is set by the platform before the page and Chromium only ever reports pixels. Reach for
  a dispatched event only when the browser genuinely cannot produce the input, and say why in situ.
- Locally, trace writing can fail with `ENOENT` on `test-results/.playwright-artifacts-*` because this
  checkout is on a network filesystem — it fails the test it was tracing and looks like a flake. Add
  `--trace=off` when running by hand; CI runs on a normal disk where `retain-on-failure` is worth it.
- Browsers do **not** fit in `$HOME` on the lab machines — the quota is 4.7G and a chromium install is
  ~400M, so `playwright install` dies with `ENOSPC` and, worse, leaves the cache half-deleted, which
  reads as "Executable doesn't exist" on the next run. Export
  `PLAYWRIGHT_BROWSERS_PATH=/sgoinfre/students/$USER/.cache/ms-playwright` before installing or
  running; `/sgoinfre` has terabytes. Keep it set for both, or the suite installs to one place and
  looks in another.
- Playwright 1.63 launches `chromium-headless-shell` for `headless: true`, which is **not** the same
  binary as `chromium`. Forcing the full build with `channel: "chromium"` is a valid workaround for a
  missing shell, but it is a different renderer: it failed four `bucket`/`eraser` specs that pass on
  both builds of the shell. Take a control run before believing a failure found that way.

## Conventions and trip hazards

- **TypeScript is strict everywhere** (`tsconfig.base.json`), including `erasableSyntaxOnly` — the API
  has **no build step**, it runs TS source under Node's type stripping, so syntax that emits code
  (parameter properties, enums) is rejected by tsc instead of failing at container start. `apps/web`
  relaxes `erasableSyntaxOnly` and `exactOptionalPropertyTypes` **only** because the engine ships
  source into its import graph; `apps/api` and `packages/contract` keep the full set.
- **Integration tests run against a real mongod, never a mock**, and fail loudly without `MONGO_URL`
  rather than skipping — a skipped test reads as a passing one.
- `make dev` sets `VITE_USE_POLLING=1`: this checkout is bind-mounted from a network filesystem where
  inotify does not reach, and without polling Vite serves what it compiled at startup — a silent
  failure that survives rebuilds and looks like a change that was never made.
- Dependencies are held for 7 days (`minimumReleaseAge` in `pnpm-workspace.yaml`, mirrored in
  `.npmrc`); postinstall scripts are blocked except for an `esbuild` allowlist.
- Commits are conventional and lowercase with a scope — `feat(toolbar): …`, `test(e2e): …`,
  `fix(web): …`. Work lands on `feature/*` / `fix/*` branches merged into `develop`; `main` is the PR
  target.
- `scripts/oracle-sha.txt` pins the Excalidraw commit this project is held to for parity. `make
oracle` fetches it into gitignored `third_party/`; `make oracle-fixtures` re-derives what we are
  held to — run it when the pin moves, never to turn a red test green.
