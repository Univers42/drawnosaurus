# Hydrawn: a public build that runs in the browser

Design, 2026-10-20. Written from a conversation with the owner; every decision below is
theirs. Those marked **(my call)** were proposed by Claude and confirmed by the owner on
2026-10-20.

## Intent

Anyone should be able to open a web address and start drawing — no install, no Docker, no
account, no money. Their drawings stay in their own browser. When they want to draw with
someone, they send a link; the drawing is end-to-end encrypted, so nothing in the middle
can read it, and the link keeps working after they leave.

The project also gets a name people can say: **Hydrawn** — a hydra's many heads drawing on
one body, the way many people draw on one board. Built like Excalidraw's name
(Excalibur + draw): a legend, plus the verb.

## Two builds of one app

|                                | Docker build (today)                          | Public build (new)                          |
| ------------------------------ | --------------------------------------------- | ------------------------------------------- |
| Where                          | `make up`, the owner's computer               | `hydrawn.pages.dev`, Cloudflare Pages, free |
| Drawings stored                | MongoDB, through the API                      | the browser (IndexedDB)                     |
| Opening the app                | the gallery                                   | a drawing                                   |
| Live sharing                   | gateway → relay, LAN links, Cloudflare tunnel | a hosted relay, link with a secret          |
| A link after the sharer leaves | the server has the board                      | an encrypted copy, stored online            |

**The Docker build does not change**, apart from the rename and the gallery menu item
below. Nothing is removed from it, MongoDB included.

The two builds do not talk to each other: a link from one does not open in the other.

## Goals

1. **Opening the app opens a drawing.** `/` reopens the drawing last open in this browser;
   on a first visit, a new empty one. **(my call: reopen the last one, as Excalidraw does;
   an empty drawing is not listed in the gallery until something is drawn on it, so
   visiting does not fill the gallery with blanks.)**
2. **The gallery is one click away and lists what this browser holds.** Title, picture,
   open, delete — as today, read from browser storage. There is no rename today, so a
   drawing is titled "Drawing — <date>" and rename stays out of scope. Reached from a new
   **"My drawings"** item in the board's main menu. Today a board has no way back to the
   gallery except the browser's Back button (the header is hidden on boards,
   `routes/+layout.svelte`), so the item goes into **both** builds **(my call)**.
3. **Drawings live in the browser.** IndexedDB, not `localStorage`: the project moved off
   `localStorage` because a board with photos exceeded its quota and a 2,000-stroke board
   cost 160 ms per stroke to serialise (`apps/web/src/lib/autosave/draftStore.ts`, header).
4. **Sharing is end-to-end encrypted, over the internet.** Share mints a random secret
   for the drawing; the link carries it after `#`, which browsers never send to a server.
   Whoever opens the link joins live. Neither the relay nor the store can read anything.
5. **A link keeps working after the sharer leaves.** While a drawing is shared, an
   encrypted copy is kept online; someone opening the link later gets it, decrypts it, and
   carries on — live, if anyone else is there.
6. **Everyone who has opened a shared drawing keeps it** in their own gallery
   **(my call)**.
7. **It costs nothing.** Free tiers only, free subdomain (`*.pages.dev`), no credit card.
8. **Renamed to Hydrawn** everywhere a person reads it (see _Rename_).

## Non-goals

- **Revoking a link.** Once shared, whoever has the link can open and edit the drawing
  until the online copy expires. Deleting a drawing from your gallery deletes your copy
  only.
- **Accounts, sign-in, or a gallery that follows you across devices.**
- **A custom domain.** `hydrawn.pages.dev` is free; a real domain costs money anywhere.
- **Fixing the Docker build's live key.** It is derived from the board name (see _The
  secret_); there the server stores boards unencrypted anyway. A separate issue.
- **Moving the Docker build onto Cloudflare**, or the public build onto MongoDB.
- **Relay abuse protection beyond the free tier's own caps.** See _Risks_.

## Anti-goals — failing any of these is a failure even if everything else works

