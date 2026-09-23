import type { FastifyInstance } from "fastify";
import { isPrivateHost, type ShareInfo } from "@drawnosaurus/contract";
import type { Config } from "./config.ts";

/**
 * `GET /v1/share`: where other people can reach this drawnosaurus.
 *
 * The page cannot know — a board opened at localhost has no idea what address a
 * colleague would use — so the Share dialog asks here. Two sources:
 *
 * - the LAN origins `make up` passed in, read from the host, because inside the
 *   container there are no addresses but the container's own;
 * - the tunnel `make share` starts, whose public name is random and only known once it
 *   is up. cloudflared says it on its metrics server at `/quicktunnel`.
 *
 * The LAN addresses are told only to someone already on this computer or on the local
 * network. Someone arriving through the public tunnel is on the internet, and the
 * machine's private addresses are none of their business.
 */

/** How long the tunnel's answer is kept, so an open dialog does not poll it per frame. */
const TUNNEL_CACHE_MS = 5_000;
/** How long to wait for the tunnel. When none is running, its name does not resolve. */
const TUNNEL_TIMEOUT_MS = 800;

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** Asks the tunnel for its public origin; null when there is no tunnel, or no answer. */
export function tunnelOrigin(metricsUrl: string | null, fetcher: Fetch = fetch) {
  let cached: { at: number; origin: string | null } | null = null;
  return async (now = Date.now()): Promise<string | null> => {
    if (!metricsUrl) return null;
    if (cached && now - cached.at < TUNNEL_CACHE_MS) return cached.origin;
    let origin: string | null = null;
    try {
      const response = await fetcher(`${metricsUrl.replace(/\/$/, "")}/quicktunnel`, {
        signal: AbortSignal.timeout(TUNNEL_TIMEOUT_MS),
      });
      if (response.ok) {
        const body = (await response.json()) as { hostname?: unknown };
        const hostname = typeof body.hostname === "string" ? body.hostname.trim() : "";
        // A host name and nothing else: this goes straight into a link people click.
        if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(hostname)) origin = `https://${hostname}`;
      }
    } catch {
      origin = null;
    }
    cached = { at: now, origin };
    return origin;
  };
}

/** What a request arriving for `host` is told. */
export function shareInfoFor(
  host: string,
  lanOrigins: readonly string[],
  publicOrigin: string | null,
): ShareInfo {
  return {
    lan: isPrivateHost(host) ? [...lanOrigins] : [],
    public: publicOrigin,
  };
}

export function registerShareRoutes(app: FastifyInstance, config: Config): void {
  const publicOrigin = tunnelOrigin(config.tunnelMetricsUrl);
  app.get("/v1/share", async (request) => {
    // The gateway passes the Host the browser used; that is what says where they are.
    return shareInfoFor(request.headers.host ?? "", config.shareLanOrigins, await publicOrigin());
  });
}
