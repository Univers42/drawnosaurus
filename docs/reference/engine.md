# The engine submodule

`CLAUDE.md` points here. The engine is a **git submodule** (`engine/` →
[Univers42/draw-engine](https://github.com/Univers42/draw-engine)): Rust compiled to WASM,
running in the browser. This page is the list of ways that goes wrong, and it is deliberately
a list of _mechanisms_ rather than a list of files.

## `engine/pkg` is generated, and its rebuild rule is mtime-based

`engine/pkg/` is gitignored build output, **absent from a fresh clone**. The web build, the
web image and the typecheck all fail without it, so every target that consumes it declares
it as a prerequisite (`up`, `build`, `dev`, `typecheck`, `quality`, `test`, `test-e2e`,
`parity`, `fuzz-mermaid`).

The prerequisite is a real file, `ENGINE_PKG := engine/pkg/draw_engine.js`, with one rule:

```make
ENGINE_CRATE_SRC := $(shell find engine/crates engine/Cargo.toml engine/Cargo.lock \
	-name '*.rs' -o -name 'Cargo.toml' -o -name 'Cargo.lock' 2>/dev/null)

$(ENGINE_PKG): $(ENGINE_CRATE_SRC)
	@$(MAKE) --no-print-directory wasm
```

**So: those targets rebuild the bundle only when `engine/pkg/draw_engine.js` is missing or
older than _every_ `*.rs`, `Cargo.toml` or `Cargo.lock` under `engine/crates` — tests
included.** Two consequences, and the second is the one that costs the night:

- **`make wasm` is `.PHONY` and always rebuilds.** It has `submodules` as its only
  prerequisite. `wasm exit=0` in a gate log therefore _is_ evidence the bundle was rebuilt.
  Any claim that `make wasm` "short-circuits" is wrong about the target; what short-circuits
  is the prerequisite every _other_ target goes through.
- **A green `make quality`, `make dev` or `make up` is not evidence the bundle matches the
  Rust you have checked out.** The test is mtime, not content, and `git checkout` /
  `git merge` / `git submodule update` stamp mtimes at checkout time. A `pkg/` built from
  _different_ Rust can be mtime-newer than the sources that are on disk now, so every
  consumer target skips the rebuild and serves it anyway.

A **stale `engine/pkg` is indistinguishable from a real defect.** It reads as a merged branch
that broke: red tests, wrong geometry on the canvas, a fix that "didn't work". Before
debugging behaviour in a worktree, run `make stale` — and if the engine moved, `make wasm`
and re-run, rather than reading the failures as a product bug.

`make wasm` is also how you recover a `Permission denied` on `engine/pkg`: it was left
root-owned. Fix it with
`docker run --rm -v "$W/engine":/e alpine chown -R 1000:1000 /e/pkg` and rebuild. Never
build WASM through the engine's own compose file as root.

## It is consumed as TypeScript source, not as an installed package

The alias is declared **once**, as `kit.alias` in `apps/web/svelte.config.js`, and SvelteKit
feeds it to both Vite's resolver and the generated tsconfig:

```js
alias: { "@osionos/draw-engine": "../../engine/src" },
```

Do **not** add `paths` to `apps/web/tsconfig.json` — it would replace SvelteKit's own
aliases rather than merge with them. `vite.config.ts` adds only `server.fs.allow`
(`[engineSrc, enginePkg]`); without it dev 403s on files outside the project root.

**Import deep paths, never the bare barrel.** `engine/src/index.ts` re-exports a React
adapter (`export { DrawCanvas } from "./react/DrawCanvas"`), which would drag `react` into a
Svelte app that does not install it. An eslint `no-restricted-imports` rule turns that into
a lint error. The modules you may import are the top-level ones: `engine.ts`, `types.ts`,
`json.ts`, `cameraMath.ts`, `tools.ts`, `vectorize.ts`, `svelte.ts`, plus the `svelte/` and
`host/` directories — so `@osionos/draw-engine/svelte`, `/types`, `/json`, `/engine`,
`/cameraMath`, `/tools`, `/vectorize`, `/host/…`.

A `/camera` module is **gone**: it was a hand-kept TypeScript mirror of `camera.rs`, and its
four values are WASM exports now. What replaced it, and what the mirrored box does for a
mirrored element: `docs/reference/camera.md`.

## A unit test that needs the engine needs `engine/pkg`

The web's vitest suite runs in node, where the app's `loadDrawEngine()` cannot run — it is a
`fetch` of a sibling `.wasm`. So `apps/web/test/vitest.setup.ts` instantiates the module from
its bytes instead:

```ts
import { readFileSync } from "node:fs";
import { initSync } from "../../../engine/pkg/draw_engine.js";
const WASM = new URL("../../../engine/pkg/draw_engine_bg.wasm", import.meta.url);
initSync({ module: readFileSync(WASM) });
```

`make test` therefore depends on `engine/pkg`, as `make typecheck` already did, and CI's
`test` job takes the same artifact as `quality`. **Without it the whole suite fails at that
setup line, not at a case** — which looks like a total test failure, not a missing artifact.

## `wasm-bindgen-cli` must match the crate exactly

Pinned to `=0.2.128` in `engine/crates/draw-engine/Cargo.toml`. A mismatch produces glue
that disagrees with the binary and **fails in the browser, not at build time**.
`scripts/wasm-build.sh` reads the pin back out of the manifest and refuses to build on a
drift, so this is checked rather than hoped for. Do not bump the pin to chase a build error.

## Adding an engine method, every time

Five steps, and the one people skip is the test:

1. Rust, in the right module of `src/engine/…`, `src/scene/…` or `src/interaction/…`;
2. the wasm binding in `src/wasm/*.rs` (`camera_api.rs`, `convert_api.rs`, `edit_api.rs`,
   `input.rs`, `paint.rs`, `vectorize_api.rs`, …);
3. the TS wrapper in `engine/src/engine.ts` and its types in `engine/src/types.ts`;
4. a Rust test in `engine/crates/draw-engine/tests/ci_<area>.rs` — **red before the change,
   and demonstrate that it was red**;
5. commit it in the engine submodule, on your own `bunny/<task>` branch there.

## Never edit it from this repo

`engine/**` and `third_party/**` are both excluded in `eslint.config.js` and
`.prettierignore`. Engine fixes belong upstream, then bump the pointer.

## How it is checked out

CI uses `submodules: true`, deliberately **not** `recursive` — the engine carries its own
nested submodules (`engine/.gitmodules`: `realtime`, `claude-deal-with-the-devil`), so a
recursive checkout reaches past what this repository pins. For the same reason, use:

```sh
git fetch --no-recurse-submodules      # not --recurse-submodules
git submodule update --init engine     # not --recursive
```

> **Unverified, and worth checking before it is repeated:** the reason usually given for
> `--no-recurse-submodules` is that the engine carries an _SSH-only_ submodule. At the
> pinned checkout it does not — all three of `draw-engine`, `realtime` and
> `claude-deal-with-the-devil` are declared `https://github.com/Univers42/…` in their
> `.gitmodules`, and all three answer `git ls-remote` over https. Keep the flag; do not
> repeat that reason until someone has reproduced the failure it claims to explain.

A repo-local guard rail rewrites **push** URLs to a non-existent account
(`url.bunny-never-pushes:.pushinsteadof`), so an ordinary `git push` fails. That is
deliberate; do not edit it.
