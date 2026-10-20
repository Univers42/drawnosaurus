import { SCENE, type Head, type StoreDb } from "./storeDb.ts";

interface Drawing {
  head: Head;
  writtenAt: number;
  items: Map<string, readonly Uint8Array[]>;
}

/**
 * The store's database in a Map, for the unit tests and the dev server. Everything is lost
 * when the process ends, which is what a test wants.
 */
export function memoryStore(): StoreDb {
  const drawings = new Map<string, Drawing>();
  return {
    head: async (id) => drawings.get(id)?.head ?? null,
    scene: async (id) => {
      const drawing = drawings.get(id);
      return drawing
        ? { rev: drawing.head.rev, parts: [...(drawing.items.get(SCENE) ?? [])] }
        : null;
    },
    picture: async (id, pid) => {
      const parts = drawings.get(id)?.items.get(pid);
      return parts ? [...parts] : null;
    },
    write: async (write) => {
      const current = drawings.get(write.id);
      const items = new Map(current?.items).set(write.item, [...write.parts]);
      drawings.set(write.id, { head: write.head, writtenAt: write.writtenAt, items });
      return true;
    },
  };
}
