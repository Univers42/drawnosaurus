import { env } from "$env/dynamic/public";
import { BROWSER_MODE } from "./mode.ts";

/**
 * Runtime config, in one place. The server build reads the DYNAMIC public env so one
 * image can point at different backends without a rebuild; the browser build has no
 * server to configure and takes build-time values instead.
 */

/** Prefix for `/v1/...` requests. Empty means same origin. */
export const apiBase = (): string =>
  BROWSER_MODE ? "" : (env.PUBLIC_API_URL ?? "").replace(/\/$/, "");

/** The live-collaboration websocket. Empty means "derive it from the page's origin". */
export const relayWsUrl = (): string =>
  BROWSER_MODE
    ? (import.meta.env.VITE_HYDRAWN_RELAY_URL ?? "")
    : (env.PUBLIC_REALTIME_WS_URL ?? "");

/** The relay's auth token. Empty makes the caller fall back to its dev token. */
export const relayToken = (): string => (BROWSER_MODE ? "" : (env.PUBLIC_REALTIME_TOKEN ?? ""));
