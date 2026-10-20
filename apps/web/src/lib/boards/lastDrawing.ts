import { slugSchema } from "@drawnosaurus/contract";

/**
 * The drawing last open in this browser: what `/` reopens in the public build, as
 * Excalidraw reopens its last scene (the spec's Goal 1).
 *
 * Only its slug, in localStorage beside the other `drawnosaurus:` keys; the drawing is in
 * IndexedDB (`store/browser.ts`). A drawing deleted from the gallery is forgotten here as
 * well, or `/` would bring it back as a blank under its old id — and a drawing's id is also
 * its relay topic and its online copy's key once it is shared. Deleting is the one way a
 * drawing stops being stored that this browser does not also clear this key with.
 *
 * Every read and write is a convenience: storage that is missing or throws opens a new
 * drawing, which is what a first visit does anyway.
 */
export const LAST_DRAWING_KEY = "drawnosaurus:lastDrawing";

/** The slug last remembered, or null. `/` goes to its address, so it must be a slug. */
export function recallLastDrawing(storage: Pick<Storage, "getItem"> | undefined): string | null {
  try {
    const stored = storage?.getItem(LAST_DRAWING_KEY) ?? null;
    return stored !== null && slugSchema.safeParse(stored).success ? stored : null;
  } catch {
    return null;
  }
}

export function rememberLastDrawing(
  storage: Pick<Storage, "setItem"> | undefined,
  slug: string,
): void {
  try {
    storage?.setItem(LAST_DRAWING_KEY, slug);
  } catch {
    // A private window, a full quota: `/` opens a new drawing next time instead.
  }
}

/** For a deleted drawing: when it is the one remembered, nothing is from now on. */
export function forgetLastDrawing(
  storage: Pick<Storage, "getItem" | "removeItem"> | undefined,
  slug: string,
): void {
  try {
    if (storage?.getItem(LAST_DRAWING_KEY) === slug) storage.removeItem(LAST_DRAWING_KEY);
  } catch {
    // As above. The key it could not clear names a drawing no longer stored, which opens
    // as a blank under that id: the case this module exists to avoid, and storage that
    // refuses every write leaves no better choice.
  }
}
