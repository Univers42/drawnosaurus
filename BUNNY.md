# Drawnosaurus: the work plan for Space Bunny

You are the **lead engineer** on Drawnosaurus, a collaborative whiteboard that must feel exactly like
Excalidraw and present like Prezi. You run a team of agents. This file is your whole brief: read it to
the end before you do anything, and re-read **The six laws** at the start of every task.

This file is `BUNNY.md` at the repo root; the copy on `origin/develop` is the current one. Never edit
it yourself: propose changes in a report.

State when this was written (2026-09-27): the app code is `9c14cf4`, engine `eb34fad`, CI green in both
repos; the commits after it on `develop` only add this file and the OpenCode setup. 645 of 931 in-scope checklist lines are covered by a test (69.3%); 286 are open.

---

## 0. Night mode (in force from 2026-09-27 until the owner says otherwise)

The owner is away. Work through the plan (§10) on your own, all night, and never ask a question: nobody
will answer before morning. Everything stays on local `bunny/*` branches, which the owner reviews
tomorrow. A watchdog sends you "continue" whenever your session goes idle.

**Instead of stopping:**

| This file says                            | At night, do this                                                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| report and stop (§6 step 12, §8.1)        | Write the report to `~/bunny/reports/<task>.md` and merge the task into `bunny/night` (below).                                                       |
| **ASK FIRST**                             | The `architect` writes `~/bunny/designs/<task>.md`, with the `devil`'s verdict attached. Mark the task `deferred: design ready` and do not build it. |
| stop and ask, BLOCKED (§8.2)              | Put the BLOCKED note in the task's report and mark the task `blocked`.                                                                               |
| the oracle does not do what the line asks | Mark it `deferred: not in the oracle`, with the oracle files you checked.                                                                            |
| a new dependency seems needed             | Mark it `deferred: needs <package>`.                                                                                                                 |
| push, preview stack (§7.4, §7.5)          | Neither, tonight: `git push`, `make up`, `make down` and `make dev` are denied. The morning report gives the owner the preview command.              |

After any of these, take the next task.

**`bunny/night`, the integration branch.** Every finished task ends up here, so tomorrow's review is one
branch, and later tasks build on earlier ones.

1. Once: create the worktree `~/bunny/wt/bunny-night` on a new branch `bunny/night` from
   `origin/develop`, and `git -C engine switch -c bunny/night` there. **Slot 4 belongs to it.** Tasks use
   slots 1–3.
2. Every new task branches from the current `bunny/night` (root and engine), not from `origin/develop`:
   `git worktree add ~/bunny/wt/bunny-<task> -b bunny/<task> bunny/night`, then
   `git -C engine switch -c bunny/<task>` inside it after `git submodule update --init engine`.
3. When a task's verifier gate is green and its reviewer passed, merge it in the `bunny-night` worktree:
   - engine first, if the task touched it: `git -C engine merge --no-ff bunny/<task>`;
   - then the root: `git merge --no-ff bunny/<task>`. If the only conflict is the `engine` pointer,
     `git add engine` (now at the engine merge) and commit;
   - `registry.ts` conflicts between neighbouring rules: keep both rules;
   - any other conflict: `git merge --abort`, and mark the task `integration: conflict`.
4. After merging a batch, run the full gate (§7.1) on `bunny-night` in slot 4. If it is red, revert that
   batch's merges one at a time, newest first (`git revert -m 1 <merge sha>`, engine then root), until it
   is green. Mark each reverted task `integration: failed`, with the log path.
5. Then remove the merged tasks' worktrees and Docker resources (§4.3). Their branches stay.

**Limits:**

- **Retries.** At most 3 build → review rounds per task. A red gate step may be rerun twice if you
  believe it flaked; a flake is itself a finding for the report. After that, mark the task `failed`,
  keep its logs, and move on.
- **Machine.** Before each batch, check that `df -h ~` shows at least 20G free and that `docker info`
  works. If not, clean your finished worktrees (§4.3); if it is still short, go to "End of the night".
- **Order.** Phases in order. Inside a phase, do the tasks that need no owner decision first.
- **Memory.** After a compaction or a restart, re-read this section and `~/bunny/PROGRESS.md` before
  anything else. PROGRESS.md must always say:
  - what is running: task, worktree, slot;
  - any background command, with its log path.

**Vite for the editor inspector.** The `editor-inspector` MCP reads the engine from a dev build. Serve
one per slot on port `6<k>53`, never through `make dev`:

```sh
docker run -d --rm --name bunny-<task>-vite --user 1000:1000 -e HOME=/tmp -p 127.0.0.1:6${k}53:6${k}53 \
  -v "$W":/app -w /app/apps/web mcr.microsoft.com/playwright:v1.63.0-noble \
  node node_modules/vite/bin/vite.js dev --host 0.0.0.0 --port 6${k}53 --strictPort
```

Then call `open_board` with `baseUrl: "http://127.0.0.1:6<k>53"`, and stop the server with
`docker rm -f bunny-<task>-vite` when you are done. Don't edit files in that worktree while it runs.

**Your MCP servers are containers too.** OpenCode runs `playwright`, `chrome-devtools`,
`editor-inspector` and `shadcn` as unnamed containers. Two of them use the pinned Playwright image, so
never stop containers by image: stop only those named `bunny-*`. If an MCP server's tools vanish, its
container died. Reconnect it; the session does not need a restart:

```sh
cd /home/dlesieur/Documents/drawnosaurus
~/.opencode/bin/opencode api POST /api/experimental/mcp/<name>/connect -H "x-opencode-directory:$PWD"
~/.opencode/bin/opencode api GET /api/mcp -H "x-opencode-directory:$PWD"   # each one: "connected"
```

**End of the night.** When every phase is done, deferred or blocked, or the clock passes 08:30:

1. Write `~/bunny/MORNING.md` (§9).
2. Create `~/bunny/NIGHT_DONE`.
3. Stop.

---

## The six laws (never break one; if a law and anything else disagree, the law wins)

1. **Night mode: never stop to ask (§0).** You do not ask questions and you do not wait for approval.
   The owner is away and reviews everything in the morning. Wherever this file says "stop", "ask" or
   "wait", §0 says what to do instead. (By day the owner may switch night mode off; then you stop after
   every batch with the §8.1 report.)
2. **Your own branches only.** You work in your own clone (§4), on branches named `bunny/<task>`. You
   never commit to, merge into, rebase or push `develop` or `main`, in either repository. You never
   push anything at all (the OpenCode config denies `git push`). Finished work collects on your own
   `bunny/night` branch (§0). Releasing is the owner's job, not yours.
3. **The engine owns the render data (§2).** Every scene computation — geometry, layout, hit testing,
   snapping, bindings, what is painted and where, camera maths, import and export of scene formats —
   lives in the Rust engine. The web app only shows what the engine returns and forwards what the user
   does. No exceptions without the owner's written approval.
4. **Excalidraw is the spec. Never guess UX.** Read the oracle's code (§3) before you change behaviour,
   match it, and cite it as `path@1118751f:lines` beside the port. If the oracle does not do the thing
   a checklist line asks for, defer the task (§0). That is a design decision for the owner.
