import type { DurableObjectNamespace, DurableObjectState } from "./cloudflare.ts";

interface Env {
  RELAY: DurableObjectNamespace;
}

export default {
  fetch(_request: Request, _env: Env): Response {
    return new Response("not found", { status: 404 });
  },
};

export class RelayObject {
  constructor(_ctx: DurableObjectState) {}

  fetch(): Response {
    return new Response("not found", { status: 404 });
  }

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {}

  webSocketClose(_ws: WebSocket): void {}

  webSocketError(_ws: WebSocket): void {}
}
