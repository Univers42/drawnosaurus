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

The Docker build keeps the Rust relay (`engine/realtime`, behind the gateway). The public
build's relay is a **Cloudflare Worker, `hydrawn-relay`, with one Durable Object**
(`packages/relay`) — the owner's decision (Ruling 23, 2026-10-20): it runs on the
Cloudflare account the site already uses, on the free plan, with no new account and no
cold start.

It is a small TypeScript relay that speaks, frame for frame, the part of
`engine/realtime`'s wire protocol the web client uses: `AUTH` with no authentication (the
Rust relay's no-auth mode), `SUBSCRIBE` to `boards/<id>/*`, `PUBLISH` fanned out as
`EVENT` to every matching subscription, the publisher's own included, and `PING` answered
with `PONG`. A publish whose payload is over 64 KiB is dropped without an answer, as the
Rust relay drops it, so the client behaves the same against both. Its tests drive it only
with the client's own frame builders and readers (`realtimeProtocol.ts`), so the two cannot
drift apart unnoticed. The public build is pointed at it with `VITE_HYDRAWN_RELAY_URL`
(`lib/config.ts`, `relayWsUrl`); the socket is `wss://<worker host>/ws`.

The client's ping is a fixed string, `{"type":"PING"}` (`pingFrame`), and all it needs back
is a frame of type `PONG` (`isPong`, `realtimeClient.ts`), so the runtime answers it alone,
with a fixed `{"type":"PONG"}`: `setWebSocketAutoResponse`, which answers "without waking
WebSockets in hibernation"
([state API](https://developers.cloudflare.com/durable-objects/api/state/#setwebsocketautoresponse)),
and whose answers "will not incur additional wall-clock time, and so they will not be
charged" ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
note 3). That pong has no `server_time`, which the Rust relay's has; the client never reads
it. Any other ping still reaches the relay and is answered as the Rust relay answers it.

What one frame may cost is bounded before it is parsed, and a frame over any bound is
dropped without an answer, as the Rust relay drops a frame it cannot read:

- a frame over 66,560 UTF-16 code units (`MAX_FRAME_LENGTH`): the 64 KiB payload cap plus
  1,024, where the client's largest envelope is 111 bytes (`publishFrame` with a 32-character
  slug and `preview-end`); a string never has more code units than UTF-8 bytes, so no frame
  the payload cap lets through is refused;
- a frame nested deeper than 127 levels (`MAX_DEPTH`), serde_json's recursion limit as
  measured on `engine/realtime`, and short of where `JSON.stringify` overflows the stack;
- a publish to a topic over 256 bytes (`MAX_TOPIC_BYTES`); the client's are 44;
- a publish whose event type is over 64 bytes (`MAX_EVENT_TYPE_BYTES`); the client's are 11
  at most (`preview-end`, `present-end`). Both are copied into every EVENT.

Each topic's sequence is kept for at most 10,000 topics, the least recently published
forgotten first (`MAX_TOPICS`): forgetting one restarts it at 1, as waking does, and the
client never reads it. Nothing a frame does can throw out of the object, which would reset
it and drop every socket on it: what the relay cannot serve it drops, and anything else is
logged and that frame dropped.

**Beyond the Rust relay, and additive (Ruling 26):** when a socket closes or errors, every
other connection subscribed to one of its topic patterns — the same drawing — is sent
`{"type":"gone","socket":"<conn_id>"}` once, naming it as `AUTH_OK` did. It is the frame the
client already handles (`handleControl`, `realtimeClient.ts`: it lets go at once of what
that peer held) and the browser tests' stub relay already sends (`e2e/board.ts`, `relay()`).
The Rust relay sends nothing; there the client lets go only once the peer's presence is
45 s stale (`PEER_STALE_MS`). A close can be what wakes the object, and a disconnected socket
is not listed by `getWebSockets`, so the closer's connection is read from its own attachment,
then cleared, so that it is announced once.

The relay sees only sealed frames, and the drawing id in the topic; it cannot read a
drawing. It stores nothing: what each connection has subscribed to is kept in that
socket's hibernation attachment, not in the object's storage.

