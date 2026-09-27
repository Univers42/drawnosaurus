# Architecture: which file owns what

`CLAUDE.md` points here. This is the code map: the two boundaries, and then the one module
that answers for each concern. It is deliberately _not_ a second copy of
`docs/collaboration.md` — that page is the user-facing guide to working together, this one is
where the code for it lives. Where the two overlap, this page wins on file names and
`docs/collaboration.md` wins on what a person sees.

## The two boundaries

**The engine never talks to the network; the server never runs WASM.** The only thing
crossing between them is an `.osidraw` scene document.

**The engine owns the render data.** It holds the scene, all geometry, all painting, the
camera maths and the scene formats. The front end draws _chrome_ from what the engine
returns and turns clicks and keys into engine calls. So the front may not compute a
position, a size or a bound, may not keep its own copy of scene state, and may not
re-implement an engine formula in TypeScript. If the front needs a number, add an engine
method that returns it.

The one sanctioned mirror is `packages/contract/src/bounds.ts`, which copies
`scene/geometry.rs` because the API has no WASM runtime. Tests pin the two together. Do not
add a second one.

## Sharing: the gateway, and the code behind it

`docs/collaboration.md` explains it for a person. The modules are:

| what                              | where                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the one origin, and who is asking | `docker/gateway/Caddyfile` — three entrances, `:80` this computer, `:81` the network, `:82` the tunnel                                                                                         |
| the role the gateway asserts      | the `X-Drawnosaurus-Role` header, which the gateway **overwrites**; a guest cannot list, create or delete boards, nor open the tunnel                                                          |
| the links the Share dialog offers | `GET /v1/share` → `apps/api/src/share.ts`, fed by `scripts/lan.sh` (the DNS name first when the network resolves it, then each address, each marked with the network it goes over)             |
| the internet link                 | `apps/api/src/tunnel.ts` runs cloudflared and offers the link only once Cloudflare's DNS publishes the name; opened and closed by `POST` / `DELETE /v1/share/tunnel` (`apps/api/src/share.ts`) |
| encryption on plain `http://`     | `apps/web/src/lib/realtime/roomCrypto.ts` — browsers withhold `crypto.subtle` off `https://`, so it falls back to `@noble/*` with byte-identical envelopes                                     |
| the image's API URL               | the web image runs with `PUBLIC_API_URL=""` because the gateway serves the app and `/v1` together                                                                                              |

api and mongo are on 127.0.0.1 only: **4300** and **27019**. The gateway is the only door.

## `packages/contract` — the single source of truth

Zod schemas (`element.ts`, `board.ts`), the merge rule (`reconcile.ts`), scene bounds
(`bounds.ts`), limits. **No Fastify, no Mongo, no DOM.** Both apps are thin glue over it, so
the element schema and the merge rule exist once and are unit-tested without a server or a
database in the way. Changes to the wire format start here.

## Autosave: the dirty-set diff

`routes/boards/[slug]/+page.svelte` keeps a plain `live: DrawElement[]` — it never reads the
DOM — fed by `onSceneChange`, which accepts either an `osidraw-delta` payload or a full
scene. `SceneAutosaver` (`apps/web/src/lib/autosave/autosaver.ts`) hands the scene to
`SceneDiffTracker.diff()` (`sceneDiff.ts`), which produces the patch.

Three engine behaviours shape it, and each is a test:

1. **Exported JSON drops tombstones.** A deletion arrives as an id that simply vanished, so
   the tombstone the server's merge needs has to be synthesised.
2. **Undo can resurrect a deleted element.** The engine stamps an undo _above_ whatever it
   restores over (undo is a new edit, as in Excalidraw —
   `engine/crates/draw-engine/src/engine/stamp.rs`), so the host re-stamps a resurrection
   only when it does **not** outrank the tombstone already sent (an older engine, a local
   draft). Minting a second stamp for an engine-stamped one would desync the two.
3. **Z-order is array position**, and the engine reorders without touching stamps, so a
   reorder is invisible to a stamp diff. The client **tries to** predict the order the server
   will reach — it is wrong for a resurrected id (`docs/reference/zorder.md`) — and sends an
   explicit `order` on a mismatch, which is what stops the wrong prediction from persisting.
   Nothing is corrupted today: the engine's `structural` flag on undo and that same
   comparison keep ordinary single-client paths honest. The cost is a redundant full-order
   PATCH on every undo of a delete.

The `send` callback must **not** swallow the rejection — the autosaver needs it to leave the
patch unacknowledged and arm the retry.

