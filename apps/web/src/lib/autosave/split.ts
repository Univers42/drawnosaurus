import type { ScenePatch, StampedElement } from "./sceneDiff.ts";

/**
 * The most one autosave request may carry, in characters of JSON.
 *
 * Under the API's 8MB body limit with room for the envelope. One image may be up to
 * 6MB of `data:` URL (`MAX_IMAGE_DATA_URL_LENGTH`), so two new pictures in one patch
 * used to exceed the limit together and be refused together — with every other edit
 * in the same request.
 */
export const MAX_REQUEST_CHARS = 7 * 1024 * 1024;

const hasPicture = (element: StampedElement): boolean =>
  typeof (element as { dataUrl?: unknown }).dataUrl === "string";

/**
 * Splits a patch into requests the server will take one at a time.
 *
 * Every element carrying a picture travels **alone and last**; the rest go first, as
 * few requests as fit. So a picture the server refuses — too large for the request, or
 * for the board — refuses only itself: everything else in the patch has already been
 * merged by then. The server merges per element, so a request that lands twice (a
 * retry after a later one failed) changes nothing.
 *
 * `order` rides on every request. The server ignores ids it does not have yet and puts
 * them on top, so an order sent before an image arrives would leave the image on top;
 * repeated with each request, the last one to land sequences everything.
 */
export function splitPatch<T extends StampedElement>(
  patch: ScenePatch<T>,
  maxChars: number = MAX_REQUEST_CHARS,
): ScenePatch<T>[] {
  const withOrder = (elements: T[]): ScenePatch<T> =>
    patch.order === undefined ? { elements } : { elements, order: patch.order };

  const pictures: T[] = [];
  const batches: T[][] = [];
  let batch: T[] = [];
  let size = 0;
  for (const element of patch.elements) {
    if (hasPicture(element)) {
      pictures.push(element);
      continue;
    }
    const length = JSON.stringify(element).length;
    if (batch.length > 0 && size + length > maxChars) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(element);
    size += length;
  }
  if (batch.length > 0 || (pictures.length === 0 && batches.length === 0)) batches.push(batch);

  return [...batches.map(withOrder), ...pictures.map((picture) => withOrder([picture]))];
}
