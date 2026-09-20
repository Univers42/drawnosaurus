import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 10;

/**
 * Server-minted, URL-shaped board id. 36^10 keeps collisions negligible, and the
 * unique index on `slug` is the actual guarantee — this only has to avoid being
 * guessable-by-counting, which is why it is random rather than sequential.
 *
 * Rejection sampling keeps the distribution flat; a plain modulo would bias the
 * first few letters.
 */
export function mintSlug(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let slug = "";

  while (slug.length < SLUG_LENGTH) {
    for (const byte of randomBytes(SLUG_LENGTH)) {
      if (byte >= limit) continue;
      slug += ALPHABET[byte % ALPHABET.length];
      if (slug.length === SLUG_LENGTH) break;
    }
  }

  return slug;
}
