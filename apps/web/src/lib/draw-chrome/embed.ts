/**
 * The host's half of embedding: positioning live frames, and naming the sites allowed.
 *
 * Whether a link can be embedded, what it rewrites to, and where its frame goes are all
 * the engine's — see `resolveEmbed` and `embedFrames`. What is here is what only a
 * browser can do with those answers: build the sandbox string, and say the list out loud
 * when someone's link is refused.
 */

/**
 * The sites that can be embedded, for telling someone why theirs was not.
 *
 * **Display only, and not the authority.** The engine holds the real list and refuses
 * anything not on it, so the worst this copy can do is name a site that no longer works
 * or omit one that does — never let something through. It is duplicated rather than read
 * from WASM because the dialog has to be able to explain itself even when the engine
 * failed to load, which is exactly when someone most needs to be told something.
 */
export const ALLOWED_EMBED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "drive.google.com",
  "figma.com",
  "gist.github.com",
  "twitter.com",
  "x.com",
  "simplepdf.eu",
  "stackblitz.com",
  "val.town",
  "giphy.com",
  "reddit.com",
  "forms.microsoft.com",
] as const;

/** One embed's live frame, as the engine reports it. */
export interface EmbedFrame {
  id: string;
  url: string;
  allowSameOrigin: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

/**
 * The `sandbox` attribute for an embed.
 *
 * Always the minimum a page needs to work, never more. `allow-scripts` together with
 * `allow-same-origin` hands a frame the power to remove its own sandbox, so the pair is
 * granted only to the providers whose players genuinely require it — which is the
 * engine's decision, arriving here as `allowSameOrigin`, not one taken per call site.
 */
export function sandboxFor(frame: Pick<EmbedFrame, "allowSameOrigin">): string {
  const permissions = ["allow-scripts", "allow-popups", "allow-presentation"];
  if (frame.allowSameOrigin) permissions.push("allow-same-origin");
  return permissions.join(" ");
}

/** The CSS for placing a frame over the canvas, in the screen pixels the engine gave. */
export function frameStyle(frame: EmbedFrame): string {
  const rotation = frame.angle ? ` rotate(${frame.angle}rad)` : "";
  return [
    "position:absolute",
    `left:${frame.x}px`,
    `top:${frame.y}px`,
    `width:${frame.width}px`,
    `height:${frame.height}px`,
    // About its own centre, which is where the engine's angle is measured from.
    `transform-origin:center center`,
    rotation ? `transform:${rotation.trim()}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

/** Parse what `engine.embedFrames()` returns, tolerating anything unexpected. */
export function parseEmbedFrames(json: string): EmbedFrame[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    // Filtered rather than trusted: a frame with no URL would render an `<iframe>`
    // pointing at the board itself, which recurses.
    return parsed.filter(
      (frame): frame is EmbedFrame =>
        typeof frame === "object" &&
        frame !== null &&
        typeof (frame as EmbedFrame).id === "string" &&
        typeof (frame as EmbedFrame).url === "string" &&
        (frame as EmbedFrame).url.length > 0,
    );
  } catch {
    return [];
  }
}