- A server — relay, store, or anything in between — that can read a drawing.
- A drawing lost without the person being told: every failure to save, locally or
  online, is shown.
- An unshared drawing that leaves the browser. A drawing connects to nothing until it
  has been shared.
- The Docker build behaving differently (beyond the two additive items above).
- Any change under `engine/**`, `third_party/**`, `prompt/*.md`, or `BUNNY.md`. If the
  builder finds the work needs an engine change, stop and bring it back to the owner.
- The front end computing a position, size or bound (the engine law, `CLAUDE.md`).
- A bill.

## How it is made

### The mode switch

One build-time variable picks the storage: unset, it is the Docker build exactly as
today (backward-compatible by default); set to the browser mode, it is the public build.
It is `VITE_HYDRAWN_MODE`, folded in at build time with a `"server"` default declared
in `vite.config.ts`, so the code of the unused mode is not shipped. Not a `$env/static/public`
variable: importing one that is unset fails the build, which would break "unset = the
Docker build". The
adapter follows it: `adapter-node` as now, `adapter-static` with an SPA fallback for the
public build (`apps/web/svelte.config.js`; the app is already `ssr = false`,
`routes/+layout.ts`). `@sveltejs/adapter-static` is a new dependency and is subject to the
7-day hold (`minimumReleaseAge`, `docs/reference/conventions.md`).

**The seam is `apps/web/src/lib/api/client.ts`** — every server call goes through it, from
four importers: the gallery (`lib/gallery/Gallery.svelte`), the board
(`routes/boards/[slug]/+page.svelte`), `DrawTemplatesModal.svelte` and
`DrawShareModal.svelte`. The public build supplies the same operations — list, create,
read, save, delete, thumbnail — over browser storage, so those four call one interface
whichever mode is built. The per-element store that exists (`DraftStore`, IndexedDB
`drawnosaurus-drafts`) is the element store; a small board index (title, updated time,
picture, the share secret) goes beside it.

Templates keep working: in the public build they create a local drawing.

### The secret

Today the live key is **not secret**: `deriveBoardRoomKeyBytes` computes it from the board
name alone (`apps/web/src/lib/realtime/roomCrypto.ts:93`), and the relay sees that name in
every frame (`boards/<slug>/live`, `realtimeProtocol.ts:10`). Anyone running the relay
could compute the key.

In the public build:

- **Share** mints 32 random bytes (`generateRoomKeyBytes`, already there), saves them with
  the drawing, and writes them into the link as `#room=…` (`formatRoomHash`, already
  there).
- **Opening a link** with `#room=` takes the secret from it and saves it with the drawing.
- The AES-256-GCM sealing, the HKDF derivation and the `@noble/*` fallback are reused as
  they are.
- **A drawing without a secret is not live.** Today every board connects on open
  (`DrawSurface.svelte`, the `resolveRoomKey` call in `onMount`); in the public build only
  shared drawings do. That is also what keeps the relay asleep and the quota unused for
  people drawing alone.
- Drawing ids are random and unguessable; the id is the relay topic and the store key.
  Knowing an id without the secret reveals nothing but that the drawing exists.

### The relay

The existing relay, unchanged: the `realtime-server` image built by
`docker/realtime.Dockerfile` from `engine/realtime`, run with no auth, as the Docker
build runs it. Hosted on **Render's free plan**. The public build is pointed at it with the
existing `PUBLIC_REALTIME_WS_URL` (`realtimeClient.ts`, `liveSocketUrl`). Its
`REALTIME_STATIC_DIR` is pointed at an empty directory, so the relay does not serve
`sandbox/static` to the internet.

Render's free service sleeps after 15 minutes without traffic and takes about a minute to
wake. **When the Share dialog opens, the page calls the relay's health endpoint**
(`/v1/health`) so it is waking while the link is being copied **(my call)**.

How a newcomer gets the drawing from the people already in the room is the existing
join/sync exchange (`liveBroadcast.ts` › `inventory` / `missing`); it does not need the
API.

