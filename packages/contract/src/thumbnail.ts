const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Whether the bytes start with the 8-byte PNG signature.
 *
 * Caveat: the signature only, not the chunks behind it. A truncated or corrupt PNG
 * passes; the browser shows a broken image and the gallery falls back to its badge.
 */
export function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}
