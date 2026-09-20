import { MongoClient, type Collection, type Db, type WithId } from "mongodb";
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
  elements: DrawElementDto[];
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

export interface MongoHandle {
  client: MongoClient;
  db: Db;
  boards: Collection<BoardFields>;
  close: () => Promise<void>;
}

export async function connectMongo(url: string, dbName: string): Promise<MongoHandle> {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  const db = client.db(dbName);
  const boards = db.collection<BoardFields>("boards");

  return { client, db, boards, close: () => client.close() };
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
