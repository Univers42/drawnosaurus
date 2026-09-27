# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. **Read all of it.** It is
deliberately short: it is the index and the list of traps, not the reference.

## What this is

A collaborative whiteboard. The drawing engine is a **git submodule** (`engine/` →
[Univers42/draw-engine](https://github.com/Univers42/draw-engine)) — Rust compiled to WASM,
running in the browser. This repo adds what the engine deliberately lacks: persistence, an
HTTP contract, and a merge rule for concurrent editors.

```
apps/web (SvelteKit, TS strict) ──HTTP /v1──▶ apps/api (Fastify) ──▶ MongoDB
   └─ engine/pkg/draw_engine_bg.wasm              └─ validate · reconcile · denormalise
            (scene, geometry, paint)
      packages/contract — schemas + merge rule, shared by both
```

**Two boundaries, and everything else follows from them.** The engine never talks to the
network; the server never runs WASM. The only thing crossing between them is an `.osidraw`
scene document. And the engine owns the render data — the front end draws chrome from what
the engine returns and turns clicks into engine calls, so the front may not compute a
position, a size or a bound. Sharing across computers goes through **one** origin, the
`gateway`, and who is asking is decided by the entrance a connection arrived at, never by a
header. Which file owns which of those: `docs/reference/architecture.md`. What a person sees:
`docs/collaboration.md`.

## The index

| Read this                               | For                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docs/reference/architecture.md`        | which module owns what: the gateway, the contract, the autosave diff, the merge rule, live holds, the web app's shape |
| `docs/reference/commands.md`            | every `make` target, the host ports, how to run one test                                                              |
| `docs/reference/engine.md`              | `engine/pkg`, the alias, deep imports, the WASM pin, and why a green gate can still be serving an old engine          |
| `docs/reference/conformance.md`         | the `prompt/*.md` ledger, and what fails `make conformance`                                                           |
| `docs/reference/browser-tests.md`       | the Playwright config's contract, and the rules a spec has to follow                                                  |
| `docs/reference/conventions.md`         | strict TS, the 7-day dependency hold, the never-edit list                                                             |
| `.claude/skills/canvas-engine/SKILL.md` | camera maths, the keyboard bindings, the frame budget                                                                 |
| `docs/reference/shortcuts.md`           | which chord reaches the board, when an open overlay stops it, and where the focus goes when that overlay closes       |
| `docs/reference/<area>.md`              | one page per area — camera, selection, text, resize, zorder, binding, mermaid, groups, images, palette…               |

## Durable gotchas

These are mechanisms, not conventions. Each has cost this project hours.

- **A green WASM step is not evidence the bundle is current.** The rebuild rule is
  _mtime_: `engine/pkg/draw_engine.js` is rebuilt only when it is missing or older than every
  `*.rs` under `engine/crates`, tests included — so `make quality`, `make dev` and `make up`
  will happily serve a `pkg/` built from different Rust, because a checkout stamps mtimes at
  checkout time. `make wasm` is `.PHONY` and always rebuilds; it is the only unconditional
  one. `docs/reference/engine.md`.
- **A stale `engine/pkg` is indistinguishable from a real defect.** It reads as a merged
  branch that broke — red tests, wrong geometry, a fix that "didn't work". Run `make stale`,
  and if the engine moved, `make wasm` and re-run, before believing the failures.
- **A container left up while commits land keeps serving the old code.** `make stale` before
  debugging against `make up`.
- **`COMPOSE_PROJECT_NAME` rejects dots** — `bunny.p17-docs` fails with _invalid project
  name_. Use `bunny-p17-<topic>`.
- **`git worktree remove` refuses any worktree containing a submodule** — `fatal: working
trees containing submodules cannot be moved or removed`, exit 128. Every worktree here has
  one, so "remove the merged worktrees" needs `--force`, and `--force` is destructive.
- **Merge the engine before the root pointer.** The root records a SHA; if the engine merge
  has not landed, the root points the owner's checkout at a commit the tree is not on. And
  **it is two repos**: pushing only the root publishes a tree whose `engine` gitlink resolves
  to a commit the engine remote has never seen, and the owner's `submodule update` fails.
- **A failed `cd` does not stop the script.** `cd /no/such/path` exits 1, prints an error and
  leaves the shell where it was — so every command after it runs in the _previous_ directory,
  and the next one reads the wrong repository. In a `sh -c` or a Makefile recipe nobody sees
  the line above. Check the path, or `cd … || exit 1`.
- **A figure measured on a task branch is a delta, never a total.** Measured in isolation and
  reported as an absolute, repeatedly. Read the arithmetic on the merged tree.
- **A number in a comment or a doc is a claim about a past state.** It was true when written.
  Re-measure before you repeat one, and prefer a function name to a line number in prose that
  will outlive the change.
- **`git fetch --no-recurse-submodules`**, and `git submodule update --init engine` without
  `--recursive`.

## Laws, restated because breaking one is expensive

- **The engine owns the render data.** Every scene computation — geometry, layout, hit
  testing, snapping, bindings, what is painted and where, camera maths, scene formats — is
  Rust. The web app only shows what the engine returns and forwards what the user does. The
  one sanctioned mirror is `packages/contract/src/bounds.ts`. Adding an engine method is five
  steps, not one: `docs/reference/engine.md`.
- **Excalidraw is the spec; never guess UX.** The oracle is pinned at `1118751f`
  (`scripts/oracle-sha.txt`, `make oracle` fetches it). Cite what you port as
  `path@1118751f:lines`. If the oracle does not do what a checklist line asks for, that is a
  design decision, not an implementation.
- **UNKNOWN = FAIL.** A claim needs a command with its output, or a `file:line`. A warning is
  an error. A skipped test is not a passed test. A figure measured on a task branch is a
  delta, never a total — that wants to be a gate step.
- **Never touch `prompt/*.md`, `engine/**`, `third_party/**` or `BUNNY.md`.** The first is
  someone else's document and its line numbers are references; the second and third are a
  submodule and a checkout; the fourth is the laws, which are changed by proposal, in a
  report.
- **Work on your own `bunny/*` branches, and never push `develop` or `main`.** Releasing is
  the owner's job. A repo-local guard rail rewrites push URLs to a non-existent account on
  purpose; do not edit it.

## What a test is for

Unit tests target the `.ts` modules beside `DrawSurface.svelte`, not the Svelte components —
the components are covered by the browser specs. Engine behaviour gets a Rust test in
`engine/crates/draw-engine/tests/ci_*.rs`; anything a person does with a mouse or keyboard
gets an `e2e/*.spec.ts`. `DrawSurface.svelte` has grown past 2,400 lines: a new testable
behaviour goes in a `.ts` module beside it, not in the orchestrator. A new chord goes into
`apps/web/src/lib/draw-chrome/shortcutRegistry.ts` with a proof in `shortcutRegistry.test.ts`.

**Red first, and demonstrate it.** A test that passes before the change proves nothing; the
single most persistent defect in this project is a green test that cannot fail for the reason
it claims.
