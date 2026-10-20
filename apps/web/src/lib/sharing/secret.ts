import { formatRoomHash, parseRoomKeyFromHash } from "../realtime/roomCrypto.ts";
import type { SecretStore } from "../store/types.ts";

/**
 * A shared drawing's secret: the 32 bytes its link carries as `#room=`, which seal its live
 * frames and its online copy and derive the copy's write token (`realtime/roomCrypto.ts`).
 * It never leaves the browser except in the link, whose fragment no server is sent.
 */

/**
 * The drawing's secret, or null when it has never been shared.
 *
 * The one kept with the drawing wins over one in the address: a link to a drawing of yours
 * with another secret in it does not take your drawing over. A link's secret is adopted,
 * and kept, only by a drawing that has none — which is how someone who opens a link gets
 * the drawing as theirs too.
 */
export async function drawingSecret(
  store: SecretStore,
  slug: string,
  hash: string,
): Promise<Uint8Array | null> {
  const kept = await store.secret(slug);
  if (kept) return kept;
  const linked = parseRoomKeyFromHash(hash);
  if (linked) await store.keepSecret(slug, linked);
  return linked;
}

/** The link to send: the drawing's address, its secret in the fragment. */
export const shareLink = (origin: string, slug: string, secret: Uint8Array): string =>
  `${origin.replace(/\/$/, "")}/boards/${slug}${formatRoomHash(secret)}`;

/** Whether two secrets are the same one, byte for byte. */
export const sameSecret = (a: Uint8Array | null, b: Uint8Array | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
};
