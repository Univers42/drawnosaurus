/**
 * The online copy's scene, made smaller before it is sealed: sealed bytes do not compress,
 * and a scene's JSON repeats most of what it says from one element to the next.
 *
 * The browser's own gzip (`CompressionStream`): no dependency, in every browser the app
 * supports (Chromium and Firefox, Safari from 16.4), and in Node, where the tests run.
 * Pictures are not passed through it: their bytes are compressed already.
 */

async function pipe(bytes: Uint8Array, through: CompressionStream | DecompressionStream) {
  // A copy, so the Blob owns an ArrayBuffer of its own whatever view it was handed.
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(through);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const compress = (bytes: Uint8Array): Promise<Uint8Array> =>
  pipe(bytes, new CompressionStream("gzip"));

/** Rejects bytes that are not gzip, or are cut short. */
export const decompress = (bytes: Uint8Array): Promise<Uint8Array> =>
  pipe(bytes, new DecompressionStream("gzip"));
