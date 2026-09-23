# drawnosaurus

A collaborative whiteboard. The drawing engine is [draw-engine](https://github.com/Univers42/draw-engine)
— Rust compiled to WebAssembly — running **in the browser**; drawnosaurus adds the part the engine
deliberately does not have: persistence, an HTTP contract, and a merge rule for concurrent editors.

```
SvelteKit (TS strict) ──HTTP /v1──▶ Fastify ──▶ MongoDB
   │                      │
   │                      └─ validate · reconcile · denormalise
   ├─ draw_engine_bg.wasm
   │    (scene, geometry, paint)
   └─ WS /ws ──▶ realtime-agnostic (engine/realtime)
        sealed live patches / cursors (AES-GCM room key in #room=)
```

The engine never talks to the network and the server never runs WASM. The only thing crossing
between them is an `.osidraw` scene document.

## Quickstart

Everything runs in Docker; there is no host Node requirement.

```sh
make all     # submodule → WASM → deps → quality gate → the running stack
make up      # mongo + api + web
make verify  # the full gate: typecheck, lint, format, unit tests, integration tests
make help    # every target
```

Then open **http://localhost:5273**. The API is on **http://localhost:4300**. Live
collaboration uses the realtime gateway at **ws://localhost:4402/ws** (engine/realtime).

> Host ports default to 5273/4300/27019/4402 instead of the usual 5173/4000/27017 because the sibling
> osionos stack already owns those. Override per invocation: `make up API_PORT=4500 WEB_PORT=5500 REALTIME_PORT=4502`.

`engine/src/wasmLoad.ts` imports the generated `engine/pkg/draw_engine.js`, which is gitignored build
output — absent from a fresh clone, and needed by the web build, the web image and the typecheck
alike. Every target that consumes it (`up`, `build`, `dev`, `typecheck`, `quality`) now declares it
as a prerequisite and builds it on demand, so a clean checkout goes straight to `make up`. `make
wasm` still forces a rebuild, which is what you want after touching the crate.

> **Rootless Docker.** `make wasm` passes `--user $(id -u):$(id -g)` only on a rootful daemon. Under
> rootless Docker, container root is already mapped to the invoking host user — the bind mount comes
> out host-owned unaided, and an explicit `--user` fails outright, because the host uid has no
> mapping inside the namespace. The Makefile detects which one it is talking to.

## Layout

```
engine/              git submodule → Univers42/draw-engine, pinned by SHA
apps/web/            SvelteKit, client-side only
apps/api/            Fastify + mongodb
packages/contract/   zod schemas + the reconcile/bounds primitives, shared by both
docker/              wasm · api · web Dockerfiles
```

`packages/contract` exists so the element schema and the merge rule are written once. Both apps are
thin glue over it, and the merge rule is unit-tested without a server or a database in the way.

## The engine submodule

Consumed as **TypeScript source through an alias**, not as an installed package — it ships no build
output. The alias is declared once, as `kit.alias` in `apps/web/svelte.config.js`, which SvelteKit
feeds to both Vite's resolver and the generated tsconfig so the bundler and the typechecker cannot
drift apart. `vite.config.ts` only adds `server.fs.allow`, without which the dev server refuses to
serve engine files from outside the project root.

Three things worth knowing before touching it:

- **Import deep paths, never the bare barrel.** `engine/src/index.ts` re-exports the engine's React
  adapter, which would drag `react` into a Svelte app that does not install it. eslint enforces this
  with a `no-restricted-imports` rule, so the failure is a lint error rather than a confusing
  resolve error. Use `@osionos/draw-engine/svelte`, `/json`, `/types`, `/engine`.
- **`wasm-bindgen-cli` must match the crate exactly.** `crates/draw-engine/Cargo.toml` pins
  `wasm-bindgen = "=0.2.128"`; a mismatched CLI produces glue that disagrees with the binary and
  fails in the browser, not at build time. `scripts/wasm-build.sh` reads the pinned version back out
  of the manifest and refuses to build on a mismatch.
- **The submodule URL is https, and CI checks out `submodules: true` — not `recursive`.** The engine
  is public so the default token suffices, but the engine itself has an SSH-URL submodule that a
  recursive checkout would try to fetch over SSH and fail on.

## HTTP API (v1)

| Method   | Path                        | Notes                                                                     |
| -------- | --------------------------- | ------------------------------------------------------------------------- |
| `GET`    | `/v1/boards?limit&cursor`   | Keyset pagination. Metadata only, never element arrays.                   |
| `POST`   | `/v1/boards`                | Creates a board, mints the slug. `201` + `Location`.                      |
| `GET`    | `/v1/boards/:slug`          | Full `.osidraw` envelope. `ETag: "<rev>"`.                                |
| `PUT`    | `/v1/boards/:slug`          | Full replace. `If-Match` **required** → `428` without it, `409` if stale. |
| `PATCH`  | `/v1/boards/:slug/elements` | The autosave path. Changed elements + tombstones, reconciled.             |
| `DELETE` | `/v1/boards/:slug`          | Soft delete.                                                              |
| `GET`    | `/healthz`, `/readyz`       | Liveness; readiness pings Mongo.                                          |

Every failure uses one envelope, `{ "error": { "code", "message" } }`, and nothing internal leaks
through it.

`PUT` demands a precondition because a full replace from a stale tab silently destroys newer work.
`PATCH` deliberately has none: it merges per element, so two writers converge instead of racing.

**Data model.** One document per board with its elements embedded, so a scene is a single read.
`bounds` and `elementCount` are denormalised on write, which is what lets the gallery show board
sizes without ever loading a scene. Indexes: `{ slug: 1 }` unique, and
`{ ownerId: 1, updatedAt: -1, _id: -1 }` matching the pagination sort exactly.

**Ownership** resolves in exactly one function (`apps/api/src/auth.ts`), and every repository query
is scoped by its result, so cross-owner access is impossible by construction rather than by review.

## Algorithms: what is reused and what is new

**Reused from the Rust core — not reimplemented.** The positional maths already exists and is
covered by the engine's own tests: `camera.rs` (`screen_to_world`, `zoom_at` keeping the cursor
anchored, `fit_bounds`), `interaction/shape_drag.rs` and `linear_drag.rs` (figure construction,
45° quantisation), `scene/geometry.rs` (`hit_test`, topmost-first with a world-unit tolerance),
`selection/{handles,transform,marquee}.rs` (rotated-anchor-preserving resize, rotation, marquee),
`interaction/snapping.rs` and `scene/binding.rs` (snapping, connector attach points),
`edit/{align,zorder,group,flip}.rs`.

