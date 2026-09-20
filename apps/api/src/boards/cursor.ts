import { ObjectId } from "mongodb";
import { badRequest } from "../errors.ts";

/**
 * Keyset pagination cursor: `updatedAt` plus `_id` as the tiebreaker.
 *
 * Offset/skip pagination drifts when a board is edited mid-scroll (rows shift
 * under the reader, so items repeat or vanish). A keyset cursor names the exact
 * position instead, and matches the `owner_recent` index order.
 */
export interface Cursor {
  updatedAt: Date;
  id: ObjectId;
}

export function encodeCursor(cursor: Cursor): string {
  const raw = `${cursor.updatedAt.getTime()}|${cursor.id.toHexString()}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  const raw = Buffer.from(value, "base64url").toString("utf8");
  const [millis, hex] = raw.split("|");

  if (millis === undefined || hex === undefined) throw badRequest("malformed cursor", "bad_cursor");

  const time = Number.parseInt(millis, 10);
  if (!Number.isFinite(time) || !ObjectId.isValid(hex)) {
    throw badRequest("malformed cursor", "bad_cursor");
  }

  return { updatedAt: new Date(time), id: new ObjectId(hex) };
}

/**
 * "Strictly after this position" in a (updatedAt desc, _id desc) ordering.
 * Splitting it this way is what makes the page boundary exact even when several
 * boards share a millisecond.
 */
export function cursorFilter(cursor: Cursor): Record<string, unknown> {
  return {
    $or: [
      { updatedAt: { $lt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, _id: { $lt: cursor.id } },
    ],
  };
}