## Server: element-level last-write-wins

Winner per id in `reconcile.ts`: higher `version`, tie broken by `versionNonce`, then
`updated` — in that order, so clock skew only ever decides a tie the edit counts could not.
Order-independent and idempotent.

**The stamp is the only change signal** the host diff, the server and the peers share, so
every local edit must move it. The engine stamps each element a commit changed, once per
commit, in `push_history` (`engine/crates/draw-engine/src/engine/stamp.rs`) — moves, resizes
and re-routed arrows included. A peer's copy of an element with an uncommitted local change
is refused, and the commit stamps above it.

| route                             | precondition                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PUT /v1/boards/:slug`            | **requires `If-Match`** — 428 without it, 409 if stale, because a full replace from a stale tab destroys newer work |
| `PATCH /v1/boards/:slug/elements` | none, by design: the autosave path merges per element so two writers converge                                       |

`apps/api/src/boards/routes.ts` is HTTP only; merge rules are in the contract, persistence in
`repository.ts`.

**Ownership resolves in exactly one function**, `resolveOwner` in `apps/api/src/auth.ts`, and
every repository query is scoped by its result, so cross-owner access is impossible by
construction. `AUTH_MODE=dev` maps every request to one owner; `AUTH_MODE=bearer` refuses to
boot rather than serve everything to everyone. Replacing auth is a change to `resolveOwner`
and nothing else.

## Live: holds and previews

Beside patches, the live link carries `presence` (what each person has selected, each
element with when they took it) and `preview` / `preview-end` (a gesture in progress, streamed
at most every `previewInterval`).

`apps/web/src/lib/realtime/peerClaims.ts` settles a race — earlier claim, then smaller client
id — identically on every side, and `engine.setPeers` enforces the result: **what a peer holds
is untouchable, exactly like a locked element** (select, marquee, eraser, text edit, undo).
Previews are painted as live but never enter the scene, history or autosave
(`engine/crates/draw-engine/src/engine/peers.rs`). A preview carries the pre-gesture version,
so a commit outranks it whichever arrives first. Frames go out in send order — sealing is
async, and a preview landing after its end would freeze a shape mid-move. A text being typed
is a gesture too: `engine.gestureElements()` carries it and the shape it grows, laid out per
keystroke by `updateTextEdit` and committed once by `commitTextEdit`
(`engine/crates/draw-engine/src/engine/text_session.rs`).

The server only has what has been saved, so a `join` carries the newcomer's inventory (each
id with its stamp) and everyone there answers with a `sync` of what it lacks plus their own
inventory, which the newcomer answers with what _they_ lack — the same exchange brings a
client back from a dropped link (`liveBroadcast.ts` › `inventory` / `missing`). The live route
stays blind but answers `{"type":"ping"}`, because a dead link can read as open for minutes.
It also sends plaintext `welcome` / `gone` naming its own sockets, so what someone held is let
go the moment their page goes. Client ids are per page and never stored — a duplicated tab
copies `sessionStorage`. Pictures go to each side once (`docs/reference/images.md`).

## Web app shape

`apps/web/src/lib/draw-chrome/` is the editor chrome. `DrawSurface.svelte` is the
orchestrator that mounts the engine and owns tool/theme/selection state; everything testable
is factored into plain `.ts` modules beside it (`tools.ts`, `menu.ts`, `theme.ts`,
`inspector.ts`, `style.ts`, `camera.ts`, `shapeActions.ts`, `shortcuts.ts`, …) each with a
`.test.ts`.

**Unit tests target the `.ts` modules, not the Svelte components** — the components are
covered by the browser specs. Follow that split when adding behaviour. (`DrawSurface.svelte`
has grown past 2,400 lines; a new behaviour that can be tested goes in a `.ts` module beside
it, not in the orchestrator.)

Every toolbar entry in `tools.ts` is typed `DrawTool`, the engine's own union — the sticky
note included, which the engine owns now — so the toolbar cannot offer a tool `setTool` does
not accept.

**Mermaid import** (`apps/web/src/lib/mermaid/`) turns
`@excalidraw/mermaid-to-excalidraw`'s skeletons into elements, and `engine.insertJson` places
them, a label shrunk to fit before its shape grows. Mermaid is pinned to 11.12.2 in
`pnpm-workspace.yaml` (11.17 breaks the converter's subgraphs). Every type, the divergences
from the oracle, and `make fuzz-mermaid`: `docs/reference/mermaid.md`.