### The stored copy

A small HTTP store on the same origin as the site — **Cloudflare Pages Functions over D1**
(Cloudflare's SQLite database, free) — that holds only sealed bytes:

- one record per shared drawing: id, revision, the sealed scene, a write proof,
  last-written time;
- one record per picture: drawing id, picture id, the sealed picture. Write-once.

**Every record is stored in parts from the start** — part index in the key, each part
under D1's row limit, all parts of one write in one atomic `batch` **(my call)**. The
app already accepts pictures up to 4 MB after scaling them to 1,440 px on the longer side
(`IMAGE_MAX_BYTES`, `IMAGE_MAX_SIDE`, `apps/web/src/lib/draw-chrome/imageFile.ts`), which
is over the believed ~2 MB row limit; parts mean anything the app accepts is stored
online, and no migration of a deployed table is needed later.

Rules:

- **Who saves: each person saves their own edits** — what they changed on this page, not
  what arrived from peers — at most once every ~20 seconds while they are editing, and
  when the page is hidden **(my call)**. Peers' edits reach the page through the same
  `onSceneChange` as local ones, so each change is tagged local or remote. The interval is
  a throttle — a timer new edits do not reset — because the existing autosaver's debounce
  never fires for someone drawing without a pause. A `keepalive` request carries at most
  64 KB, so edits from the last seconds before a tab closes may not reach the stored copy;
  the shared-copy status says so. Three people editing means up to three writers;
  someone only watching writes nothing, and nobody has to be elected the writer, so the
  copy does not go stale when one person leaves. A save is a compare-and-swap on the
  revision: on a conflict the browser reads the stored copy, decrypts it, merges with the
  contract's merge rule (`packages/contract/src/reconcile.ts`), and writes again. The
  server never merges; it cannot read what it would merge.
- **Compressed, then sealed** (`CompressionStream`, built into the browser).
- **Pictures** are taken out of the scene before sealing and stored once each, like the
  API does today (`apps/web/src/lib/autosave/pictures.ts`, `PictureLedger`, reused to
  know what the store already holds).
- **Size.** The store caps a drawing's total size; a save over the cap is refused and the
  person is told, the same way the Docker build reports a board too large (413 →
  `too-large`, `routes/boards/[slug]/+page.svelte`, `classify`). The cap is the builder's,
  from D1's 5 GB.
- **Write proof.** From the secret, HKDF derives a write token; the first write stores its
  SHA-256, and later writes must present a token that matches. Someone who learns a
  drawing's id but not the secret can neither read nor overwrite it.
- **Expiry.** A copy not written for a year is deleted, swept on writes rather than by a
  scheduled job **(my call)**.
- **Opening a link.** The board reads the stored copy when it has no local copy and
  **shows it at once**, without waiting for the relay to wake; the live status the board
  already shows (`liveLabel`, `DrawSurface.svelte`) says it is connecting, and says so if
  it cannot **(my call)**.
- **Reconnecting** is what it is today: a dead link is found by the relay's `ping`, the
  client reconnects, and the join/sync exchange swaps what each side lacks
  (`docs/reference/architecture.md`, _Live_); then `catchUp` reads the latest — in the
  public build, `fetchLatest` reads the stored copy instead of the API
  (`routes/boards/[slug]/+page.svelte`). No periodic read of the store.

The store's handlers are plain functions over a small database interface, unit-tested
against an in-memory one; the Pages Function and D1 binding are thin glue — the same
split as the contract and the apps.

### The Share dialog in the public build

No LAN links and no tunnel — there is no gateway. One action, **Share live**: mint the
secret (once), save the first copy, connect, and show the link with a copy button and a QR
code (`uqr`, already a dependency). After that, the dialog shows the same link.

### Rename

**Renamed — everything a person reads:** the brand in the header
(`routes/+layout.svelte`, `🦕 drawnosaurus`), page titles (`· drawnosaurus`), text in the
app, the README, prose in `docs/`, and the public address.

**Kept — every identifier something already depends on**, because renaming them breaks
what people have: `localStorage` keys (`drawnosaurus:theme` and the rest — settings
would reset), the IndexedDB database `drawnosaurus-drafts` (the gallery would empty), the
HKDF label `drawnosaurus-live-v1` (old and new versions could not read each other's live
frames), the `.osidraw` format, the `X-Drawnosaurus-Role` header, the `@drawnosaurus/*`
package names and the compose project. **Renaming the GitHub repository is the owner's
call** and is not part of this work.

The dinosaur emoji goes with the old name; the brand is the word **Hydrawn** until there
is a logo **(my call)**.

### Hosting, and what is free

| Piece     | Where                   | Free allowance (checked 2026-10-20)                                                     |
| --------- | ----------------------- | --------------------------------------------------------------------------------------- |
| The site  | Cloudflare Pages        | static requests and bandwidth unlimited; 20,000 files, 25 MiB per file                  |
| The store | Pages Functions + D1    | 100,000 function requests/day; D1 5 GB, 100,000 rows written and 5,000,000 read per day |
| The relay | Render free web service | 750 hours/month; sleeps after 15 min idle, ~1 min to wake                               |

At one save per 20 s per person editing, 100,000 writes a day is about 550 person-hours
of editing shared drawings per day, across everyone — fewer when pictures add parts. Vercel was considered and dropped: it cannot hold the
relay's websockets, and its free plan is 100 GB a month and non-commercial only.

**Deploying is the owner's.** The builder prepares the Cloudflare and Render configuration
and writes the steps down; nothing is deployed, and no account is created, without the
owner's go-ahead.

## Tests

Red first, and shown red — `CLAUDE.md`, _What a test is for_.

- **Unit** (`.ts` modules beside the components, not the components): the browser storage
  backend, the share-secret flow, the store's handlers (compare-and-swap, write proof,
  parts, size cap, expiry), the stored-copy save/merge loop (two writers converge).
