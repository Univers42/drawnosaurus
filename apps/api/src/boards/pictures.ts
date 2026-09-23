import { createHash } from "node:crypto";
import type { Collection, ObjectId } from "mongodb";
import type { DrawElementDto } from "@drawnosaurus/contract";
import type { PictureDoc, StoredElement } from "../mongo.ts";

/**
 * Pictures, kept beside their board rather than inside it.
 *
 * A board is one MongoDB document and an image carried its picture inline, so the
 * document's 16MB ceiling was reached at two or three photos and every save after that
 * was refused. Each picture is now its own document, and the board's element keeps only
 * the key to it — which is what Excalidraw's file store does, without changing the wire:
 * an element still arrives and leaves with its `dataUrl`, and only storage differs.
 *
 * A picture is also written once per image. Clients leave it off every later edit of the
 * same image — a photo moved is a few hundred bytes, not megabytes each time — and this
 * side keeps the one it has ({@link keepPictures}).
 */

const isImage = (element: DrawElementDto): boolean => element.type === "image";

const hasPicture = (element: StoredElement): boolean =>
  element.picture !== undefined || element.dataUrl !== undefined;

function withoutPicture(element: StoredElement): StoredElement {
  if (!hasPicture(element)) return element;
  const bare = { ...element };
  delete bare.picture;
  delete bare.dataUrl;
  return bare;
}

/**
 * What the merge chose, each live image with the picture some copy of it has.
 *
 * A picture never changes once an image has one, so whichever copy carries it, it is the
 * same picture: the stored one when an edit arrived without it, the incoming one when an
 * edit reached here before its picture did. Nothing draws a deleted element, and a
 * picture is most of an image's size, so a tombstone keeps none.
 */
export function keepPictures(
  merged: readonly StoredElement[],
  stored: readonly StoredElement[],
  incoming: readonly StoredElement[],
): StoredElement[] {
  const copies = new Map<string, StoredElement>();
  for (const element of [...stored, ...incoming]) {
    if (!element.isDeleted && isImage(element) && hasPicture(element)) {
      copies.set(element.id, element);
    }
  }
  return merged.map((element) => {
    if (element.isDeleted) return withoutPicture(element);
    if (!isImage(element) || hasPicture(element)) return element;
    const copy = copies.get(element.id);
    if (!copy) return element;
    const filled: StoredElement = { ...element };
    if (copy.picture !== undefined) filled.picture = copy.picture;
    else if (copy.dataUrl !== undefined) filled.dataUrl = copy.dataUrl;
    return filled;
  });
}

const keyOf = (boardId: ObjectId, dataUrl: string): string =>
  `${boardId.toHexString()}:${createHash("sha256").update(dataUrl).digest("hex")}`;

export class PictureStore {
  private readonly pictures: Collection<PictureDoc>;

  constructor(pictures: Collection<PictureDoc>) {
    this.pictures = pictures;
  }

  /**
   * The elements as they are kept: each picture written to its own document — once, the
   * same picture twice is one — and replaced on the element by its key.
   *
   * Written before the board, so a board never names a picture that is not there. A
   * write of the board that then loses its race leaves a picture nothing names yet,
   * which the retry names.
   */
  async stow(boardId: ObjectId, elements: readonly StoredElement[]): Promise<StoredElement[]> {
    const fresh = new Map<string, string>();
    const stowed = elements.map((element) => {
      if (element.isDeleted) return withoutPicture(element);
      if (element.dataUrl === undefined) return element;
      const key = keyOf(boardId, element.dataUrl);
      fresh.set(key, element.dataUrl);
      const kept: StoredElement = { ...element, picture: key };
      delete kept.dataUrl;
      return kept;
    });
    if (fresh.size > 0) {
      const createdAt = new Date();
      await this.pictures.bulkWrite(
        [...fresh].map(([key, dataUrl]) => ({
          updateOne: {
            filter: { _id: key },
            update: { $setOnInsert: { boardId, dataUrl, createdAt } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
    return stowed;
  }

  /** The elements as they go out: each picture back on its element, as a `data:` URL. */
  async restore(elements: readonly StoredElement[]): Promise<DrawElementDto[]> {
    const keys = [
      ...new Set(elements.flatMap((element) => (element.picture ? [element.picture] : []))),
    ];
    const found = new Map<string, string>();
    if (keys.length > 0) {
      for await (const picture of this.pictures.find({ _id: { $in: keys } })) {
        found.set(picture._id, picture.dataUrl);
      }
    }
    return elements.map((element) => {
      if (element.picture === undefined) return element;
      const restored: StoredElement = { ...element };
      delete restored.picture;
      const dataUrl = found.get(element.picture);
      if (dataUrl !== undefined) restored.dataUrl = dataUrl;
      return restored;
    });
  }
}
