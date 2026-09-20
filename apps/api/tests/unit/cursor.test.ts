import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { cursorFilter, decodeCursor, encodeCursor } from "../../src/boards/cursor.ts";

describe("cursor round-trip", () => {
  it("survives encode then decode", () => {
    const cursor = { updatedAt: new Date("2026-09-20T12:34:56.789Z"), id: new ObjectId() };
    const decoded = decodeCursor(encodeCursor(cursor));

    expect(decoded.updatedAt.toISOString()).toBe(cursor.updatedAt.toISOString());
    expect(decoded.id.toHexString()).toBe(cursor.id.toHexString());
  });

  it("is URL-safe so it needs no extra escaping", () => {
    const encoded = encodeCursor({ updatedAt: new Date(0), id: new ObjectId() });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects garbage with a 400 rather than scanning the collection", () => {
    for (const bad of [
      "not-a-cursor",
      encodeCursor.name,
      Buffer.from("1|nope").toString("base64url"),
    ]) {
      expect(() => decodeCursor(bad)).toThrowError(
        expect.objectContaining({ status: 400 }) as unknown as Error,
      );
    }
  });
});

describe("cursorFilter", () => {
  it("asks for rows strictly after the position, tie-broken by id", () => {
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    const id = new ObjectId();

    // Both branches are required: several boards can share a millisecond, and
    // without the _id tiebreak a page boundary would repeat or skip them.
    expect(cursorFilter({ updatedAt, id })).toEqual({
      $or: [{ updatedAt: { $lt: updatedAt } }, { updatedAt, _id: { $lt: id } }],
    });
  });
});
