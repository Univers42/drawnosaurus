/**
 * The host's half of embedding: laying live frames over the canvas, and deciding when
 * one of them may have the pointer.
 *
 * Whether a link can be embedded, what it rewrites to, and where its frame goes are all
 * the engine's — see `resolveEmbed` and `embedFrames`. What is here is what only a
 * browser can do with those answers: build the frame's attributes, place and scale it,
 * and say the list out loud when someone's link is refused.
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
  "vimeo.com",
  "loom.com",
  "dailymotion.com",
  "twitch.tv",
  "tiktok.com",
  "streamable.com",
  "ted.com",
  "bilibili.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "giphy.com",
  "open.spotify.com",
  "soundcloud.com",
  "mixcloud.com",
  "podcasts.apple.com",
  "music.apple.com",
  "drive.google.com",
  "docs.google.com",
  "calendar.google.com",
  "google.com (maps)",
  "openstreetmap.org",
  "figma.com",
  "miro.com",
  "excalidraw.com",
  "gist.github.com",
  "codepen.io",
  "codesandbox.io",
  "jsfiddle.net",
  "stackblitz.com",
  "val.town",
  "desmos.com",
  "simplepdf.eu",
  "forms.office.com",
] as const;

/** One embed's live frame, as the engine reports it. */
export interface EmbedFrame {
  id: string;
  url: string;
  /** A document to frame instead of `url`: a provider with no address that frames. */
  srcdoc?: string;
  kind: "video" | "generic";
  allowSameOrigin: boolean;
  /** The top-left of the unturned box, in screen pixels. */
  x: number;
  y: number;
  /** The box on screen: its size on the board times `scale`. */
  width: number;
  height: number;
  angle: number;
  /** The camera's zoom. */
  scale: number;
}

/**
 * The `sandbox` attribute for an embed.
 *
 * What a page needs to work and nothing that reaches past it. Never
 * `allow-top-navigation`: a frame that can navigate the top level can replace the whole
 * board with itself. `allow-same-origin` is the engine's decision, arriving here as
 * `allowSameOrigin`: a frame loaded from a provider's address keeps the *provider's*
 * origin, so the grant lets its player use its own storage — but a `srcdoc` document
 * would have ours, and never gets it.
 *
 * `allow-popups-to-escape-sandbox` so that "Watch on YouTube" opens an ordinary tab
 * rather than one still sandboxed, where the site refuses to run.
 */
export function sandboxFor(frame: Pick<EmbedFrame, "allowSameOrigin">): string {
  const permissions = [
    "allow-scripts",
    "allow-popups",
    "allow-popups-to-escape-sandbox",
    "allow-presentation",
    "allow-forms",
  ];
  if (frame.allowSameOrigin) permissions.push("allow-same-origin");
  return permissions.join(" ");
}

/**
 * The referrer an embed is loaded with: this site's origin and nothing more.
 *
 * It used to be `no-referrer`, and YouTube refuses to play for a page it cannot identify:
 * every video showed "Error 153 — video player configuration error" instead of playing.
 * The origin is what it asks for; the path of the board is not sent.
 */
export const EMBED_REFERRER_POLICY = "strict-origin-when-cross-origin";

/** What an embedded player may use. Autoplay so one click both activates and plays. */
export const EMBED_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share";

/**
 * The address to frame, finished with what only the host knows.
 *
 * Twitch refuses to play unless the embedding site names itself as `parent`, and the
 * engine does not know which site it is running on.
 */
export function frameSrc(frame: Pick<EmbedFrame, "url">, hostname: string): string {
  try {
    const url = new URL(frame.url);
    if (/(^|\.)twitch\.tv$/.test(url.hostname) && hostname) {
      url.searchParams.set("parent", hostname);
      return url.toString();
    }
  } catch {
    // Not ours to fix: the engine resolved it, and the frame shows whatever it is.
  }
  return frame.url;
}

