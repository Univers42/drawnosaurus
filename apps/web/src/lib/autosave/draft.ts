/**
 * The local copy of a board, kept in case the server cannot be reached.
 *
 * Best effort, and never allowed to throw. `localStorage` holds about five million
 * characters per origin, and a board with a few photos on it is past that: `setItem`
 * threw, and because it ran before the autosave was told about the change, the throw
 * stopped the autosave and the live broadcast too — silently, with the header still
 * reading "Saved". The server is the record; this is the fallback.
 */

export const DRAFT_PREFIX = "drawnosaurus:draft:";

export type DraftWritten = "full" | "without-pictures" | "none";

/** Everything but the pictures: the drawing survives, the photos come back from the server. */
function withoutPictures(elements: readonly unknown[]): unknown[] {
  return elements.map((element) => {
    if (typeof element !== "object" || element === null || !("dataUrl" in element)) {
      return element;
    }
    const copy = { ...(element as Record<string, unknown>) };
    delete copy.dataUrl;
    return copy;
  });
}

export function writeDraft(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  slug: string,
  elements: readonly unknown[],
): DraftWritten {
  if (!storage || !slug) return "none";
  const key = `${DRAFT_PREFIX}${slug}`;
  const envelope = (list: readonly unknown[]) =>
    JSON.stringify({ type: "osidraw", version: 1, elements: list });
  try {
    storage.setItem(key, envelope(elements));
    return "full";
  } catch {
    // Almost always the quota. Fall through to the smaller copy.
  }
  try {
    storage.setItem(key, envelope(withoutPictures(elements)));
    return "without-pictures";
  } catch {
    // A stale draft is worse than none: it would be loaded as if it were current.
    try {
      storage.removeItem(key);
    } catch {
      // Storage is unavailable altogether; nothing to clean up.
    }
    return "none";
  }
}
