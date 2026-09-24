/**
 * Sending an image's picture once, rather than with every edit of the image.
 *
 * A picture is a `data:` URL on the element, up to megabytes, and it never changes once
 * an image has one. Every edit sent the whole element: moving a photo sent the photo —
 * to the server, and to everyone in the room, who each saved it to the server again.
 * Now what the other side is known to have is left off, and it keeps the picture it has
 * for an edit that arrives without one: the server (`api/src/boards/pictures.ts`), the
 * engine (`engine/clipboard.rs`), and the page (`fillPictures`).
 */

interface Pictured {
  id: string;
  type?: string;
  isDeleted: boolean;
  dataUrl?: string;
}

const pictured = (element: object): Pictured => element as Pictured;

/** What one other side — the server, or the room — is known to hold as each picture. */
export class PictureLedger {
  private readonly held = new Map<string, string>();

  /** Starts over, from what the other side is known to have. */
  reset(elements: readonly object[]): void {
    this.held.clear();
    this.note(elements);
  }

  /**
   * The other side now has these, as they are. A copy without its picture changes
   * nothing: the other side keeps the one it had. A tombstone keeps none.
   */
  note(elements: readonly object[]): void {
    for (const element of elements.map(pictured)) {
      if (element.isDeleted) this.held.delete(element.id);
      else if (element.dataUrl !== undefined) this.held.set(element.id, element.dataUrl);
    }
  }

  /** `elements`, each without a picture the other side already has. */
  strip<T extends object>(elements: readonly T[]): T[] {
    return elements.map((element) => {
      const { id, isDeleted, dataUrl } = pictured(element);
      if (isDeleted || dataUrl === undefined || this.held.get(id) !== dataUrl) return element;
      const bare = { ...element } as T & { dataUrl?: string };
      delete bare.dataUrl;
      return bare;
    });
  }
}

/**
 * `elements`, each live image that arrived without its picture given the one `known`
 * has for it — the same picture, which the sender knew was already here.
 */
export function fillPictures<T extends object>(
  elements: readonly T[],
  known: (id: string) => object | undefined,
): T[] {
  return elements.map((element) => {
    const { id, type, isDeleted, dataUrl } = pictured(element);
    if (type !== "image" || isDeleted || dataUrl !== undefined) return element;
    const here = known(id);
    const picture = here && !pictured(here).isDeleted ? pictured(here).dataUrl : undefined;
    return picture === undefined ? element : { ...element, dataUrl: picture };
  });
}
