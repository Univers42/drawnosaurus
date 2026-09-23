/**
 * Wire framing for engine/realtime (realtime-agnostic).
 *
 * Collab payloads (plaintext RealtimeMessage or sealed {v,iv,ct}) ride in
 * PUBLISH.payload / EVENT.event.payload as JSON objects — the gateway is JSON-only.
 */

export const LIVE_SUB_ID = "live";

export function boardLiveTopic(slug: string): string {
  return `boards/${slug}/live`;
}

export function boardSubscribePattern(slug: string): string {
  return `boards/${slug}/*`;
}

/** WebSocket URL for the realtime gateway (`…/ws`). Never carries the room fragment. */
export function liveSocketUrl(realtimeWsUrl: string, pageHref: string): string {
  const url = new URL(realtimeWsUrl || "/ws", pageHref);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    url.protocol = pageHref.startsWith("https") ? "wss:" : "ws:";
  }
  url.hash = "";
  url.search = "";
  // Ensure path ends at /ws when given only an origin.
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ws";
  }
  return url.toString();
}

export function authFrame(token: string): string {
  return JSON.stringify({ type: "AUTH", token });
}

export function subscribeFrame(slug: string): string {
  return JSON.stringify({
    type: "SUBSCRIBE",
    sub_id: LIVE_SUB_ID,
    topic: boardSubscribePattern(slug),
  });
}

export function publishFrame(slug: string, eventType: string, payload: unknown): string {
  return JSON.stringify({
    type: "PUBLISH",
    topic: boardLiveTopic(slug),
    event_type: eventType,
    payload,
  });
}

export function pingFrame(): string {
  return JSON.stringify({ type: "PING" });
}

/** Pull the collab payload out of a server EVENT; null for control frames / malformed. */
export function collabPayloadFromServerFrame(raw: unknown): unknown | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as { type?: unknown; event?: { payload?: unknown } };
  if (msg.type !== "EVENT") return null;
  if (!msg.event || typeof msg.event !== "object") return null;
  return msg.event.payload ?? null;
}

export function isAuthOk(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && (raw as { type?: string }).type === "AUTH_OK");
}

export function isSubscribedLive(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const msg = raw as { type?: string; sub_id?: string };
  return msg.type === "SUBSCRIBED" && msg.sub_id === LIVE_SUB_ID;
}