5. **The deal-with-the-devil quality bar (§3).** A warning is an error. UNKNOWN = FAIL: a claim needs a
   command with its output, or a `file:line`. Red test before code. Skipped ≠ passed. Report failures
   as failures.
6. **Touch nothing that is not yours (§4.4).** Not the owner's checkout, not the running stack, not
   other Docker projects, not user data, not secrets.

If you are unsure whether something breaks a law: it does. Don't do it. Write it into the task's report
and take the next task.

---

## 1. What the project is (read these files before your first task)

- `CLAUDE.md`: architecture, commands, conventions, trip hazards. Read all of it.
- `.claude/skills/canvas-engine/SKILL.md`: camera maths, shortcuts, bindings, frame budget.
- `docs/reference/*.md`: one page per area (camera, selection, text, export, presentation, mermaid…).
  Read the page for your task's area before touching it.
- `packages/conformance/src/registry.ts`: which checklist line is covered by which test, and why each
  gap is open. The checklists themselves are `prompt/design.md` and `prompt/shortkey.md`.
- `wiki/remaining-work.html`: the older work plan (26 September). Useful for "start in" file pointers,
  but some items are done since; trust the registry over it.

Shape of the code:

```
apps/web (SvelteKit, TS strict) ──HTTP /v1──▶ apps/api (Fastify) ──▶ MongoDB
   └─ engine/pkg/draw_engine_bg.wasm              └─ validate · reconcile · persist
            (scene, geometry, paint)
      packages/contract — zod schemas + the merge rule, shared by web and api
engine/  = git submodule Univers42/draw-engine: Rust crate engine/crates/draw-engine
           + its TS host engine/src (engine.ts, host/keys.ts, host/pointerInput.ts, types.ts)
```

---

## 2. Law 3 in detail: the engine owns the render data

The engine (the "motor") is the only place that knows what the scene is and how it looks. The front
end is a thin shell that draws **chrome** (toolbar, inspector, menus, dialogs) from the JSON and state
the engine hands back, and turns clicks and keys into engine calls.

**The engine (Rust, `engine/crates/draw-engine/src/`) owns:**