/** How far a player's viewport follows the zoom. Excalidraw's bounds. */
const MIN_VIEWPORT_SCALE = 0.75;
const MAX_VIEWPORT_SCALE = 4;

/**
 * How large a page is laid out, relative to its size on the board.
 *
 * A page is laid out at its size on the board and scaled with the zoom, so it zooms with
 * the drawing instead of reflowing. A player is the exception: laid out at 560 pixels and
 * shown at 15% it is too small to use, and shown at 300% it is a 360p stream stretched
 * across the screen. So a player's viewport follows the zoom — within bounds — and is
 * scaled back by the same amount, keeping its box exactly where the board says.
 */
export function viewportScale(frame: Pick<EmbedFrame, "kind" | "scale">): number {
  if (frame.kind !== "video") return 1;
  return Math.min(MAX_VIEWPORT_SCALE, Math.max(MIN_VIEWPORT_SCALE, frame.scale));
}

/** The embed's size on the board, which is what the page is laid out at. */
function boardSize(frame: EmbedFrame): { width: number; height: number } {
  const scale = frame.scale > 0 ? frame.scale : 1;
  return { width: frame.width / scale, height: frame.height / scale };
}

/**
 * The CSS for the box a frame sits in: the embed's size on the board, scaled by the
 * zoom and turned about its centre, at the screen position the engine gave.
 */
export function frameStyle(frame: EmbedFrame): string {
  const { width, height } = boardSize(frame);
  const scale = frame.scale > 0 ? frame.scale : 1;
  const turn = frame.angle
    ? ` translate(${width / 2}px, ${height / 2}px) rotate(${frame.angle}rad) translate(${-width / 2}px, ${-height / 2}px)`
    : "";
  return [
    `left:${frame.x}px`,
    `top:${frame.y}px`,
    `width:${width}px`,
    `height:${height}px`,
    "transform-origin:0 0",
    `transform:scale(${scale})${turn}`,
  ].join(";");
}

/** The CSS for the frame itself inside that box: see `viewportScale`. */
export function frameInnerStyle(frame: EmbedFrame): string {
  const v = viewportScale(frame);
  const { width, height } = boardSize(frame);
  return [
    `width:${width * v}px`,
    `height:${height * v}px`,
    "transform-origin:0 0",
    `transform:scale(${1 / v})`,
  ].join(";");
}

/**
 * Whether a screen point is in the middle third of a frame, turned with it.
 *
 * Excalidraw's `isIframeLikeElementCenter`. The middle is where a click hands the pointer
 * to the page; the rest of it is the board's, so an embed can still be grabbed and moved
 * anywhere and a click near its edge still just selects it.
 */
export function isFrameCentre(frame: EmbedFrame, x: number, y: number): boolean {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  // Into the frame's own axes: undo its turn about the centre.
  const cos = Math.cos(-frame.angle);
  const sin = Math.sin(-frame.angle);
  const dx = (x - cx) * cos - (y - cy) * sin;
  const dy = (x - cx) * sin + (y - cy) * cos;
  return Math.abs(dx) <= frame.width / 6 && Math.abs(dy) <= frame.height / 6;
}

/** Whether a press and release were a click rather than the start of a drag. */
export function isClick(
  down: { x: number; y: number; at: number },
  up: { x: number; y: number; at: number },
): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= 4 && up.at - down.at <= 300;
}

/**
 * The message that starts a player, for the providers that take one.
 *
 * Sent when a frame is activated, so the click that activates a video also plays it, as
 * it does in Excalidraw. Both are opted into by the embed URL the engine builds
 * (`enablejsapi=1`, `api=1`).
 */
export function playMessage(url: string): string | null {
  if (/^https:\/\/www\.youtube\.com\/embed\//.test(url)) {
    return JSON.stringify({ event: "command", func: "playVideo", args: "" });
  }
  if (/^https:\/\/player\.vimeo\.com\/video\//.test(url)) {
    return JSON.stringify({ method: "play" });
  }
  return null;
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
