import { BSON, type Collection } from "mongodb";
import {
  applyOrder,
  liveElements,
  reconcileElements,
  sceneBounds,
  SUPPORTED_OSIDRAW_VERSION,
  type BoardSummary,
  type DrawElementDto,
} from "@drawnosaurus/contract";
import { boardTooLarge, conflict, notFound } from "../errors.ts";
import type { BoardDoc, BoardFields, StoredElement } from "../mongo.ts";
import { cursorFilter, decodeCursor, encodeCursor } from "./cursor.ts";
import { keepPictures, type PictureStore } from "./pictures.ts";
import { toSummary } from "./presenter.ts";
import { mintSlug } from "./slug.ts";

export interface ListResult {
  boards: BoardSummary[];
  nextCursor: string | null;
}

export interface PatchResult {
  board: BoardDoc;
  applied: number;
  rejected: number;
}

/**
 * A rev-guarded write can lose the race to a concurrent writer. Reconciliation is
 * order-independent, so simply re-reading and retrying converges — bounded, so a
 * pathological hot board returns 409 instead of spinning.
 */
const MAX_WRITE_ATTEMPTS = 4;

/**
 * MongoDB's ceiling on one document. A board is one document with its elements inline —
 * everything but pictures, which are kept beside it (`pictures.ts`) — so this is the
 * ceiling on a board's shapes and text.
 *
 * Checked before writing rather than recognised afterwards, because past it the failure
 * has no single shape: a little over, the server refuses the update; further over, the
 * driver cannot even serialise the command and throws a bare `RangeError`. Both used to
 * surface as a 500.
 */
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

export class BoardRepository {
  private readonly boards: Collection<BoardFields>;
  private readonly pictures: PictureStore;

  constructor(boards: Collection<BoardFields>, pictures: PictureStore) {
    this.boards = boards;
    this.pictures = pictures;
  }

  /**
   * Every query carries `ownerId` and `deletedAt: null`. Scoping at this level
   * rather than in the handlers is what makes cross-owner access impossible by
   * construction instead of by review.
   */
  private scope(ownerId: string, slug: string): Record<string, unknown> {
    return { ownerId, slug, deletedAt: null };
  }

  async list(ownerId: string, limit: number, cursor?: string): Promise<ListResult> {
    const filter: Record<string, unknown> = { ownerId, deletedAt: null };
    if (cursor !== undefined) Object.assign(filter, cursorFilter(decodeCursor(cursor)));

    // One extra row is the "is there another page" probe — cheaper than a count.
    const rows = await this.boards
      .find(filter, { projection: { elements: 0 } })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const hasMore = rows.length > limit && last !== undefined;

    return {
      boards: page.map(toSummary),
      nextCursor: hasMore ? encodeCursor({ updatedAt: last.updatedAt, id: last._id }) : null,
    };
  }

  async create(ownerId: string, title: string): Promise<BoardDoc> {
    const now = new Date();
    // Mongo mints _id, so the insert shape is the document without it.
    const doc: BoardFields = {
      slug: mintSlug(),
      title,
      ownerId,
      schemaVersion: SUPPORTED_OSIDRAW_VERSION,
      elements: [],
      bounds: null,
      elementCount: 0,
      rev: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const { insertedId } = await this.boards.insertOne(doc);
    return { ...doc, _id: insertedId };
  }

  async findBySlug(ownerId: string, slug: string): Promise<BoardDoc> {
    const doc = await this.boards.findOne(this.scope(ownerId, slug));
    if (doc === null) throw notFound();
    return doc;
  }

  /** A board as it goes out, its pictures back on their images — see `pictures.ts`. */
  async read(ownerId: string, slug: string): Promise<BoardDoc> {
    return await this.withPictures(await this.findBySlug(ownerId, slug));
  }

  async withPictures(doc: BoardDoc): Promise<BoardDoc> {
    return { ...doc, elements: await this.pictures.restore(doc.elements) };
  }

  /** Full replace, guarded by the rev the caller says it saw (`If-Match`). */
  async replace(
    ownerId: string,
    slug: string,
    elements: DrawElementDto[],
    expectedRev: number,
    title?: string,
  ): Promise<BoardDoc> {
    const current = await this.findBySlug(ownerId, slug);
    if (current.rev !== expectedRev) {
      throw conflict(`board has moved on (rev ${current.rev}, you sent ${expectedRev})`);
    }

    const updated = await this.commit(current, elements, title);
    if (updated === null) throw conflict("board changed during the write; re-read and retry");
    return updated;
  }

  /** The autosave path: merge changed elements, newest stamp per id winning. */
  async patchElements(
    ownerId: string,
    slug: string,
    incoming: DrawElementDto[],
    order?: readonly string[],
  ): Promise<PatchResult> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const current = await this.findBySlug(ownerId, slug);
      const merged = reconcileElements<StoredElement>(current.elements, incoming);
      const kept = keepPictures(merged.elements, current.elements, incoming);
      const elements = order === undefined ? kept : applyOrder(kept, order);

      const updated = await this.commit(current, elements);
      if (updated !== null) {
        return { board: updated, applied: merged.applied, rejected: merged.rejected };
      }
    }

    throw conflict("board is being written too often; retry");
  }

  async softDelete(ownerId: string, slug: string): Promise<void> {
    const result = await this.boards.updateOne(this.scope(ownerId, slug), {
      $set: { deletedAt: new Date(), updatedAt: new Date() },
      $inc: { rev: 1 },
    });
    if (result.matchedCount === 0) throw notFound();
  }

  /**
   * The single write path. The `rev` in the filter is the optimistic lock: if
   * another request committed between our read and this update, nothing matches and
   * the caller decides whether to retry.
   */
  private async commit(
    current: BoardDoc,
    elements: StoredElement[],
    title?: string,
  ): Promise<BoardDoc | null> {
    elements = await this.pictures.stow(current._id, elements);
    const patch: Record<string, unknown> = {
      elements,
      bounds: sceneBounds(elements),
      elementCount: liveElements(elements).length,
      updatedAt: new Date(),
    };
    if (title !== undefined) patch.title = title;

    if (
      BSON.calculateObjectSize({ ...current, ...patch, rev: current.rev + 1 }) > MAX_DOCUMENT_BYTES
    ) {
      throw boardTooLarge();
    }

    return await this.boards.findOneAndUpdate(
      { _id: current._id, rev: current.rev },
      { $set: patch, $inc: { rev: 1 } },
      { returnDocument: "after" },
    );
  }
}
