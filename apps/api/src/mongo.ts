import { MongoClient, type Collection, type Db, type ObjectId, type WithId } from "mongodb";
import type { DrawElementDto, WorldBounds } from "@drawnosaurus/contract";

/**
 * The stored board: one document per board with its elements embedded, so a scene
 * loads in a single read and the `.osidraw` envelope round-trips unchanged.
 *
 * `bounds` and `elementCount` are denormalised on every write so the gallery can
 * list boards without ever pulling an element array.
 *
 * Declared without `_id` and wrapped in `WithId` for reads: that is what lets an
 * insert omit the id Mongo is about to mint, with no cast.
 */
export interface BoardFields {
  slug: string;
  title: string;
  ownerId: string;
  /** `.osidraw` envelope version, not the element stamp. */
  schemaVersion: number;
  elements: StoredElement[];
  bounds: WorldBounds | null;
  elementCount: number;
  /** Bumped on every write. Drives ETag / If-Match and the internal write retry. */
  rev: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** A board as it comes back from a read. */
export type BoardDoc = WithId<BoardFields>;

/**
 * An element as it is kept: an image's picture replaced by `picture`, the key of the
 * document in `pictures` that holds it. See `boards/pictures.ts`.
 */
export type StoredElement = DrawElementDto & { picture?: string };

/**
 * One picture, out of its board's document: a board is one document, and MongoDB's
 * 16MB ceiling on one was reached at two or three photos kept inline.
 *
 * `_id` is the board's id and the SHA-256 of the `data:` URL, so the same picture
 * dropped twice on a board is kept once, and nothing outside the board can name it.
 */
export interface PictureDoc {
  _id: string;
  boardId: ObjectId;
  dataUrl: string;
  createdAt: Date;
}

export interface MongoHandle {
  client: MongoClient;
  db: Db;
  boards: Collection<BoardFields>;
  pictures: Collection<PictureDoc>;
  close: () => Promise<void>;
}

export async function connectMongo(url: string, dbName: string): Promise<MongoHandle> {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  const db = client.db(dbName);
  const boards = db.collection<BoardFields>("boards");
  const pictures = db.collection<PictureDoc>("pictures");

  return { client, db, boards, pictures, close: () => client.close() };
}

/**
 * Indexes are created at startup, not by a migration tool: there are two, both
 * additive, and `createIndex` is idempotent.
 *
 * The compound index matches the keyset pagination sort exactly
 * (ownerId equality, then updatedAt/_id descending), so a page is an index scan.
 */
export async function ensureIndexes(boards: Collection<BoardFields>): Promise<void> {
  await boards.createIndex({ slug: 1 }, { unique: true, name: "slug_unique" });
  await boards.createIndex({ ownerId: 1, updatedAt: -1, _id: -1 }, { name: "owner_recent" });
}