**One object for every drawing.** Duration is billed per active object: one object busy
all day is about 0.125 GB × 86,400 s ≈ 10,800 GB-s, under the free 13,000 GB-s a day; one
object per drawing would multiply that by the number of drawings live at once. It uses the
WebSocket Hibernation API, so while nobody sends anything it is not billed for duration.
The ceiling is one object for every live drawing — 32,768 sockets
([state API](https://developers.cloudflare.com/durable-objects/api/state/): "a maximum of
32,768 WebSocket connections per Durable Object"), one thread; the upgrade path is sharding
by drawing id.

The free plan, read on 2026-10-20
([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[limits](https://developers.cloudflare.com/durable-objects/platform/limits/)):

- Durable Objects are on Workers Free, with the SQLite storage backend only;
- 100,000 requests a day, and incoming WebSocket messages are counted 20:1 (about
  2,000,000 messages a day); outgoing messages are not charged;
- 13,000 GB-s of duration a day, and a hibernating object is not billed for duration;
- a received message can be up to 32 MiB.

When an allowance runs out, Cloudflare refuses further requests until 00:00 UTC; the page
sees an ordinary connection failure, which it already shows as offline (`liveLabel`).

Nothing has to wake the relay before a share: there is no cold start. `GET /v1/health`
answers 200 without reaching the object, so a call to it from the Share dialog is harmless,
but no longer needed.

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

| Piece     | Where                        | Free allowance (checked 2026-10-20)                                                                     |
| --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| The site  | Cloudflare Pages             | static requests and bandwidth unlimited; 20,000 files, 25 MiB per file                                  |
| The store | Pages Functions + D1         | 100,000 function requests/day; D1 5 GB, 100,000 rows written and 5,000,000 read per day                 |
| The relay | Workers + one Durable Object | 100,000 requests/day, incoming WebSocket messages counted 20:1; 13,000 GB-s/day, none while hibernating |

At one save per 20 s per person editing, 100,000 writes a day is about 550 person-hours
of editing shared drawings per day, across everyone — fewer when pictures add parts. Vercel was considered and dropped: it cannot hold the
relay's websockets, and its free plan is 100 GB a month and non-commercial only.

For the relay, an open shared drawing sends a ping every 5 s and its presence every 15 s
(`LINK_CHECK_MS`, `PRESENCE_HEARTBEAT_MS`, `realtimeClient.ts`). The runtime answers the
pings, and those answers are not charged, so a tab open all day costs its presence: 5,760
messages, 288 requests — 100,000 requests a day is about 347 tab-days of drawings left
open. The pricing page does not say in so many words that an auto-answered ping is not
counted as a request; if it is, a tab costs 23,040 messages, about 1,150 requests, and the
figure is about 87 tab-days. A moving pointer sends up to one cursor per animation frame
(`DrawSurface.svelte`); at 60 a second that is 10,800 requests an hour, so pointer motion,
not idle tabs, is what spends the allowance.

**Deploying is the owner's.** The builder prepares the Cloudflare configuration and writes
the steps down; nothing is deployed, and no account is created, without the owner's
go-ahead.

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
- That the deployed relay hibernates, that its messages are counted 20:1, and that the
  pings the runtime answers are not counted, as the pricing page says — read from the
  account's Durable Object metrics.
- That the relay accepts websocket upgrades from another origin (the site and the relay are
  on different hosts in the public build): the Worker checks no `Origin`.
- The new reference page, `docs/reference/public-build.md`, and the index row for it in
  `CLAUDE.md`; `docs/reference/architecture.md`, `docs/reference/commands.md` and
  `docs/collaboration.md` updated to match.

## Risks

- **The relay is open.** Anyone can use it to pass their own traffic; the damage is
  capped by the free plan's daily allowances — which also means someone can spend the
  day's allowance and take live sharing offline for everyone until 00:00 UTC. ponytail: no
  gate; upgrade path — the Worker checks the `Origin`, or a token minted by a Pages
  Function, before it upgrades the socket.
- **Free tiers change.** Every figure above was read on 2026-10-20 and is a claim about
  that day.
