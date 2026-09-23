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

That cost has a hard edge: **a board is one MongoDB document**, so the pictures share its
16MB. One element may carry at most `MAX_IMAGE_DATA_URL_LENGTH` (6MB, a little over the
4MB file limit once base64 is paid), which always fits one autosave under the 8MB body
limit. Two or three large pictures fill the document. The repository measures the BSON
size before writing and refuses with **413 `board_too_large`**; it used to be a 500 —
a little over, the server refuses the update; further over, the driver throws a bare
`RangeError` serialising the command, so the size is checked up front rather than
recognised afterwards.

The fix for the ceiling is a file store keyed by id. Recorded as a gap in the
conformance registry ("Image IDs", "Image file store").

## Rendering

**IMPLEMENTATION DETAIL** — decoded `<img>`s are cached by `data:` URL in `wasm/paint.rs`.
The first paint finds the image still decoding and draws the placeholder frame; `onload`
must then **invalidate the static layer**, not only request a frame — the layer plan would
otherwise reuse the cached bitmap with the placeholder in it until something else moved.

**VERIFIED** — SVG export writes an `<image href>` with `preserveAspectRatio="none"`, and
nothing at all for an image with no picture yet, rather than a broken reference
(`ci_image.rs`).

## Unknown

- **UNKNOWN** — behaviour at the 16MB edge for boards created before the size check,
  if any already sit near it. None were observed.
- **UNKNOWN** — per-format decode. We accept what the browser decodes; WebP/AVIF/HEIC are
  not asserted per format (recorded gap, "WebP").
