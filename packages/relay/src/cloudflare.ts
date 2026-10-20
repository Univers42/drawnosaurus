/**
 * The few Cloudflare Workers types this package uses, declared by hand: the whole of
 * `@cloudflare/workers-types` is one more dependency for seven names. Each is as Cloudflare's
 * reference gives it, read 2026-10-20:
 *
 * - `DurableObjectState`: https://developers.cloudflare.com/durable-objects/api/state/
 * - the attachment, the pair and the 101:
 *   https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 */

export interface DurableObjectState {
  /**
   * Hands the server end of a socket to the runtime, which keeps it open while the object
   * hibernates and calls `webSocketMessage` / `webSocketClose` / `webSocketError` on it.
   * Up to 10 tags of up to 256 characters each.
   */
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  /** The accepted sockets — all of them, or those tagged `tag`. May list one already closed. */
  getWebSockets(tag?: string): WebSocket[];
  /**
   * A message equal to `pair.request` is answered with `pair.response` by the runtime,
   * "without waking WebSockets in hibernation"; both at most 2,048 characters.
   */
  setWebSocketAutoResponse(pair?: WebSocketRequestResponsePair): void;
}

/** The runtime's handle on one object; this code only passes it back to `get`. */
export type DurableObjectId = unknown;

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

declare global {
  interface WebSocket {
    /** Kept with the socket through hibernation; at most 16,384 bytes serialized. */
    serializeAttachment(value: unknown): void;
    /** What `serializeAttachment` was last given, or `null`. */
    deserializeAttachment(): unknown;
  }

  interface ResponseInit {
    /** The client end of a `WebSocketPair`, on the 101 that answers an upgrade. */
    webSocket?: WebSocket;
  }

  /** Two connected sockets: `0` goes back to the caller in the 101, `1` stays here. */
  const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

  interface WebSocketRequestResponsePair {
    readonly request: string;
    readonly response: string;
  }
  const WebSocketRequestResponsePair: new (
    request: string,
    response: string,
  ) => WebSocketRequestResponsePair;
}
