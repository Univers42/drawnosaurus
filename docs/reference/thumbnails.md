# Board thumbnails

The gallery (`apps/web/src/lib/gallery/Gallery.svelte`) shows a picture of each board in
`.card-preview`, with the element-count badge laid over it.

## How a picture gets there

1. A board page finishes an autosave (`saving` to `idle`). Only the client that saved gets
   here, so a board open in three tabs uploads from the tab that was drawn in.
2. `ThumbnailUploader` (`apps/web/src/lib/thumbnail/thumbnailUploader.ts`) waits 3 s for
   quiet, keeps uploads at least 10 s apart, and runs one at a time.
3. It asks the engine for the picture: `engine.exportThumbnail()`. The engine owns the
   size (at most 480 px on the long side, never enlarged) and leaves the scene out of the
   PNG; the front passes no number (`exportParity.test.ts` enforces it).
4. `PUT /v1/boards/:slug/thumbnail` with `Content-Type: image/png`. A hidden tab flushes at
   once. A board with elements and no picture uploads once when it opens (backfill).
5. The list and the board carry `thumbnailAt`; the card shows
   `GET /v1/boards/:slug/thumbnail?v=<thumbnailAt>`. It asks the store for that address
   (`BoardStore.thumbnail`) through `lib/gallery/cardPicture.ts`, which releases every
   address it was given: in the public build each is an object URL for a Blob in IndexedDB.

## The API

|       |                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUT` | owner-scoped like `PUT /v1/boards/:slug`. Body must be `image/png` (else `415`), start with the PNG signature (else `400 bad_thumbnail`), and be at most `MAX_THUMBNAIL_BYTES` = 512 KiB (else `413`). Answers `204` with an `ETag`. |
| `GET` | `200 image/png` with `ETag`, `Cache-Control: private, no-cache`, `X-Content-Type-Options: nosniff`; `304` on a matching `If-None-Match`; `404` when the board is unknown, deleted, or has no picture.                                |

The PNG lives in its own `thumbnails` collection keyed by the board's `_id`, so a list or a
board read never carries it. Storing one sets `thumbnailAt` and nothing else on the board:
**no `rev` bump and no `updatedAt` change**, because the gallery sorts on `updatedAt` and
`If-Match` relies on `rev`. A client that does not know `thumbnailAt` still parses a summary
(the field is optional in `boardSummarySchema`).

## What it does not do

- It does not check that the bytes are a whole, valid PNG. Only the 8-byte signature.
- It does not render on the server. The server never runs WASM.
- It does not follow the dark theme or a peer's cursors; it is the scene as the engine
  exports it.
- It does not retry on a timer. A failed upload waits for the next save or the next hide.
- It does not rewrite a picture when someone else edits a board and nobody saves from this
  client's tab.

## Getting back to the gallery

The board's main menu has a first item, **My drawings**, an anchor to `/gallery` (the same
page as `/`: `lib/gallery/Gallery.svelte`).

- Excalidraw at `1118751f` has no gallery, so it has no such item. This is a design
  decision, not a port.
- It exists because the header is hidden on boards (`routes/+layout.svelte`, `onBoard`),
  and the browser's Back was the only way out.
- The owner approved it on 2026-10-20.
- In the Docker build a guest who opens it sees the gallery's existing refusal, because
  `GET /v1/boards` is host-only. That is the same as a guest opening `/` today.

Leaving a board by any in-app navigation saves what is pending: the board page's
`beforeNavigate` flushes the autosaver, the draft and the thumbnail, ahead of `onDestroy`.

## Caveat

Pictures are best effort and can be stale: a tab closed within 3 s of the last save leaves
the previous picture; edits inside the 10 s spacing wait for it; a scene whose PNG exceeds
512 KiB keeps its old picture (or none) because the upload is skipped. The gallery falls
back to the badge alone when the image fails to load (`onerror`).

Tests: `packages/contract/tests/thumbnail.test.ts`,
`apps/api/tests/integration/thumbnails.test.ts`,
`apps/web/src/lib/thumbnail/thumbnailUploader.test.ts`,
`apps/web/src/lib/gallery/cardPicture.test.ts`, `e2e/galleryThumbnail.spec.ts`.
