import type { Change, Head, Item, Part, StoreDb } from "./storeDb.ts";

interface Drawing {
  head: Head;
  writtenAt: number;
  items: Map<string, Part[]>;
}

const dropStarting = (items: Map<string, Part[]>, prefix: string): void => {
  for (const item of items.keys()) if (item.startsWith(prefix)) items.delete(item);
};

function apply(items: Map<string, Part[]>, change: Change): void {
  switch (change.kind) {
    case "put": {
      const parts = [...(items.get(change.item) ?? [])];
      parts[change.n] = { total: change.total, bytes: change.bytes };
      items.set(change.item, parts);
      return;
    }
    case "trim": {
      const parts = items.get(change.item)?.slice(0, change.from) ?? [];
      if (parts.length === 0) items.delete(change.item);
      else items.set(change.item, parts);
      return;
    }
    case "rename": {
      const parts = items.get(change.from);
      items.delete(change.from);
      if (parts) items.set(change.to, parts);
      return;
    }
    case "dropStaged":
      dropStarting(items, "@");
      return;
    case "dropPending":
      dropStarting(items, "#");
  }
}

const summary = (parts: Part[] | undefined): Item | null =>
  parts?.[0]
    ? {
        parts: parts.length,
        total: parts[0].total,
        bytes: parts.reduce((size, part) => size + part.bytes.byteLength, 0),
      }
    : null;

/**
 * The store's database in a Map, for the unit tests and the dev server. It keeps what the
 * handlers rely on from D1 — a write lands only on the nonce it was decided on, and sweeps in
 * the same step — and everything is lost when the process ends, which is what a test wants.
 */
export function memoryStore(): StoreDb {
  const drawings = new Map<string, Drawing>();
  const partsOf = (id: string, item: string): Part[] | undefined =>
    drawings.get(id)?.items.get(item);
  return {
    head: async (id) => drawings.get(id)?.head ?? null,
    item: async (id, item) => summary(partsOf(id, item)),
    part: async (id, item, n) => partsOf(id, item)?.[n] ?? null,
    read: async (id, item, n) => {
      const drawing = drawings.get(id);
      return drawing
        ? {
            rev: drawing.head.rev,
            writtenAt: drawing.writtenAt,
            item: summary(partsOf(id, item)),
            part: partsOf(id, item)?.[n] ?? null,
          }
        : null;
    },
    write: async (write) => {
      const current = drawings.get(write.id);
      if ((current?.head.nonce ?? null) !== write.seen) return false;
      const items = new Map(current?.items);
      for (const change of write.changes) apply(items, change);
      drawings.set(write.id, { head: write.head, writtenAt: write.writtenAt, items });
      const expired = [...drawings]
        .filter(([, drawing]) => drawing.writtenAt < write.sweep.before)
        .sort(([a, x], [b, y]) => x.writtenAt - y.writtenAt || (a < b ? -1 : 1))
        .slice(0, write.sweep.limit);
      for (const [id] of expired) drawings.delete(id);
      return true;
    },
  };
}
