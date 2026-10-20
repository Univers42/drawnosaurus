import { resolveRoomKey } from "./roomCrypto.ts";

/**
 * Whether a drawing has a live link, and the key its frames are sealed with.
 *
 * The Docker build connects every board, its key derived from the slug and written into
 * the address (`resolveRoomKey`). The public build connects a drawing only once it has been
 * shared — the spec's anti-goal: an unshared drawing connects to nothing — and nothing
 * shares one yet, so there it is null: no live link at all, no socket, nothing to report.
 */

export interface LiveKeyOptions {
  /** The public build. Passed in: only the routes read `BROWSER_MODE`. */
  browser: boolean;
  slug: string;
  location: { hash: string; pathname: string; search: string };
}

export async function liveKeyFor({
  browser,
  slug,
  location,
}: LiveKeyOptions): Promise<Uint8Array | null> {
  // The share secret will give a shared drawing its key here (the spec's _The secret_).
  if (browser) return null;
  return resolveRoomKey(slug, location);
}
