import type { DurableObjectNamespace, DurableObjectState } from "./cloudflare.ts";
import { Relay, type Connection } from "./relay.ts";

interface Env {
  RELAY: DurableObjectNamespace;
}

/** The client's ping (`pingFrame()`, realtimeProtocol.ts), byte for byte. */
export const PING = '{"type":"PING"}';
/** A pong as the client reads one (`isPong`, realtimeClient.ts: any frame of type PONG). */
export const PONG = '{"type":"PONG"}';

/**
 * The Worker `hydrawn-relay`: `/ws` upgrades go to the relay's Durable Object, `/v1/health`
 * is answered here, and anything else is a 404.
 *
 * ponytail: one object for every drawing. Duration is billed per active object: one busy
 * all day is about 0.125 GB × 86,400 s ≈ 10,800 GB-s, under the free plan's 13,000 GB-s a
 * day, where one per drawing would multiply that by the drawings live at once. Ceiling:
 * one object's 32,768 sockets and one thread, for every live drawing. Upgrade path: shard
 * by drawing id, `idFromName(<drawing>)` — which needs the drawing in the socket's URL, as
 * the client names it only once connected, in SUBSCRIBE (`liveSocketUrl` drops the query).
 */
export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/v1/health") {
      // Here, not in the object, so a health check neither wakes it nor bills it. Readable
      // from any origin, as the Rust relay's is (`CorsLayer::permissive`).
      return new Response('{"status":"ok"}', {
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }
    const upgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (request.method === "GET" && pathname === "/ws" && upgrade) {
      return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(request);
    }
    return new Response("not found", { status: 404 });
  },
};

/**
 * The relay's one Durable Object, on the WebSocket Hibernation API
 * (https://developers.cloudflare.com/durable-objects/best-practices/websockets/): the
 * runtime keeps the sockets open while it evicts the object between messages, so nothing
 * may live only in memory. Each socket carries its connection — id, AUTH, subscriptions —
 * in its attachment, and is tagged with the connection's id, so a woken object rebuilds the
 * relay from `getWebSockets()` and finds a socket to send to with `getWebSockets(id)`.
 * Nothing goes to storage.
 */
export class RelayObject {
  private readonly ctx: DurableObjectState;
  private readonly relay = new Relay();

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    // Woken from hibernation, the constructor runs again with the sockets still open.
    for (const ws of ctx.getWebSockets()) {
      const conn = connectionOf(ws);
      if (conn) this.relay.open(conn);
    }
  }

  /** The upgrade the Worker handed over: a 101, and the server end kept here. */
  fetch(): Response {
    const pair = new WebSocketPair();
    const conn = this.relay.open();
    this.ctx.acceptWebSocket(pair[1], [conn.id]);
    pair[1].serializeAttachment(conn);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const id = connectionOf(ws)?.id;
    // A binary frame is ignored, as engine/realtime's reader ignores one (`reader.rs`).
    if (id === undefined || typeof message !== "string") return;
    for (const { to, frame } of this.relay.receive(id, message)) {
      for (const peer of this.ctx.getWebSockets(to)) {
        try {
          peer.send(frame);
        } catch {
          // Closing as we send: its webSocketClose is on its way, and the others still get theirs.
        }
      }
    }
    const conn = this.relay.connection(id);
    if (conn) ws.serializeAttachment(conn);
  }

  /**
   * Since compatibility date 2026-04-07 the runtime answers the close frame itself, so
   * there is nothing to close here (the hibernation page, `web_socket_auto_reply_to_close`).
   */
  webSocketClose(ws: WebSocket): void {
    this.forget(ws);
  }

  /** Closed as well, so the page sees the link drop now rather than at its next ping. */
  webSocketError(ws: WebSocket): void {
    this.forget(ws);
    try {
      ws.close(1011, "relay error");
    } catch {
      // Already closed.
    }
  }

  private forget(ws: WebSocket): void {
    const id = connectionOf(ws)?.id;
    if (id !== undefined) this.relay.close(id);
  }
}

/**
 * The connection a socket carries. Only this file writes attachments, and "code updates
 * disconnect all WebSockets" (the hibernation page), so one is always this version's
 * `Connection`, or `null` before the first `serializeAttachment`.
 */
function connectionOf(ws: WebSocket): Connection | null {
  return ws.deserializeAttachment() as Connection | null;
}
