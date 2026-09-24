# Images

Confidence markers: **OBSERVED** (seen in the running app), **VERIFIED** (read in the
pinned source _and_ observed), **INFERRED**, **IMPLEMENTATION DETAIL**, **UNKNOWN**.

Oracle pinned at `scripts/oracle-sha.txt`; line numbers are
`packages/excalidraw/components/App.tsx` unless stated. Measurements taken 2026-09-23
through `editor-inspector` and `e2e/image.spec.ts`.

## What was wrong

Reported as "the image cannot be dragged, moved or dropped". Four independent causes; each
is now pinned by a test that was run red against the old code before it went green.

| cause                                                                                                                                                                                                                                                   | pinned by                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| The picture was painted at **twice** the element's offset: `with_element_transform` translates to the element, and `paint_image` then drew at `element.x, element.y` again. An element at 540 painted at 1080, so grabbing the picture grabbed nothing. | `image.spec.ts` › painted inside its own element; › picked up by its picture |
| After a drop or paste the tool could stay on Image, under which the engine ignores presses (`engine/pointer.rs:50`).                                                                                                                                    | › dismissing the picker gives the board back                                 |
| Drops were handled on the canvas only. The toolbar, inspector and zoom bar float over it, and a file drop nobody cancels is opened by the browser **in place of the board**.                                                                            | › a drop on a floating panel; › a dropped file that is not an image          |
| A pasted image fell through to the engine's paste handler, which reads text only and then pastes its internal clipboard.                                                                                                                                | › pasting an image places it                                                 |

And one that made every image fail silently later: `packages/contract` did not list
`dataUrl`, zod strips unknown keys, so **every image saved as an empty frame** and came
back after a reload as the grey placeholder (`apps/api/tests/integration/images.test.ts`).

## Insertion

**VERIFIED** — Excalidraw's order is type → shrink → size (`12649-12668`): the file is
brought down to `maxWidthOrHeight` first and only then held to `maxFileSizeBytes`. Checking
size first refuses most phone photos outright. We match: `IMAGE_MAX_SIDE = 1440`, the type
is kept, SVG is exempt (it has no pixels to shrink), and a file that cannot be shrunk goes
through unchanged (`imageFile.ts` › `downscaleImageFile`).

**VERIFIED** — every insertion ends in `actionFinalize` (`13002-13005`): what was placed is
selected and the tool returns to the selection tool. A dismissed picker takes the same
path through its `AbortError` branch (`12773-12789`). We return to Select unless the tool
is locked.

**VERIFIED** — images are inserted with `roundness: null` (`10084`). Ours inherited the
default style's Round, and the panel described a corner the bitmap does not have.

**VERIFIED** — the drop handler is on the editor **container**, not the canvas (`2451`),
and `dragover`/`drop` are cancelled on it unconditionally (`4224-4235`). Ours now lives on
`.draw-chrome`, and cancels any file drop, image or not.

**Divergence, deliberate** — Excalidraw ignores a paste unless the element under the
pointer is the canvas (`4771-4782`). Ours takes a paste anywhere in the editor except a
field or a dialog; refusing a paste because the pointer happened to rest on the toolbar
reads as broken.

## Storage

**IMPLEMENTATION DETAIL** — the picture rides on the element as a `data:` URL. Excalidraw
keeps a `fileId` on the element and the bytes in a separate `BinaryFiles` store; that is the
better end state. Ours makes save, load, undo, copy/paste, export and realtime work with
no new plumbing, at the cost of scene size.

On the wire, that is. **Stored, each picture is its own document** (`apps/api/src/boards/
pictures.ts`): a board is one MongoDB document with a 16MB ceiling, which inline pictures
reached at two or three photos. The element keeps only a key — the board's id and the
SHA-256 of the `data:` URL — and the picture is put back on the way out, so neither the
client nor the wire changed (`images.test.ts` › keeps every one of them). One element may
carry at most `MAX_IMAGE_DATA_URL_LENGTH` (6MB, a little over the 4MB file limit once base64
is paid).

**A picture is sent once per image.** It never changes once an image has one, so the
autosave and the live link leave off a picture the other side is known to have
(`PictureLedger`, `autosave/pictures.ts`), and every side keeps the picture it has for an
edit that arrives without one — the server (`keepPictures`), the engine
(`inherit_picture`, `ci_live_sync.rs`) and the page (`fillPictures`). Moving a photo used
to send the photo, to the server and to everyone in the room, who each saved it again. A
peer's drag is streamed without it too; the painter draws the picture it already decoded
for that element.