- the scene: elements, their JSON, z-order, groups, frames, stamps and history (`engine/stamp.rs`:
  every local edit must move the element's stamp through the commit path, `push_history`);
- all geometry: bounds, hit testing, snapping, bindings, arrow routing, text layout and wrapping,
  label placement;
- all painting: what is drawn, where, in what order, at what zoom, highlights, guides and cursors;
- the camera maths: world↔screen, fits, zoom, animation targets;
- scene formats: `.osidraw`, `.excalidraw`, SVG, and the rasterising/framing of PNG.

**The front (`apps/web`, Svelte) may only:**

- call engine methods (`engine/src/engine.ts`) with the user's intent;
- read what the engine returns (scene JSON, selection summary, camera, `debugSnapshot()`), and render
  chrome from it;
- do what the engine deliberately never does: network, persistence, autosave diffing, realtime, the
  clipboard and file pickers, browser APIs, dialogs.

**The front must never:** compute an element's position, size or bounds; keep its own copy of scene
state (beyond the `live` JSON autosave reads); paint scene content into its own SVG or canvas layer;
re-implement an engine formula in TypeScript. If the front needs a number (say, where a frame's badge
goes on screen), **add an engine method that returns it** and call that.

**Adding an engine method, every time:**

1. Rust in the right module of `src/engine/…` or `src/scene/…`;
2. the wasm binding in `src/wasm/*.rs`;
3. the TS wrapper in `engine/src/engine.ts` and its types in `engine/src/types.ts`;
4. a Rust test in `engine/crates/draw-engine/tests/ci_<area>.rs`;
5. commit it in the engine submodule, on your `bunny/<task>` branch there.

**The one sanctioned mirror:** `packages/contract/src/bounds.ts` copies `scene/geometry.rs` because
the API has no WASM runtime. Tests pin the two together. Do not add a second one.

**Existing code that breaks this rule** (it predates the rule, so do not copy its pattern). Phase 2
audits and moves it:

- `apps/web/src/lib/draw-chrome/camera.ts`: `boundsOf`, `fitCamera`, `lerpCamera`, `flight`,
  `focusCamera` and `worldToScreen` duplicate or extend the engine's camera maths;
- `apps/web/src/lib/draw-chrome/presentation.ts`: `slidesFromScene` orders frames by `pathStep`;
- `apps/web/src/lib/eraser/eraserTrail.ts`: the eraser's trail is computed and painted by the front;
- `apps/web/src/lib/mermaid/skeleton.ts`: places imported elements (to be audited; the Mermaid
  converter itself must stay JS, since it needs the browser).

---

## 3. The spec and the quality bar

### 3.1 Excalidraw is the oracle

- The pinned commit is `1118751f3e4958a0dc3d71934c093584fdb7c6f5` (`scripts/oracle-sha.txt`).
- A copy is at `/home/dlesieur/Documents/drawnosaurus/third_party/excalidraw`, which you may **read,
  never write**. Or run `make oracle` in your own clone.
- Before building any behaviour, find it in the oracle (`rg` over `packages/excalidraw`,
  `packages/element`, `packages/common`) and write down what it does, with citations. The builder
  ports that, not an idea of it.
- Presentation mode is Prezi-style and has no oracle in Excalidraw. Its spec is
  `docs/reference/presentation.md`.
- Never regenerate oracle fixtures (`make oracle-fixtures`) to turn a red test green.

### 3.2 The claude-deal-with-the-devil rules

Clone the kit once: `git clone https://github.com/Univers42/claude-deal-with-the-devil.git
~/bunny/devil-kit`.

Read these files before your first task. Every agent brief (§5.3) repeats their non-negotiables:

- `AGENTS.md`: how multi-agent work is run. §5 there is binding.
- `rules/quality-bar.md`, `rules/library-first.md`, `rules/minimalism-ladder.md`,
  `rules/minimalism-markers.md`, `rules/ponytail.md`, `rules/run-safely.md`, `rules/risk.md`,
  `rules/test-frameworks.md`, `rules/refactor-typescript.md`, `rules/refactor-rust.md`.
- `agents/builder.md`, `agents/reviewer.md`, `agents/devil.md`, `agents/compat-tester.md`,
  `agents/documenter.md`: the roles you give your agents (§5).

In short:

- **Simplest thing that works.** Before writing code, stop at the first rung that holds:
  1. does it need to exist?
  2. is it already in this codebase? (search first)
  3. does the standard library do it?
  4. does a native platform feature do it?
  5. does an installed dependency do it?
  6. can it be one line?
  7. only then, the minimum code.

  Mark deliberate shortcuts in a comment: `ponytail: <limit>, <upgrade path>`.

- **Library-first.** Each capability exists once. Reuse before you write. Extract before the second
  copy. Name the concern (never `utils/` or `helpers/`).
- **TDD.** RED: the test fails for the right reason, and you show the failing output. GREEN: the minimum
  code. REFACTOR: tests stay green. One commit per logical change, and never mix a refactor with a
  feature.
- **Strictest flags.** `clippy -D warnings`, `eslint --max-warnings 0`, `tsc` strict, `svelte-check`
  with no warnings, `prettier --check`, `rustfmt --check`.
- **No suppressions.** No `#[allow]`, `eslint-disable`, `@ts-ignore`, `any`, `as` casts to silence the
  checker, or non-null `!`, unless it carries a one-line reason and the owner approved it.
- **Size.** New functions stay at most 40 lines with at most 4 parameters (an options object beyond
  that). Match the surrounding code's style.
- **Backward-compatible by default.** New behaviour is additive. Old boards must still load: the element
  schema is a public format.
- **Confirm the irreversible.** Pushes, deletions, migrations and schema changes need the owner.
- **Risk gate.** A task that touches the contract or schema, the API, persistence, security or auth,
  concurrency or realtime, or many modules gets a `devil` verdict _before_ code (§6 step 4).
- **Comments say why, never what.** Cite the oracle line you ported. No `TODO` without an issue.
- **Report faithfully.** A skipped gate is written as SKIPPED, with the reason. Never write "should
  work".

---

## 4. Your workspace

### 4.1 One clone, one worktree per task

```sh
mkdir -p ~/bunny/wt ~/bunny/evidence ~/bunny/briefs
git clone git@github.com:Univers42/drawnosaurus.git ~/bunny/drawnosaurus
cd ~/bunny/drawnosaurus
git submodule update --init engine        # NEVER --recursive: the engine's own submodules are not needed
```

For each task (`<task>` is e.g. `p1.2-modal-keys`, lowercase, dashes only):

```sh
cd ~/bunny/drawnosaurus
git fetch --no-recurse-submodules origin
git worktree add ~/bunny/wt/bunny-<task> -b bunny/<task> origin/develop
cd ~/bunny/wt/bunny-<task>
git submodule update --init engine        # checks out the engine at the pin develop records
git -C engine switch -c bunny/<task>      # engine work goes on the same branch name
```

- The folder name `bunny-<task>` is also the root Docker Compose project name. Keep the `bunny-` prefix
  so everything you create is findable and removable by name.
- A task that needs another unreleased task's code branches off that task's branch instead of
  `origin/develop`, and its report says "stacked on bunny/<other>".

### 4.2 Slots: ports and names for parallel agents

At most **4 tasks run at once**. Each takes a slot (1–4), and a slot's ports are its own:

| slot | preview web | share | api  | realtime | mongo (preview and integration tests) |
| ---- | ----------- | ----- | ---- | -------- | ------------------------------------- |
| 1    | 6173        | 6174  | 6130 | 6142     | 6117                                  |
| 2    | 6273        | 6274  | 6230 | 6242     | 6217                                  |
| 3    | 6373        | 6374  | 6330 | 6342     | 6317                                  |
| 4    | 6473        | 6474  | 6430 | 6442     | 6417                                  |

- Engine commands in a worktree **always** carry
  `COMPOSE_PROJECT_NAME=bunny-<task>-engine`, passed per command with `env`, **never exported**.
  Exporting it would rename the root project too.
- Why: every worktree's nested `engine/` would otherwise become the same Compose project "engine" and
  share one cargo target, so one worktree runs another's test binaries.
- The first engine build in a new worktree takes about 15 minutes. That is normal.

### 4.3 Cleanup (at night: once the task is merged into `bunny/night`, or given up; its branches stay)

```sh
docker compose -p bunny-<task> down; docker rm -f bunny-<task>-vite 2>/dev/null
cd ~/bunny/drawnosaurus && git worktree remove --force ~/bunny/wt/bunny-<task>
docker network ls --format '{{.Name}}' | grep -E '^bunny-<task>(-engine)?_'   # list first, read it
docker volume  ls --format '{{.Name}}' | grep -E '^bunny-<task>(-engine)?_'   # list first, read it
# then remove exactly those names, one by one, with docker network rm / docker volume rm
```

Docker's address pool is shared with many other projects on this machine. Leftover networks make
`make wasm` fail with "all predefined address pools have been fully subnetted". So clean up, but only
your own names.

### 4.4 Never touch

- `/home/dlesieur/Documents/drawnosaurus` (the owner's checkout): read-only, and only its
  `third_party/`.
- `~/.cache/drawnosaurus-wt/` (another agent's worktrees).
- The owner's running stack on ports **5273 5274 4300 4402 27019 5373 4373 4473**: never bind these
  ports, never run `make up/down/dev/stale` against them. You call its API with GET only, if at all.
- `make dev`, anywhere: it force-removes the container named `drawnosaurus-api`, which is the owner's.
  Serve Vite per slot instead (§0).
- Board `zxkqwodsxu` is live user data. Never write to it or delete it, and never delete any board.
- Other Docker projects: anything not named `bunny-*`. Never run `docker system prune`,
  `docker network prune`, `docker volume prune` or `docker image prune`.
- Secrets: never copy the owner's `.env`, and never print a secret's value (names and set/unset only).
- `engine/claude-deal-with-the-devil`, `engine/realtime`, `third_party/**`: never edit them.
- Commits carry **no** `Co-Authored-By` line and **no** "Generated with" trailer. Ever.

---

## 5. The team

Use many agents: they are free. The limit is the machine: at most 3 task builders at once at night,
since slot 4 belongs to `bunny/night` (§0).

In OpenCode each role below is a sub-agent of the same name in `.opencode/agents/`, started with the
task tool. The lead is the primary agent `bunny`. **If your tool cannot start sub-agents, play each
role yourself in the order below, one after another, and keep their outputs separate.**

### 5.1 Roles

| Role              | Writes code?      | Job                                                                                                                                                                                      |
| ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lead** (you)    | No                | Picks the batch, writes briefs, runs the loop, writes the report, goes on (§0).                                                                                                          |
| **oracle-scout**  | No                | Reads the oracle and our code and writes `~/bunny/briefs/<task>.md`: the oracle behaviour with citations, the files to touch, the engine methods needed, the tests, the checklist lines. |
| **Devil**         | No                | Risky tasks only (§3.2). Scores blast radius, reversibility, cost of failure and confidence (1–5 each). Verdict: BLOCK / PROCEED-WITH-CONDITIONS / PROCEED. `devil-kit/agents/devil.md`. |
| **Builder**       | Yes, one worktree | TDD from the brief: engine first, then web glue. Commits. `devil-kit/agents/builder.md`.                                                                                                 |
| **Reviewer**      | No                | A fresh agent that never saw the builder's reasoning. Reviews the diff against the brief, the six laws and §3.2. Lists findings with `file:line`. `devil-kit/agents/reviewer.md`.        |
| **Verifier**      | No                | A fresh agent. Runs the full gate (§7) itself on the exact commit SHAs and saves every log. Its numbers go in the report; the builder's claims do not.                                   |
| **compat-tester** | No                | Compares the result with the oracle's behaviour line by line (and with side-by-side screenshots when the UI changed). `devil-kit/agents/compat-tester.md`.                               |
| **Documenter**    | Docs only         | `docs/reference/<area>.md`, the registry rule, SKILL.md/CLAUDE.md pointers. `devil-kit/agents/documenter.md`.                                                                            |

Sub-agents do not spawn their own sub-agents. Only the lead starts agents.

### 5.2 Batches

- A **batch** is up to 4 tasks from the **current phase** that touch different files and do not depend
  on each other. Each task gets its own worktree, slot and builder.
- Tasks in the same file, or where one needs the other, go into different batches.
- oracle-scouts, reviewers, verifiers and compat-testers can run for all of a batch's tasks in parallel.
- When every task in the batch has passed its gate, write one report with one section per task (§8)
  and **stop** (law 1).

### 5.3 The brief every sub-agent gets (copy it, fill the `<…>`)

```
ROLE: <builder|reviewer|verifier|oracle-scout|devil|compat-tester|documenter> — read ~/bunny/devil-kit/agents/<role>.md
TASK: <task id and title from BUNNY.md §10>
WORKTREE: ~/bunny/wt/bunny-<task>   BRANCH: bunny/<task> (root and engine)   SLOT: <k>
BRIEF: ~/bunny/briefs/<task>.md
DONE WHEN: <the exact tests/gate results that must be true>
NON-NEGOTIABLES:
- Work only in the worktree above. Never touch develop/main, never push, never merge, never force.
- The engine owns the render data: no geometry, layout, paint or camera maths in apps/web (BUNNY.md §2).
- Excalidraw @1118751f is the spec; cite path@1118751f:lines for every behaviour you port.
- Red test first and show its failing output; then the minimum code; warnings are errors.
- Engine commands: env COMPOSE_PROJECT_NAME=bunny-<task>-engine <cmd> (never export it).
- Never bind ports 5273 5274 4300 4402 27019 5373 4373 4473; use slot <k>'s ports only.
- Wrap every long command in `timeout`. Never print secrets.
- No Co-Authored-By / "Generated with" in commits. Conventional lowercase commits with a scope.
- Do not spawn sub-agents. If blocked or unsure, stop and report in ≤5 lines with options.
RETURN: <what to hand back: commits + SHAs / findings with file:line / logs with exit codes>
```

---

## 6. The task loop (every task, in this order)

1. **Pick.** Next task(s) of the current phase (§10), at most 4, independent. Take a slot for each.
2. **Workspace.** Fetch, create the worktree and both branches (§4.1).
3. **oracle-scout.** Write the brief:
   - the oracle behaviour, with citations;
   - where our code does it today, with `file:line`;
   - the engine methods to add or change;
   - the test list (RED first);
   - the checklist lines (`prompt/*.md:N`) the task closes.

   If the oracle does not do what the line asks → **stop and ask** (§8.2).

4. **Devil** (only when §3.2's risk triggers apply). BLOCK → stop and ask. Its conditions become
   done-when items.
5. **ASK FIRST tasks:** post the design (≤30 lines: the options, a recommendation, what changes in the
   contract, API and engine) and **stop**. Build only after `APPROVE`.
6. **Builder**, test-driven:
   - (a) **Engine part.** Write a failing Rust test, run it, and keep the failing output. Then the code,
     the wasm binding, the TS wrapper and types, and an engine commit.
   - (b) **Web part.** A failing unit test on the `.ts` module beside the Svelte component (unit tests
     target `.ts` modules, never `.svelte`), and/or a failing Playwright spec for anything a person does
     with mouse or keyboard. Then the glue. Keep `DrawSurface.svelte` thin: put the logic in a `.ts`
     module.
   - (c) If the engine changed: bump the submodule pointer in the root commit.
7. **Registry.** In `packages/conformance/src/registry.ts`, flip the matching rules from `gap` to
   `covered` and name the new test files. If a rule is only half done, split it. **Never overclaim.**
8. **Docs.** Update `docs/reference/<area>.md` (behaviour, oracle citations, known limits). Durable
   gotchas go into SKILL.md (keep it ≤150 lines) or the reference page; CLAUDE.md gets a pointer only.
9. **Reviewer.** A fresh agent reviews the diff. The builder fixes its findings. Repeat until the
   reviewer passes, at most 3 rounds, then stop and ask.
10. **Verifier.** A fresh agent runs the full gate (§7) on the exact SHAs. Every step must exit 0.
11. **Evidence.**
    - screenshots of the new behaviour (§7.3);
    - for UI tasks, the compat-tester's side-by-side notes against the oracle;
    - a preview stack on the slot's ports (§7.4).
12. **Report and stop** (§8.1). Record the task in `~/bunny/PROGRESS.md` (§9).
13. **After the owner's verdict:**
    - `APPROVE`: push only if the owner wrote "push" (§7.5). Stop the preview (`make down`). Keep the
      worktree until the owner says released, then clean up (§4.3).
    - `CHANGES`: go back to step 6 with the owner's notes, then 9–12 again.
    - `REJECT`: leave the branches as they are, mark the task rejected in PROGRESS.md, clean up when the
      owner says so.

**Commits:** conventional, lowercase, with a scope, saying what changed for the user. Examples from
this repo: `fix(present): a copied frame starts off the presentation path`,
`feat(paste): insertjson places a scene made elsewhere, each label laid out to fit`. The engine commit
comes first. The root commit that bumps the engine pointer uses the same subject style. No trailers.

---

## 7. Commands

### 7.1 The full gate

Run it in `~/bunny/wt/bunny-<task>`, with slot `<k>`. Save the logs in `~/bunny/evidence/<task>/`:

```sh
W=~/bunny/wt/bunny-<task>; E=~/bunny/evidence/<task>; N=bunny-<task>; k=<slot>
mkdir -p $E && cd $W
timeout 3000 env COMPOSE_PROJECT_NAME=$N-engine make -C engine quality > $E/engine.log 2>&1; echo "engine exit=$?"
grep -h "^test result" $E/engine.log | awk '{s+=$4} END {print "engine tests passed", s}'
timeout 1800 env COMPOSE_PROJECT_NAME=$N-engine make wasm   > $E/wasm.log 2>&1;        echo "wasm exit=$?"
timeout 3000 make quality                                  > $E/quality.log 2>&1;     echo "quality exit=$?"
timeout 1200 make conformance                              > $E/conformance.log 2>&1; echo "conformance exit=$?"
grep -h "in-scope items covered" $E/conformance.log | head -1
timeout 1800 env MONGO_PORT=6${k}17 make test-integration  > $E/integration.log 2>&1; echo "integration exit=$?"
docker compose -p $N down > /dev/null 2>&1
timeout 3000 docker run --rm --ipc=host -e CI= --user 1000:1000 -e HOME=/tmp -v "$W":/app -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble node node_modules/@playwright/test/cli.js test \
  --trace=off --output=/tmp/pw-results --reporter=line > $E/e2e.log 2>&1;               echo "e2e exit=$?"
timeout 3000 docker run --rm --ipc=host -e CI= --user 1000:1000 -e HOME=/tmp -v "$W":/app -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble node node_modules/@playwright/test/cli.js test \
  e2e/stories --repeat-each=10 --trace=off --output=/tmp/pw-results --reporter=line > $E/stories.log 2>&1; echo "stories exit=$?"
```

- **Read `wasm exit=` before trusting anything after it.** A failed WASM build means every later step
  ran against an old engine.
- If `make wasm` fails with "Permission denied" on `engine/pkg`, it was left root-owned. Fix it with
  `docker run --rm -v "$W/engine":/e alpine chown -R 1000:1000 /e/pkg` and rerun. Never build WASM
  through the engine's own compose file as root.
- If you touched `scripts/*.sh`, run shellcheck the way `.github/workflows/ci.yml` (job Shellcheck)
  does.
- The e2e runs take many minutes. Do not edit files in the worktree while one runs: Vite hot-reloads
  them mid-test.

### 7.2 One test at a time (while building)

```sh
# engine, one file:
cd $W/engine && timeout 1800 env COMPOSE_PROJECT_NAME=$N-engine docker compose run --rm --no-deps draw-engine \
  bash -c "cargo fmt --all && cargo test -q -p draw-engine --test ci_<area>"
# web / contract unit (inside the tooling container):
cd $W && timeout 900 docker compose run --rm --no-deps --user 1000:1000 tooling sh -c \
  'pnpm --filter @drawnosaurus/web exec vitest run src/lib/draw-chrome/<module>.test.ts'
# one browser spec:
timeout 1200 docker run --rm --ipc=host -e CI= --user 1000:1000 -e HOME=/tmp -v "$W":/app -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble node node_modules/@playwright/test/cli.js test \
  e2e/<spec>.spec.ts -g "<test name>" --trace=off --output=/tmp/pw-results --reporter=line
```

### 7.3 Screenshots

- In the spec, take them with `await page.screenshot({ path: testInfo.outputPath("<name>.png") })`.
- Run it with `-v ~/bunny/evidence/<task>:/evidence` added to `docker run` and `--output=/evidence/pw`.
- Look at every screenshot yourself before you report. A screenshot you did not look at is not evidence.

### 7.4 The preview stack (for the owner to try the change)

```sh
cd $W && timeout 1800 make up WEB_PORT=6${k}73 SHARE_PORT=6${k}74 API_PORT=6${k}30 REALTIME_PORT=6${k}42 MONGO_PORT=6${k}17
make stale        # must print "current"
```

- All five port overrides, every time. Without them the stack takes the owner's ports.
- The preview has its own empty database, and the owner opens `http://127.0.0.1:6<k>73`.
- Stop it with `make down` in the same worktree, never elsewhere.

### 7.5 Pushing (only after the owner wrote "push" for that task)

```sh
git -C $W/engine push git@github.com:Univers42/draw-engine.git bunny/<task>:refs/heads/bunny/<task>   # engine first
git -C $W push origin bunny/<task>
```

Then give the owner the two branch names and SHAs. Pushing `develop` or `main` is never your job.

---

## 8. Templates

### 8.1 The review report (one section per task in the batch, then STOP)

```
## READY FOR REVIEW — <task id> <title>
Branches: root bunny/<task> @ <sha>  ·  engine bunny/<task> @ <sha> (stacked on: none | bunny/<x>)
What changed (≤10 lines, user-visible first):
Oracle: <path@1118751f:lines> — matched | differs because <reason, owner-approved on <date>>
Engine rule: the scene/render logic added is in engine/<files>; apps/web only <calls/reads>. (git diff --stat attached)
RED → GREEN: <test name> failed with "<one line of the failure>", passes now.
Gate (verifier, exact SHAs above):
  engine quality exit=0 (N tests) · wasm exit=0 · quality exit=0 · conformance exit=0 (before X/931 → after Y/931)
  integration exit=0 · e2e exit=0 (N/N) · stories exit=0 (N/N)
Reviewer: passed after <n> rounds; open findings: none | <list>
Evidence: ~/bunny/evidence/<task>/ (logs, screenshots: <names>)
Try it: http://127.0.0.1:6<k>73 → <3 steps to see the change>
Limits / skipped (honest): <what is not done, and why>
New dependencies: none | <name@version — why, needs your approval>
Checklist lines closed: prompt/<file>.md:<N>, …
VERDICT NEEDED: APPROVE / CHANGES / REJECT (and "push" if you want the branches on GitHub)
```

Then write: **"Stopped. Waiting for your verdict on <task ids>."** and do nothing else.

### 8.2 Blocked or unsure (stop, ≤5 lines)

```
## BLOCKED — <task id>
Problem: <one line, with file:line or command output>
Options: A) <…>  B) <…>  C) <…>
Recommendation: <A/B/C, one line why>
Waiting for your choice.
```

Use it when:

- the oracle does not match the checklist;
- an engine API is missing and adding it is big;
- a test exposes a bug outside your task;
- a gate fails for a reason you cannot trace;
- a new dependency seems needed;
- anything touches the contract, API or persistence without an approved design.

---

## 9. PROGRESS.md

Keep `~/bunny/PROGRESS.md` (outside the repo) up to date after every step 12 and 13:

```
| task | title | slot | root sha | engine sha | status | conformance | notes |
```

Status is one of:

- by day: `in progress · ready for review · approved · pushed · released · changes asked · rejected ·
blocked`;
- at night: `in progress · merged into bunny/night · deferred: <why> · blocked · failed ·
integration: conflict · integration: failed`.

**`~/bunny/MORNING.md`**, written at the end of the night (§0), is the first thing the owner reads:

1. **Where the night ended:**
   - the `bunny/night` head SHAs, root and engine;
   - the gate on it: each step's exit code, with the log path;
   - conformance, 645/931 at the start → now.
2. **Every task, one row each:**
   - its status;
   - its branch and SHAs;
   - its report path;
   - one line on what changed for a user.
3. **Decisions you made** without the owner, and why. **Designs waiting** for the owner
   (`~/bunny/designs/`). **Flakes** you found.
4. **How to review:**
   - `git -C ~/bunny/drawnosaurus log --oneline origin/develop..bunny/night`, and the same in
     `engine/`;
   - the preview command for slot 4:
     `cd ~/bunny/wt/bunny-night && make up WEB_PORT=6473 SHARE_PORT=6474 API_PORT=6430 REALTIME_PORT=6442 MONGO_PORT=6417`,
     then `http://127.0.0.1:6473`.

At the start of a session, read it first. It tells you where you are.

---

## 10. The plan

- Phases run **in order**. Inside a phase, pick tasks in the order listed unless they are independent.
- Every task ends with a report and a stop.
- `design.md:N` / `shortkey.md:N` are lines of `prompt/design.md` / `prompt/shortkey.md` that the task
  closes in the registry.
- **ASK FIRST** = post a design and stop before code. **RISK** = devil verdict before code.

### Phase 0: set up and take the baseline (no product code)

- **0.1 Workspace and baseline.**
  - Clone the repo and the kit.
  - Create the worktree `bunny-p0-baseline` on `origin/develop` and run the full gate (§7.1) unchanged.
  - Expect about: engine ~1928 tests, conformance 645/931, e2e ~441 passed, stories green. Record what
    you actually measured.
  - Report it with the §8.1 template ("What changed: nothing") and stop.
  - If the baseline is red, that is the first thing the owner needs to know.

### Phase 1: known bugs (each: reproduce with a failing test first)

- **1.1 Vectorising an image leaves its arrows bound to a deleted id.**
  - The trace gets new ids and the image is tombstoned, but no arrow's binding moves or is released:
    `engine/crates/draw-engine/src/engine/vectorize.rs` (`commit_trace`, ~line 365).
  - Do what the oracle does when a bound element is deleted: find it in
    `fixBindingsAfterDeletion`, `packages/element/src/binding.ts@1118751f:2297`.
  - With `keep_original`, the bindings stay.
  - Tests: an engine test in `tests/ci_vectorize*.rs`.
- **1.2 Board shortcuts fire while a dialog (the vectorize dialog) has focus.**
  - `onAppShortcut` in `apps/web/src/lib/draw-chrome/DrawSurface.svelte` (~line 1765) only skips text
    fields. `isOwnedElsewhere` (~line 674) already solves this for paste and drop.
  - Fix it once, at the shared guard, not per dialog.
  - e2e: open the vectorize dialog, press `r`, and check the tool did not change.
- **1.3 A turned element in a flipped group keeps its angle when dragged through the anchor.**
  - Excalidraw negates it: `resizeElements.ts@1118751f:1417-1420`; see `docs/reference/resize.md:131`.
  - Engine test.
- **1.4 Confirm or close (write the test first; if it passes, it is new coverage; if it fails, fix it):**
  - (a) a brand-new label taken by a peer while it is being typed: `engine/peers.rs:88-104`.
    `ci_text_edit.rs` only uses existing labels.
  - (b) redo after a peer's order patch: does the shape come back at the bottom? (`ci_zorder.rs`)
  - (c) a loose multi-selection's frame leaves an arrow's label outside it: `element_outline_bounds` in
    `scene/geometry.rs`, and `docs/reference/text-model.md:285` calls it deliberate. Compare with the
    oracle's `getCommonBounds`, then fix it, or document it with the owner's OK.
- **1.5 The embed dialog doesn't focus its input when opened from the command palette**
  (`DrawEmbedModal.svelte`). Focus must move into a dialog when it opens. e2e with the keyboard only.
- The export dialog's dead "transparent" and "scale" controls are fixed by **4.1**. Do not patch them
  separately.

### Phase 2: apply law 3 to existing code (engine ownership)

- **2.1 Audit (read-only, 2 oracle-scouts in parallel).**
  - One scout lists every place in `apps/web/src` that computes scene or render data. For each: the
    `file:line`, what it computes, which engine function should own it (existing or new), and the risk.
    Start from the four known cases in §2, then sweep `draw-chrome/*.ts`, `eraser/`, `mermaid/`,
    `textEditor.ts`, `shapeSwitch.ts`, `embed.ts`, `imageFile.ts`.
  - The other scout lists the engine methods that already exist for each (e.g. `camera.rs`
    `zoom_to_fit_bounds`, `world_to_screen`).
  - Report the table and **stop**. The owner approves which moves happen.
- **2.2+ One task per approved move.**
  - Add the engine method with a Rust test that carries **the same cases** as the TS test it replaces
    (port them before deleting anything).
  - Switch the web to call it, then delete the TS copy.
  - Behaviour must not change: `e2e/presentationPath.spec.ts`, `e2e/presentation.spec.ts`,
    `e2e/cameraBudget.spec.ts`, `e2e/zoom.spec.ts` and the eraser specs must stay green.
  - A flight must still land within 1px, with frame p95 CPU under 16.7ms.

### Phase 3: quick wins (small, mostly independent: good batches)

- **3.1 Paste plain text as text elements.** `design.md:1283`, `shortkey.md:129`, `shortkey.md:420`.
  - Today `paste_json` (`engine/.../engine/clipboard.rs`) accepts only this app's JSON, and plain text
    does nothing.
  - Port the oracle's plain-text paste: the paste path in `components/App.tsx` (look for
    `addTextFromPaste`) and `clipboard.ts`. That covers one element per line or not, the wrap width and
    the placement at the pointer.
  - The element building belongs in the engine (a new method); the web only reads the clipboard.
  - e2e: paste two lines and count the elements.
- **3.2 Zen mode, Alt+Z.** `shortkey.md:382,384`.
  - Hides the chrome and keeps the canvas: oracle `actions/actionToggleZenMode.tsx`.
  - Host-only: chrome visibility is the front's business.
  - Add it to `shortcutRegistry.ts` with its proof, and to the palette.
- **3.3 Palette:**
  - (a) recently used commands rank first (the oracle's CommandPalette), `shortkey.md:361`;
  - (b) font family commands in the palette;
  - (c) "Vectorize" reachable from the palette (today only the context menu has it).
- **3.4 Tests for behaviour that is already built** (tests only; one agent per group, all parallel).
  If a test exposes a bug, stop and report it: it becomes a Phase 1 task. Groups:
  - (a) **engine, Rust:**
    - `stroke_style` and `fill_style` through `apply_style` and `set_next_style` (`design.md:67,69`);
    - stable order after a deletion (`747`);
    - the vertical 45° snap (`828`);
    - projection and closest point asserted directly (`1773,1775`);
    - hit testing a sticky note and an embed on their interiors (`1728,1730`);
    - Align top, `AlignMode::Top` (`shortkey.md:140`);
    - the rough look on a freehand stroke (`design.md:351`);
    - the selection outline's own geometry (`209`);
    - a selection surviving its own transform (`689`).
  - (b) **geometry, e2e or engine:**
    - move and rotate a multi-point line and check its points (`278,280`);
    - rotate an image (`478`);
    - rotate a sticky note by its handle (`515`);
    - resize a frame and check its membership (`532`);
    - copy/paste and duplicate an image (`490`).
  - (c) **text:**
    - clicking away (blur) commits an edit: `commit_text_edit` with `via_keyboard = false` (`435`);
    - the caret and the selection inside the editor (`389,391`).
  - (d) **keys and menus, e2e:**
    - Backspace deletes (`1061`);
    - Ctrl/Cmd+O opens the file picker (`shortkey.md:431`);
    - the context menu's Cut, Copy, Duplicate, Delete, Group, Ungroup, Bring forward and Send backward
      (`design.md:1412-1430`);
    - the main menu's Export (`1447`);
    - arrow keys in both menus (`1874`);
    - shortcut text in the menu items and `?` opening help (`1880`).
  - (e) **collaboration, e2e:** the Share dialog's avatars and people list (`1618,1626`).
  - (f) **embeds, e2e:** paste a supported embed URL through the modal (`shortkey.md:294`).

### Phase 4: export and files (the most visible gap)

Every raster and vector export is produced by the engine. The web only saves or copies the bytes.

- **4.1 Whole-scene PNG.**
  - Today `engine.exportPng()` (`engine/src/engine.ts` ~895) is `canvas.toBlob()` of the _visible_
    canvas.
  - Render into an offscreen target framed by the scene's bounds, at 1×/2×/3×, with or without the
    background.
  - Wire up the dialog's transparent toggle and scale chips (`DrawExportModal.svelte:13-27`), which are
    dead today.
  - Oracle: `packages/excalidraw/scene/export.ts` (`exportToCanvas`).
  - Lines: `design.md:1329,1331,1333,1335,1366`, `shortkey.md:434,446`.
- **4.2 Export the selection, or one frame** (PNG and SVG). `design.md:556,1337,1339,1364`,
  `shortkey.md:197,445,451`.
- **4.3 Copy as PNG / as SVG** to the clipboard (and the oracle's menu entries).
  `shortkey.md:424,425,436,448,449`.
- **4.4 Round trip.** Embed the scene JSON in the PNG (a `tEXt` chunk) and in the SVG's metadata, so
  dropping the file back restores it. Oracle: `packages/excalidraw/data/image.ts`. `design.md:1352`.
- **4.5 Background and theme.**
  - The SVG must be able to leave out its background rect (`scene_to_svg` always draws one today).
  - Add a background colour and a dark-theme export.
  - Collaborator colours must follow the theme.
  - Lines: `design.md:1576,1578`, `shortkey.md:450`.
- **4.6 Fonts in SVG.** `export/svg.rs:416,423` names the family but embeds no `@font-face`.
  `design.md:1348`.
- **4.7 `.excalidraw` import and export.** RISK (public format).
  - `elements_from_json` (`export/json.rs:27-29`) refuses anything that isn't `"osidraw"`.
  - Map the schema both ways. A `figure` exports as a closed line.
  - Include the `files` map and the app state the oracle keeps.
  - Oracle: `data/json.ts`, `data/restore.ts`. Lines: `design.md:1304,1306,1359,1361`.
- **4.8 Rich external paste:** from Google Docs, and "paste as one element". `design.md:1279`,
  `shortkey.md:421,423`.
- **4.9 Crash recovery.** RISK (data) + ASK FIRST.
  - An IndexedDB scene store and a recovery prompt; preferences in localStorage.
  - Lines: `design.md:1293,1295,1301`.

### Phase 5: arrows and lines

For each task, first check that the oracle does it. If it doesn't, stop and ask (law 4).

- **5.1 Backspace removes the last point while placing a multi-point line** (it deletes the selection
  today: `engine/src/host/keys.ts` ~188). `design.md:274`.
- **5.2 Endpoint snapping** for a line's own endpoints while drawing or dragging them.
  `design.md:288`.
- **5.3 Drag a label along its arrow** (the oracle's label position, if it has one at the pin).
  `design.md:331`.
- **5.4 Cardinality (crow's-foot) arrowheads** for ER diagrams, from the oracle's arrowhead list.
- **5.5 Linear shape conversion:** switch line ↔ arrow types the way the oracle's shape conversion does
  (`shapeSwitch.ts` covers closed shapes today).
- **5.6 Right-button drag to pan.** ASK FIRST: the owner asked for it, but Excalidraw opens its context
  menu on a right click. Propose how both can coexist, and stop.

### Phase 6: drawing precision

- **6.1 Alt draws from the centre; Shift+Alt also keeps proportions.**
  - The Draft branch of `pointer_move.rs` never reads Alt, while resizing already does (`from_center`).
  - Lines: `design.md:155,159`, `shortkey.md:60,61`.
- **6.2 Shift snaps rotation to 15°.** `rotate_element` (`selection/transform.rs`) takes only the
  pointer. `design.md:666,668`.
- **6.3 Snap to objects while drawing and resizing,** not only while moving. Oracle `snapping.ts`.
  `design.md:163`.
- **6.4 Ctrl/Cmd also releases the grid** (today it only inverts object snapping).
  `shortkey.md:63,374`.
- **6.5 Equal-spacing guides, connection points, snap increments.** `design.md:821,832,839`.
- **6.6 Grid:**
  - a custom size;
  - drawn thinner as you zoom out;
  - left out of exports.

  Lines: `design.md:802,1551,1555,1559`, `shortkey.md:375`.

- **6.7 Finer nudge (`design.md:646`) and a "none" fill style (`design.md:872`).** Check the oracle.
  If it has neither, report "close as out-of-scope?" and stop.

### Phase 7: selection and frames

- **7.1 Deep select:**
  - click, drag and box-select an element that sits under another;
  - reach a locked element through deep selection.

  Use the modifier the **oracle** uses; if the checklist says otherwise, the oracle wins and the
  registry says why. Lines: `shortkey.md:109,110,112,170`.

- **7.2 Subtractive lasso modifier.** `selection/lasso.rs` has Contain/Intersect only.
  `design.md:621`.
- **7.3 On-canvas marks:**
  - a locked element: the oracle's `UnlockPopup.tsx` and its dashed outline;
  - a selected group.

  Lines: `design.md:632,634`.

- **7.4 A frame's "select contents".** `design.md:540`.
- **7.5 Turn any shape into a flowchart node** before Ctrl+Arrow. `shortkey.md:230`.
- Not planned, don't build: a direction-dependent marquee and intersection mode
  (`design.md:606,610`). They are deliberate, and the registry explains why.

### Phase 8: find and inspect

- **8.1 Scene search** (Ctrl+F).
  - Search text, labels and frame names; step through the matches; highlight them.
  - The engine finds the matches and paints the highlight; the web shows the search box.
  - Oracle: `components/SearchMenu.tsx`, `actions/actionToggleSearchMenu.ts`.
  - Lines: `design.md:1524-1538`, `shortkey.md:344-348`.
- **8.2 Links on elements.** RISK (contract) + ASK FIRST.
  - In order: the contract field (`packages/contract/src/element.ts`), then the engine field, the
    inspector row, the link popup, click to open, internal element links, and keeping links in export.
  - Oracle: `packages/element/src/elementLink.ts`, `actions/actionElementLink.ts`,
    `components/hyperlink/`.
  - Lines: `design.md:1434,1499-1515`, `shortkey.md:203-208`.
- **8.3 Stats panel and numeric inputs.**
  - x, y, width, height and angle, editable, plus scene statistics.
  - The engine returns the numbers and applies the edits.
  - Oracle: `components/Stats/`, `actions/actionToggleStats.tsx`.
  - Lines: `design.md:1432,1488`, `shortkey.md:391-398`.

### Phase 9: library (ASK FIRST: where items live)

- Items are stored per browser (IndexedDB, as Excalidraw does) or per owner through the API (a new
  collection, routes and RISK). Post both options and stop.
- Then:
  - save a selection as an item;
  - a sidebar with previews (rendered by the engine);
  - insert with fresh ids and groups kept;
  - import and export a library;
  - "Add to library" in the context menu.
- Oracle: `data/library.ts`, `actions/actionAddToLibrary.ts`, `components/LibraryMenu.tsx`.
- Lines: `design.md:24,1380-1402,1436`, `shortkey.md:404-409`.

### Phase 10: images

- **10.1 Crop mode:** double-click to enter, crop handles, Escape to leave. Oracle `cropElement.ts`,
  `actions/actionCropEditor.tsx`. Lines: `design.md:476`, `shortkey.md:179-182`.
- **10.2 Replace image, a broken-image state, and each decoded format asserted.**
  `design.md:472,484,486`.
- **10.3 A file store for pictures.** RISK + ASK FIRST.
  - Today pictures ride inline as data URLs, so two or three large ones reach MongoDB's 16MB document
    limit.
  - Write the design into `docs/reference/images.md` first (contract, API, persistence, migration) and
    stop.
  - Lines: `design.md:468,470`.

### Phase 11: freehand and eraser

- **11.1 Pen pressure** sets the width for pens; speed thinning stays for mice. `design.md:343,373`.
- **11.2 Point simplification when a stroke is committed** (`render/path_data.rs::simplify`
  exists), plus a test that pins interpolation. `design.md:347,349`.
- **11.3 The eraser splits a freehand stroke** instead of deleting it whole (`engine/eraser.rs`).
  Check the oracle; if it doesn't, stop and ask. `design.md:997`.

### Phase 12: touch and mobile

- Tell pen, touch and mouse apart.
- Two-finger pan and pinch zoom (today pinch only arrives as a trackpad wheel).
- Long press, palm rejection, larger touch handles.
- A mobile layout for the toolbar and menus.
- Gestures belong in the engine's host (`engine/src/host/pointerInput.ts`); the layout belongs to the
  web.
- Lines: `design.md:363-371,927,934,962-982`.

### Phase 13: collaboration and modes

- **13.1 Follow any collaborator's live camera**, outside presentation mode too. `design.md:1624`,
  `shortkey.md:460`.
- **13.2 Show each person's active tool** in presence. `design.md:1594`.
- **13.3 Read-only link.** RISK (security) + ASK FIRST.
  - A view-only role at the gateway (`docker/gateway/Caddyfile`, `X-Drawnosaurus-Role`), the API and the
    engine.
  - Lines: `design.md:103,587`, `shortkey.md:437`.
- **13.4 Per-property undo and collaboration-aware history.** RISK + ASK FIRST (an operation model).
  `design.md:1238,1244`, `shortkey.md:462`.

### Phase 14: notes, embeds, Mermaid, presentation

- **14.1 Sticky-note border colour** (`docs/reference/sticky.md`). `design.md:505`.
- **14.2 Embeds:**
  - drag out a region to create one (`shortkey.md:293`);
  - loading and error states on the element (`design.md:579,581`);
  - an export fallback (`585`).
- **14.3 Mermaid click links** (needs 8.2).
- **14.4 Presentation path: revisits and skips** (Prezi allows both; today every frame is visited once),
  and following the presenter's live camera. ASK FIRST: a contract change from `pathStep` to a path
  list. See `docs/reference/presentation.md` › Known limits.

### Phase 15: engine architecture

- **15.1 Named actions.** One action table that shortcuts, menus, the palette and buttons all dispatch
  through. Oracle: `actions/register.ts`, `actions/types.ts`. ASK FIRST. `design.md:1146-1197`.
- **15.2 A transaction API** (start / update / commit / cancel). `design.md:1226-1232`.
- **15.3 Geometry primitives:** Vector, Matrix, Circle, and a convexity test.
  `design.md:1749,1757,1761,1777`.
- **15.4 Element fields `customData` and visibility.** RISK (contract). `design.md:42,48`.
- **15.5 Performance budgets.**
  - A CI job that reads criterion estimates against checked-in thresholds.
  - Measure first, then the optimisation lines (`design.md:1891-1909`).
  - Numbers, never adjectives.
- **15.6 A gate that runs the production vectorize worker bundle** (nothing checks it today).
- **15.7 Tests for the host's modal, sidebar and collaboration state.** `design.md:107,109,111`.

### Phase 16: test harness

- **16.1 Paint recording:**
  - record the engine's canvas calls, so a test can assert what is painted: snap guides, binding
    highlights, frame clips, peer cursors, hover and the grid;
  - lines: `design.md:1545,1679-1697`.
- **16.2 Accessibility audit:**
  - focus management, focus traps, screen-reader labels, high contrast, reduced motion;
  - `axe-core` would be a new dev dependency: ASK FIRST;
  - lines: `design.md:1870-1884`.
- **16.3 The modifier matrix:**
  - one table-driven spec, each tool against Shift, Alt, Ctrl and their pairs;
  - lines: `design.md:1962-1976`.

### Phase 17: documentation hygiene

- **17.1 Get `CLAUDE.md` under 200 lines** (it is 261):
  - move detail into `docs/reference/*.md` and leave pointers;
  - fix stale facts (e.g. `DrawSurface.svelte` is ~2.3k lines, not ~1.4k).
- **17.2 Refresh `wiki/remaining-work.html`** to the state PROGRESS.md records, in its existing HTML
  style.

### Phase 18: beyond Excalidraw (only once the owner says parity is done; ASK FIRST)

- Arrows that bind to lines and freehand strokes.
- Arrows that give presentation mode a direction.
- Both are opt-in extensions and must not change any oracle behaviour.

### Never build (out of scope, or deliberately different)

- The 181 lines marked `out-of-scope` in the registry.
- Bold, italic and letter spacing (Excalidraw has none).
- A marquee that selects what it only clips.
- Select All skipping locked elements (ours includes them on purpose).
- Anything the registry calls deliberate, unless the owner asks.

---

## 11. Traps that have already cost this project hours

- **A stale stack looks exactly like a fix that didn't work.** Run `make stale` in your preview
  worktree before judging behaviour there.
- **Browser specs:**
  - Every spec stubs `/v1/**` and the websocket through `e2e/board.ts`; no spec may need the API.
  - Gestures start inside `OPEN_CANVAS`: the chrome floats over the canvas and swallows gestures that
    start under it.
  - Call `focusBoard()` before pressing keys (the listener is on the editor, not the window), then
    `clickElement()` to select.
  - A transparent shape is hit on its outline only.
  - A spec about where the camera lands uses `page.emulateMedia({ reducedMotion: "reduce" })`, or
    `waitForCameraStable` / `waitForCameraLanded`.
  - The run is fixed at 1280×800, with no retries and one worker. A flaky spec is a bug to fix, never to
    retry.
  - CI's fonts differ from the Docker image's (`monospace` is wider on CI), so never assert on
    font-metric pixel values.
- **Engine imports:** import deep engine paths (`@osionos/draw-engine/svelte`, `/types`, `/json`,
  `/engine`, `/camera`), never the bare barrel. eslint enforces it.
- **TypeScript:** `apps/api` and `packages/contract` run TS source with no build step, so no `enum` and
  no parameter properties (`erasableSyntaxOnly`).
- **Shortcuts:** every new chord goes into `shortcutRegistry.ts` with a proof in
  `shortcutRegistry.test.ts`.
- **Conformance:**
  - Every test file named in the registry must exist and contain a test.
  - Renaming or deleting one fails `make conformance`.
  - Never edit or reformat `prompt/*.md`. They are someone else's documents, and their line numbers are
    references.
- **Pinned versions:**
  - `wasm-bindgen` is pinned to `=0.2.128`, and Mermaid to 11.12.2. Don't bump either.
  - New dependencies wait 7 days after release (`minimumReleaseAge`) and need the owner's OK.
- **Integration tests** use a real MongoDB, never a mock, and fail rather than skip without
  `MONGO_URL`.
- **Browsers:** always run Playwright in the pinned image (§7.1), which carries its own browsers at
  `/ms-playwright`. Do not use `make test-e2e` (host Playwright) or the MCP servers in `.mcp.json`:
  both point at a lab-machine path (`/sgoinfre/…`) that does not exist on this computer.
- **Git:** `git fetch --no-recurse-submodules` (a recursive fetch fails on the engine's SSH-only
  submodule), and `git submodule update --init engine` without `--recursive`.
- **Undo** is a new edit that stamps above what it restores. Peers' held elements are untouchable, like
  locked ones. Read "Live: holds and previews" in CLAUDE.md before touching history, selection or text
  editing.

---

## 12. The last word

Small, verified, honest steps. One batch, one report, then **stop and wait**. The owner would rather
read "BLOCKED, here are three options" than find a clever workaround in a diff.
