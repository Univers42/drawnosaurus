# Commands

`CLAUDE.md` points here. Every target below is real: the table is `make help` output, and
`make help` reads the Makefile, so it cannot drift from it.

## Everything runs in Docker

The Makefile shells out to `docker compose`; there is no host Node requirement for any gate
target. The two exceptions are the targets that _deliberately_ run on the host —
`test-e2e`, `parity` and `parity-deps`, all of which need a browser or a yarn cache — and
`oracle`, which is only a `git clone`.

## The targets

| Command                              | What it does                                                                |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `make all`                           | submodule → WASM → deps → quality gate → running stack                      |
| `make help`                          | every target, read out of the Makefile                                      |
| `make up`                            | mongo + api + web behind the gateway, on `WEB_PORT`, plus realtime          |
| `make down`                          | stop and remove this worktree's containers                                  |
| `make logs`                          | tail the service logs                                                       |
| `make dev`                           | Vite + API + realtime hot stack, on the `DEV_*` ports                       |
| `make share` / `make unshare`        | put the running stack on the internet / take it off                         |
| `make verify`                        | everything CI runs: `quality` + the integration tests                       |
| `make quality`                       | `typecheck` + `lint` + `format` + `test`                                    |
| `make typecheck` / `lint` / `format` | the three halves of `quality`, on their own                                 |
| `make test`                          | unit tests: contract, api, web                                              |
| `make test-integration`              | API tests against a real MongoDB                                            |
| `make test-e2e`                      | Playwright **on the host** (runs `playwright install chromium` first)       |
| `make conformance`                   | the `prompt/*.md` coverage matrix                                           |
| `make fuzz-mermaid`                  | 1,000 seeds per Mermaid diagram type, ~35 min                               |
| `make wasm`                          | build `engine/pkg` from the Rust crate                                      |
| `make stale`                         | exits 1 if the running stack is not built from this checkout                |
| `make oracle`                        | fetch Excalidraw at `scripts/oracle-sha.txt` into gitignored `third_party/` |
| `make oracle-fixtures`               | re-derive the rough.js / text-wrap / flowchart / elbow-route fixtures       |
| `make parity-deps`                   | `make oracle`, then install Excalidraw's own yarn deps                      |
| `make parity`                        | the `perf/` benchmark, Excalidraw vs ours, both on localhost                |
| `make bench`                         | the engine's criterion benchmarks                                           |
| `make inspector-smoke`               | end-to-end check of the editor-inspector MCP server (needs `make dev`)      |
| `make submodules`                    | fetch `engine`, and `engine/realtime` inside it                             |
| `make install` / `make lock`         | install workspace deps / regenerate `pnpm-lock.yaml`                        |
| `make shell`                         | an interactive shell in the tooling container                               |
| `make clean`                         | containers, volumes, images, build output                                   |

`make oracle-fixtures` re-derives what we are held to: run it when the pin moves, **never**
to turn a red test green.

## Host ports

Non-standard, because a sibling stack owns the usual ones: **5273** (web), **5274**
(`SHARE_PORT`, the door other computers knock on), **4300** (api), **27019** (mongo),
**4402** (realtime), and **5373 / 4373 / 4473** for `make dev`'s web / api / realtime. The
browser suite's own Vite takes **5473**.

`make dev` gets a different set from `make up` on purpose, so a hot-reload server and the
built images can run side by side — otherwise starting one silently takes the other's port
and you debug the wrong build.

Override per invocation, never by editing the Makefile:

```sh
make up API_PORT=4500 WEB_PORT=5500 REALTIME_PORT=4502 SHARE_PORT=5504 MONGO_PORT=45017
```

## Running one test

Inside `make shell`, or on the host if you have the toolchain:

```sh
pnpm --filter @drawnosaurus/contract exec vitest run tests/reconcile.test.ts
pnpm --filter @drawnosaurus/web exec vitest run src/lib/autosave/sceneDiff.test.ts -t "resurrect"
pnpm --filter @drawnosaurus/api exec vitest run tests/integration/boards.test.ts   # needs MONGO_URL
pnpm exec playwright test e2e/zoom.spec.ts -g "the point under the cursor stays"
```

**Engine (Rust)** tests live in the submodule and use its own toolchain:

```sh
cd engine && make test      # cargo test + the host node:test suite, in Docker
cd engine && make quality   # rustfmt + clippy
make bench                  # criterion, from the repo root
```

One engine test file, which is what you want while building:

```sh
cd engine && docker compose run --rm --no-deps draw-engine \
  bash -c 'cargo fmt --all && cargo test -q -p draw-engine --test ci_<area>'
```

Give `COMPOSE_PROJECT_NAME` a distinct value per worktree or two stacks answer to one
project name. **It rejects dots** — `docker compose -p bunny.p17-docs config` fails with
`invalid project name "bunny.p17-docs": must consist only of lowercase alphanumeric
characters, hyphens, and underscores` — so name it `bunny-p17-<topic>`.
