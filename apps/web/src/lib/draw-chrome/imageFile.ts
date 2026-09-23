/**
 * Turning a file the user picked into something the engine can place.
 *
 * Decoding is the one part of inserting an image that cannot live in the engine: only a
 * browser knows how to turn a PNG into pixels, and only it can report the natural size.
 * So this file does exactly that and nothing else — the size, the position and the
 * proportions are all decided by `engine.insertImage`, which every other frontend also
 * calls.
 *
 * The accepted types are Excalidraw's `IMAGE_MIME_TYPES` at the SHA pinned in
 * `scripts/oracle-sha.txt`.
 */

export const IMAGE_MIME_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
  "image/avif",
  "image/jfif",
] as const;

/** What a file input should offer. */
export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(",");

/**
 * The largest file worth inlining, in bytes.
 *
 * The image rides on the element as a `data:` URL, so it is carried by every autosave,
 * every realtime message and every export. Base64 adds about a third on top. Past a few
 * megabytes that stops being a picture on a board and starts being a reason the board is
 * slow, and the person who dropped it has no way to tell which of those happened.
 */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export interface DecodedImage {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

export type ImageRejection = "type" | "size" | "decode";

export function isSupportedImageType(type: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(type.toLowerCase());
}

export function isWithinSizeLimit(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= IMAGE_MAX_BYTES;
}

/**
 * Why a file cannot be inserted, or `null` if it can.
 *
 * Separated from the reading so the reasons are testable without a browser, and so a
 * host can say *which* rule a file broke rather than only that it failed.
 */
export function rejectImageFile(file: { type: string; size: number }): ImageRejection | null {
  if (!isSupportedImageType(file.type)) return "type";
  if (!isWithinSizeLimit(file.size)) return "size";
  return null;
}

/** Human-readable, for a toast or a status line. */
export function describeRejection(reason: ImageRejection): string {
  switch (reason) {
    case "type":
      return "That file is not an image drawnosaurus can read.";
    case "size":
      return `Images must be under ${Math.round(IMAGE_MAX_BYTES / (1024 * 1024))} MB.`;
    case "decode":
      return "That image could not be read.";
  }
}

/** The images among a drop's files, in the order they were dropped. */
/**
 * The longest side an inserted image keeps, in pixels. Excalidraw's
 * `DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT` (`packages/common/src/constants.ts:388`).
 *
 * Larger images are scaled down on insertion, **before** the size check. The order is the
 * point: a phone photo is routinely over 4 MB, and checking first refused it outright
 * where Excalidraw would have shrunk it and let it in. It also keeps boards small — every
 * image lives inline in the board's one database document.
 */
export const IMAGE_MAX_SIDE = 1440;

/**
 * The size an image should be stored at: unchanged when it already fits, otherwise
 * scaled so its longer side is `max`, proportions kept. Never upscales.
 */
export function scaledToFit(
  width: number,
  height: number,
  max: number = IMAGE_MAX_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > max) || !Number.isFinite(longest)) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether a file of this type and size is shrunk on the way in.
 *
 * SVG never is: it has no pixels to reduce, and rasterising it would throw away the one
 * thing that makes it worth using. Excalidraw exempts it the same way (`data/blob.ts:365`).
 */
export function needsDownscale(type: string, width: number, height: number): boolean {
  const kind = type.toLowerCase();
  // Nor GIF: a canvas re-encodes one frame, so an animation would arrive as a still.
  return (
    kind !== "image/svg+xml" && kind !== "image/gif" && Math.max(width, height) > IMAGE_MAX_SIDE
  );
}

/** The smaller of what shrinking produced and the original — see `downscaleImageFile`. */
export function smallerOf<F extends { size: number }>(shrunk: F, original: F): F {
  return shrunk.size < original.size ? shrunk : original;
}

export type PreparedImage<F> = { file: F } | { rejection: ImageRejection };

/**
 * Type, then shrink, then size — Excalidraw's order (`App.tsx:12649-12668`).
 *
 * The order is the point: a phone photo is routinely over the size limit *before* it is
 * brought down to 1440px, and checking the size first refused it outright. `shrink` is
 * passed in so the order can be tested without a browser.
 */
export async function prepareImageFile<F extends { type: string; size: number }>(
  file: F,
  shrink: (file: F) => Promise<F>,
): Promise<PreparedImage<F>> {
  if (!isSupportedImageType(file.type)) return { rejection: "type" };
  const shrunk = await shrink(file);
  const rejection = rejectImageFile(shrunk);
  return rejection ? { rejection } : { file: shrunk };
}

/**
 * Shrinks an image file to fit {@link IMAGE_MAX_SIDE}, keeping its type.
 *
 * Returns the original file whenever it does not need shrinking **or cannot be shrunk**
 * — no canvas, a decode failure, a browser that will not encode the type. Excalidraw's
 * does the same (`App.tsx:12650-12660`): a failed resize is logged and the original goes
 * on to the size check, which is then the only thing that can refuse it.
 */
export async function downscaleImageFile(file: File): Promise<File> {
  if (!needsDownscale(file.type, Infinity, Infinity)) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (!needsDownscale(file.type, width, height)) {
      bitmap.close();
      return file;
    }
    const target = scaledToFit(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();
    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    let blob = await encode(file.type);
    // `toBlob` falls back to PNG for a type it cannot encode — AVIF, BMP, and WebP in
    // Safari — and a lossless PNG of a photo can be several times the size of the lossy
    // original. WebP keeps it small where the browser has it.
    if (blob && blob.type !== file.type) {
      const webp = await encode("image/webp");
      if (webp && webp.type === "image/webp" && webp.size < blob.size) blob = webp;
    }
    if (!blob) return file;
    // Never trade a file for a bigger one: its pixels are fewer, but the size check and
    // the board's 16MB are about bytes.
    const shrunk = new File([blob], file.name, { type: blob.type || file.type });
    return smallerOf(shrunk, file);
  } catch {
    return file;
  }
}

export function imagesFrom(files: readonly File[]): File[] {
  return files.filter((file) => isSupportedImageType(file.type));
}

/**
 * Read a file and decode it far enough to know how big it is.
 *
 * Resolves `null` when the image cannot be decoded — a file renamed to `.png`, or one
 * truncated in transit. The caller places nothing rather than an element with no size.
 */
export async function readImageFile(file: File): Promise<DecodedImage | null> {
  const dataUrl = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  if (!dataUrl) return null;

  return await new Promise<DecodedImage | null>((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        dataUrl,
        // An SVG with no intrinsic size reports 0. Falling back to its box keeps it
        // placeable instead of silently refused, which is what a 0 would cause.
        naturalWidth: image.naturalWidth || image.width,
        naturalHeight: image.naturalHeight || image.height,
      });
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}
