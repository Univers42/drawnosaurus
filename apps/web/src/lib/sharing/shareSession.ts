import { generateRoomKeyBytes } from "../realtime/roomCrypto.ts";
import { shareLink } from "./secret.ts";

export interface ShareSessionOptions {
  slug: string;
  /** The page's origin, which the link starts with. */
  origin: string;
  mint?: () => Uint8Array;
  /** Writes the drawing's first online copy under `secret`, claiming its write proof. */
  writeFirstCopy: (secret: Uint8Array) => Promise<void>;
  /** Keeps `secret` with the drawing, so it opens shared from now on. */
  keepSecret: (secret: Uint8Array) => Promise<void>;
  /** Connects the drawing to the relay under `secret`. */
  goLive: (secret: Uint8Array) => void;
  /** Puts the link in the address bar without a navigation. */
  replaceState: (url: string) => void;
}

/**
 * "Share live", for a drawing not shared yet: the steps, in the only order that holds.
 *
 * 1. The secret is minted once per page: a retry reuses it, since a first write can land
 *    with its answer lost, and a new secret's token would then be refused for good.
 * 2. The first copy is written before anything connects: it stores the write proof, and
 *    the drawing's id reaches the relay only after, where someone watching could
 *    otherwise claim the proof first.
 * 3. The secret is kept only once that copy is there: a drawing that has one goes live
 *    when it opens, and must never go live without its copy.
 * 4. Live, then the link in the address bar, then the link for the dialog.
 */
export function createShareSession(options: ShareSessionOptions): { start(): Promise<string> } {
  let secret: Uint8Array | null = null;
  let started: Promise<string> | null = null;

  async function share(): Promise<string> {
    secret ??= (options.mint ?? generateRoomKeyBytes)();
    await options.writeFirstCopy(secret);
    await options.keepSecret(secret);
    options.goLive(secret);
    const link = shareLink(options.origin, options.slug, secret);
    options.replaceState(link);
    return link;
  }

  return {
    start() {
      started ??= share().catch((error: unknown) => {
        started = null;
        throw error;
      });
      return started;
    },
  };
}
