import { createHash } from "node:crypto";
import { Binary, type Collection, type ObjectId } from "mongodb";
import type { ThumbnailDoc } from "../mongo.ts";

export interface StoredThumbnail {
  png: Buffer;
  etag: string;
  updatedAt: Date;
}

/** One PNG per board, replaced in place; keyed by the board's `_id`. */
export class ThumbnailStore {
  private readonly thumbnails: Collection<ThumbnailDoc>;

  constructor(thumbnails: Collection<ThumbnailDoc>) {
    this.thumbnails = thumbnails;
  }

  /** Upserts the PNG and returns its ETag, a prefix of the content hash. */
  async put(boardId: ObjectId, png: Buffer): Promise<{ etag: string; updatedAt: Date }> {
    const etag = `"t-${createHash("sha256").update(png).digest("hex").slice(0, 16)}"`;
    const updatedAt = new Date();
    await this.thumbnails.updateOne(
      { _id: boardId },
      { $set: { png: new Binary(png), bytes: png.length, etag, updatedAt } },
      { upsert: true },
    );
    return { etag, updatedAt };
  }

  async get(boardId: ObjectId): Promise<StoredThumbnail | null> {
    const doc = await this.thumbnails.findOne({ _id: boardId });
    if (doc === null) return null;
    return {
      png: Buffer.from(doc.png.buffer.subarray(0, doc.png.position)),
      etag: doc.etag,
      updatedAt: doc.updatedAt,
    };
  }
}