**Genuinely new here, because the engine has no reason to have it:**

1. **Element-level last-write-wins** (`packages/contract/src/reconcile.ts`). Winner per id: higher
   `version`, tie broken by `versionNonce`, then `updated`. Comparing in that order means clock skew
   only ever decides a tie that the edit counts could not. Order-independent and idempotent, so
   retries and two open tabs converge.
2. **Dirty-set diff autosave** (`apps/web/src/lib/autosave/`). Three engine behaviours shape it, and
   each one is a test:
   - the engine's exported JSON **drops tombstones**, so a deletion arrives as an id that vanished
     and the tombstone the server's merge needs must be synthesised;
   - **undo can resurrect** a deleted element with its original stamp, which would lose against the
     tombstone already sent — so a resurrection is re-stamped to outrank it;
   - **z-order is array position** and the engine reorders without touching stamps, making a reorder
     invisible to a stamp diff. The client predicts the order the server will arrive at and sends an
     explicit `order` only when they disagree.
3. **Boundary validation** (`packages/contract/src/element.ts`). Non-finite coordinates, out-of-range
   opacity, unknown element types, oversized point arrays and element counts are all rejected;
   unknown keys are _stripped_ rather than rejected so a newer engine still writes successfully.
4. **Scene bounds on the server** (`packages/contract/src/bounds.ts`). A deliberate mirror of
   `scene/geometry.rs`, because that copy is compiled to WASM and the API has no WASM runtime. The
   semantics are pinned by tests — normalised negative extents, tombstones skipped, `null` (not a
   zero rect) for an empty scene — so drift fails a test instead of mis-framing a thumbnail.

**Deliberately not built yet:** a spatial index for hit-testing (the linear scan has no benchmark
against it) and CRDT/OT realtime collaboration (per-element LWW already covers multi-tab and offline
reconnect).

## Gates

`make verify` is the same thing CI runs. CI additionally builds both images and smoke-tests that the
API image actually boots and answers `/readyz` — a build alone does not prove that.

Measured on this machine, not estimated:

|                                    |                                            |
| ---------------------------------- | ------------------------------------------ |
| WASM build (cold, release)         | ~46s → `draw_engine_bg.wasm` 566,705 bytes |
| Unit tests                         | 66 (contract 30, api 17, web 19)           |
| Integration tests vs. real MongoDB | 25, ~2.8s                                  |
| Images                             | api 396MB, web 475MB, wasm builder 1.41GB  |

Integration tests run against a **real mongod**, never a mock: the unique index, the rev-guarded
write that makes concurrent patches safe, and keyset pagination are all database behaviours, and a
mock would only assert that the mock was called. They require `MONGO_URL` and fail loudly without it
rather than skipping, because a skipped test reads as a passing one.

The API has **no build step**. It runs TypeScript source directly under Node's type stripping, and
`tsconfig.base.json` sets `erasableSyntaxOnly` so the typechecker rejects any syntax that mode could
not handle (parameter properties, enums) instead of letting it fail at container start.

## Known gaps

- **Authentication is not implemented.** `AUTH_MODE=dev` maps every request to one owner, and
  `X-Owner-Id` lets a caller name any owner — useful for testing isolation, useless as security.
  `AUTH_MODE=bearer` **refuses to boot** rather than serve every board to everyone with an
  unimplemented verifier. Replacing it is a change to `resolveOwner` and nothing else.
- **`apps/web` relaxes two compiler flags** (`exactOptionalPropertyTypes`, `erasableSyntaxOnly`)
  because the engine submodule ships source and therefore lands inside this program's import graph;
  those flags would police a pinned dependency's internals. `apps/api` and `packages/contract` keep
  the full strict set. See the comment in `apps/web/tsconfig.json`.
- **The web typecheck currently reports one error from the pinned engine commit**:
  `engine/src/host/keys.ts` imports `DrawTool` from `../tools`, which only imports it privately
  (`TS2459`). The two-line upstream fix is to import it from `../types`; it is committed in the local
  draw-engine checkout but not yet pushed, so the pin here still predates it. `make typecheck` goes
  green once that commit is pushed and the submodule pin is bumped. Everything else in the gate —
  lint, format, 66 unit tests, 25 integration tests — is green today.
- Board titles are not editable after creation, and there is no export path (the engine has SVG/JSON
  export; nothing surfaces it yet).
