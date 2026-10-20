import { resolveRoomKey } from "./roomCrypto.ts";

/**
 * Whether a drawing has a live link, and the key its frames are sealed with.
 *
 * The Docker build connects every board, its key derived from the slug and written into
 * the address (`resolveRoomKey`). The public build connects a drawing only once it has been
 * shared — the spec's anti-goal: an unshared drawing connects to nothing. There the key is
 * the drawing's own secret (`sharing/secret.ts`), and without one it is null: no live link
 * at all, no socket, nothing to report.
 */

export interface LiveKeyOptions {
  /** The public build. Passed in: only the routes read `BROWSER_MODE`. */
  browser: boolean;
  slug: string;
  location: { hash: string; pathname: string; search: string };
  /** The public build's: the secret the drawing was shared with, or null. */
  secret: Uint8Array | null;
}

export async function liveKeyFor({
  browser,
  slug,
  location,
  secret,
}: LiveKeyOptions): Promise<Uint8Array | null> {
  if (browser) return secret;
  return resolveRoomKey(slug, location);
}
