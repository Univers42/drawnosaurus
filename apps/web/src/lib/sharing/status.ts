import type { AutosaveStatus } from "../autosave/autosaver.ts";

/**
 * What the header says about a shared drawing's online copy: its saver's status, or one of
 * two things the saver cannot know — that opening the drawing could not read the copy
 * (`unread`), or that the tab which last had it closed before its last save landed
 * (`unsent`). A request sent while a page closes may carry at most 64 KB (`keepalive`), so
 * the last seconds of edits can miss the copy; this browser still has them, and sends them
 * with its next save.
 */
export type SharedLine = AutosaveStatus | "unread" | "unsent";

export const SHARED_LABELS: Record<SharedLine, string> = {
  idle: "Shared copy saved",
  pending: "Shared copy: unsaved changes",
  saving: "Saving the shared copy…",
  error: "Shared copy unavailable — retrying",
  "too-large": "Shared copy not saved — over 10 MB",
  refused: "Shared copy not saved — this link cannot write it",
  unread: "Shared copy unavailable — could not be read",
  unsent: "Shared copy may lack the last seconds before the tab closed",
};

/**
 * The line to show. A failure first, the final answers before the one being retried; then
 * a copy not read, then one that may lack edits — both still true while a save is under
 * way, until it lands; then the saver's own word.
 */
export function sharedLine(
  status: AutosaveStatus,
  { unread, unsent }: { unread: boolean; unsent: boolean },
): SharedLine {
  if (status === "too-large" || status === "refused" || status === "error") return status;
  if (unread) return "unread";
  if (unsent) return "unsent";
  return status;
}

const unsentKey = (slug: string): string => `hydrawn:unsent:${slug}`;

/**
 * Storage the page may not have: a private window, blocked site data. Synchronous, unlike
 * IndexedDB, so the mark is down before a closing page is gone.
 */
function attempt<T>(run: () => T, otherwise: T): T {
  try {
    return run();
  } catch {
    return otherwise;
  }
}

/** The page is leaving with edits its copy may not get. */
export const markUnsent = (storage: Storage | null, slug: string): void =>
  attempt(() => storage?.setItem(unsentKey(slug), "1"), undefined);

/** A save landed after it: the copy has everything again. */
export const forgetUnsent = (storage: Storage | null, slug: string): void =>
  attempt(() => storage?.removeItem(unsentKey(slug)), undefined);

export const isUnsent = (storage: Storage | null, slug: string): boolean =>
  attempt(() => storage?.getItem(unsentKey(slug)) === "1", false);