- **Browser** (`e2e/*.spec.ts`, following `docs/reference/browser-tests.md`), against the
  public build:
  1. opening the app lands on a drawing; reloading brings back the same one;
  2. a drawing appears in the gallery once drawn on; "My drawings" goes there and back;
  3. a second browser opens the share link and sees the drawing live, both ways;
  4. with the sharer's page closed, a third browser opens the link and gets the drawing,
     a 4 MB picture included;
  5. nothing goes over the network for a drawing that was never shared.
- The existing gate stays green for the Docker build: `make quality`, `make conformance`,
  and the browser specs as they are.

## Left to the builder, to verify before relying on it

- D1's maximum row size (believed about 2 MB; not confirmed) — it sets the part size.
- That `engine/pkg/draw_engine_bg.wasm` is under Pages' 25 MiB per-file limit.
- That Cloudflare Pages serves the SPA fallback for `/boards/<id>` deep links.
- How `$env/dynamic/public` behaves in an `adapter-static` build; prefer static env in
  the public build.
- That Render builds `docker/realtime.Dockerfile` with the `engine` submodule checked out,
  or else deploys a pre-built image; and whether the relay needs `REALTIME_ALLOW_NOAUTH`
  to run with no auth.
- That the relay accepts websocket upgrades from another origin (the site and the relay are
  on different hosts in the public build).
- The new reference page, `docs/reference/public-build.md`, and the index row for it in
  `CLAUDE.md`; `docs/reference/architecture.md`, `docs/reference/commands.md` and
  `docs/collaboration.md` updated to match.

## Risks

- **The relay is open.** Anyone can use it to pass their own traffic; the damage is
  capped by Render's free hours. ponytail: no gate; upgrade path — the relay already
  supports JWT auth (`engine/realtime/realtime.toml`, `[auth]`), with tokens minted by a
  Pages Function.
- **The first share after a quiet spell waits about a minute** for the relay to wake.
- **Free tiers change.** Every figure above was read on 2026-10-20 and is a claim about
  that day.
