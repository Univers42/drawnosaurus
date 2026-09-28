# Conventions and trip hazards

`CLAUDE.md` points here. The rules that are not about any one area of the product, and the
ways this checkout in particular misleads you.

## TypeScript is strict everywhere

`tsconfig.base.json` sets `strict`, `erasableSyntaxOnly` and `exactOptionalPropertyTypes` for
the whole workspace, and **`apps/api` and `packages/contract` keep the full set** — the API
has **no build step**. It runs TS source under Node's type stripping, so syntax that emits
code (parameter properties, `enum`) is rejected by tsc instead of failing at container start,
where the message says nothing useful.

`apps/web` relaxes `erasableSyntaxOnly` and `exactOptionalPropertyTypes`, and the reasons are
in its own `tsconfig.json`: the engine ships source into its import graph, and its Svelte
adapter assigns possibly-undefined values.

## Integration tests run against a real mongod, never a mock

`startTestApp()` (`apps/api/tests/integration/support/harness.ts`) **throws** when
`MONGO_URL` is unset — it does not skip. A skipped test reads as a passing one, which is the
failure this rule exists to prevent. Use `make test-integration`, which starts the compose
mongo first.

## A container left up while commits land keeps serving the old code

It looks exactly like a fix that didn't work. **Run `make stale` before debugging against
`make up`** — it compares the running images' stamps against the checkout and exits 1 if
they differ.

## `make dev` sets `VITE_USE_POLLING=1`, and that is not optional

This checkout is bind-mounted from a network filesystem where inotify does not reach.
Without polling, Vite serves what it compiled at startup — a silent failure that survives
rebuilds and looks like a change that was never made. The flag is set in the Makefile
(`dev:`) and read in `apps/web/vite.config.ts`.

## Dependencies are held for 7 days, and postinstall scripts are blocked

`minimumReleaseAge: 10080` (minutes) in `pnpm-workspace.yaml`, mirrored as
`minimum-release-age=10080` in `.npmrc`. `onlyBuiltDependencies` is just `esbuild`; anything
else wanting an install script has to be added deliberately, and **a new dependency needs the
owner's OK** on top of the age rule.

`wasm-bindgen` is pinned to `=0.2.128` and Mermaid to 11.12.2 (11.17 breaks the converter's
subgraphs). Don't bump either to chase a build error.

## Commits and branches

Conventional, lowercase, with a scope: `feat(toolbar): …`, `test(e2e): …`, `fix(web): …`.

By day, work lands on `feature/*` / `fix/*` branches merged into `develop`; `main` is the PR
target. On a night run the integration branch is `bunny/night` and every task merges into it.

## Never edit these from the app side

- **`engine/**` and `third_party/**`** — a submodule and a checkout, both excluded in
  `eslint.config.js` and `.prettierignore`. Fix upstream, bump the pointer.
- **`prompt/*.md`** — someone else's documents, and their line numbers are references the
  conformance parser reads.
- **`BUNNY.md`** — the laws. Propose a change in a report; do not edit the file.

## `scripts/oracle-sha.txt` is the pin

It holds the Excalidraw commit this project is held to for behavioural and visual parity
(`excalidraw=1118751f…`), plus the `rough.js` version Excalidraw pins. `make oracle` checks
that exact SHA out into gitignored `third_party/`. Bumping it is a deliberate act: regenerate
every fixture and re-run `make parity`.