What else keeps that workable, each found by review and each pinned by a test:

- **Deleted pictures give their room back.** A tombstone used to keep its `dataUrl`, so a
  board that had once held three photos refused the next one while showing none. The
  engine's tombstone, the host's synthesised one and the server's stored copy all drop it
  now (`ci_version_stamps.rs`, `sceneDiff.test.ts`, `images.test.ts` › gives its room back).
  Undo does not need it: each history step keeps its own copy of the element.
- **A picture travels alone.** The autosave splits a patch so every element carrying a
  picture is its own request, after everything else (`split.ts`). One the server refuses
  refuses only itself; the edits beside it have already been merged. Two new photos no
  longer exceed the 8MB body limit together.
- **A refusal is an answer, not a retry.** A 413 — the board's shapes and text over 16MB,
  measured as BSON before the write — used to be retried every thirty seconds forever. It now stops, and the
  header reads "Not saved — board over 16 MB" until the next change (`autosaver.test.ts`).
- **The local draft cannot stop the autosave.** `localStorage` holds about five million
  characters; a board with a few photos is past that, and the draft's `setItem` threw
  before the autosave was told about the change — silently, with the header reading
  "Saved". The draft now lives in IndexedDB, written a change at a time off the frame
  that made it, and a failed write is dropped rather than thrown (`draftStore.test.ts`).

The wire still carries the picture on the element rather than a file id, and nothing
removes a picture no element names any more. Recorded as a gap in the conformance registry
("Image IDs", "Image file store").

## Rendering

**IMPLEMENTATION DETAIL** — decoded `<img>`s are cached by element id in `wasm/paint.rs`,
with the URL's length to notice a change. Keyed by the URL itself, every frame that painted
an image hashed megabytes of it.
The first paint finds the image still decoding and draws the placeholder frame; `onload`
must then **invalidate the static layer**, not only request a frame — the layer plan would
otherwise reuse the cached bitmap with the placeholder in it until something else moved.

**VERIFIED** — SVG export writes an `<image href>` with `preserveAspectRatio="none"`, and
nothing at all for an image with no picture yet, rather than a broken reference
(`ci_image.rs`).

## Flip

**VERIFIED** — a flipped image mirrors its pixels, as Excalidraw's does. The oracle keeps
width and height positive and multiplies a `scale: [sx, sy]` field by -1 on the flipped
axis (`element/src/resizeElements.ts:1484-1489`); its painter translates to the element's
centre, rotates, then scales by it (`element/src/renderElement.ts:820-837` at 1118751f).
Ours stores the same fact as a **negative width or height**: `element_matrix` in
`wasm/paint.rs` applies it as a scale of -1 in the same order — centre, rotation, mirror —
and the SVG export writes the same `translate · rotate · scale` (`export/svg.rs` ›
`image_transform`). One transform, stored two ways: a turned picture flipped turns the
other way and mirrors about its own centre, and flipped twice is exactly as it was.

A `scale` field was deliberately not added to `packages/contract`: it would be a wire
change with nothing to gain, and a negative extent already round-trips through the server
(`finite` allows it). Every other box kind is reflected without changing the sign of its
extent: a positive one stays positive, as the oracle's always is (`resize.md` › Flip).

Pinned by `ci_flip.rs` › `an_image_mirrors_its_pixels_and_an_embed_does_not`, `ci_image.rs`
› `a_flipped_image_exports_flipped` and `e2e/flip.spec.ts` › an image's pixels swap sides.
An embed is the opposite case: moved and turned, its page never mirrored.

## Unknown

- **UNKNOWN** — behaviour at the 16MB edge for boards created before the size check,
  if any already sit near it. None were observed.
- Shrinking re-encodes in the file's own type where the browser can, and otherwise tries
  WebP; it never keeps a result larger than the original, and leaves GIFs alone rather
  than flattening an animation to one frame (`imageFile.test.ts`).
- **UNKNOWN** — per-format decode. We accept what the browser decodes; WebP/AVIF/HEIC are
  not asserted per format (recorded gap, "WebP").
