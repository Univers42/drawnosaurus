import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authFrame,
  collabPayloadFromServerFrame,
  pingFrame,
  publishFrame,
  subscribeFrame,
} from "../../../apps/web/src/lib/realtime/realtimeProtocol.ts";
import type { DurableObjectNamespace, DurableObjectState } from "../src/cloudflare.ts";
import worker, { RelayObject } from "../src/worker.ts";

/**
 * A socket as the hibernation API hands it over: what it is sent, and an attachment that
 * goes through a structured clone, as the runtime keeps it.
 */
class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  private attachment: unknown = null;

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  /** Makes the next `serializeAttachment` throw, as one over 16,384 bytes would. */
  failNextAttachment = false;

  serializeAttachment(value: unknown): void {
    if (this.failNextAttachment) {
      this.failNextAttachment = false;
      throw new Error("attachment refused");
    }
    this.attachment = structuredClone(value);
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }

  /** The server's name for it, from the AUTH_OK it was sent. */
  connId(): string | undefined {
    const authOk = this.sent.map((f) => JSON.parse(f) as Record<string, unknown>);
    return authOk.find((f) => f.type === "AUTH_OK")?.conn_id as string | undefined;
  }

  /** The control frames (no `clientId`, a `socket`) it was sent — `welcome` and `gone`. */
  control(): unknown[] {
    return this.sent
      .map((f) => JSON.parse(f) as Record<string, unknown>)
      .filter((f) => typeof f.socket === "string" && !("clientId" in f));
  }

  /** The collab payloads it was sent, as the client reads them. */
  payloads(): unknown[] {
    return this.sent
      .map((f) => collabPayloadFromServerFrame(JSON.parse(f)))
      .filter((p) => p !== null);
  }
}

/**
 * What outlives the object across hibernation: the accepted sockets and their tags. Like
 * the runtime, it keeps listing a socket after it closes.
 */
class FakeState {
  readonly accepted: { ws: FakeSocket; tags: string[] }[] = [];

  acceptWebSocket(ws: FakeSocket, tags: string[] = []): void {
    this.accepted.push({ ws, tags });
  }

  getWebSockets(tag?: string): FakeSocket[] {
    return this.accepted.filter((a) => tag === undefined || a.tags.includes(tag)).map((a) => a.ws);
  }

  /** The pair the runtime answers by itself, without waking the object. */
  autoResponse: { request: string; response: string } | undefined;

  setWebSocketAutoResponse(pair?: { request: string; response: string }): void {
    this.autoResponse = pair;
  }
}

/** Cloudflare's `WebSocketRequestResponsePair`, which Node does not have. */
class RequestResponsePair {
  readonly request: string;
  readonly response: string;

  constructor(request: string, response: string) {
    this.request = request;
    this.response = response;
  }
}

/** The 101 the object answers an upgrade with; Node's own Response refuses that status. */
class UpgradeResponse {
  readonly status: number;
  readonly webSocket: unknown;

  constructor(_body: null, init: { status: number; webSocket: unknown }) {
    this.status = init.status;
    this.webSocket = init.webSocket;
  }
}

describe("the Durable Object", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "WebSocketPair",
      class {
        0 = new FakeSocket();
        1 = new FakeSocket();
      },
    );
    vi.stubGlobal("Response", UpgradeResponse);
    vi.stubGlobal("WebSocketRequestResponsePair", RequestResponsePair);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const objectOn = (state: FakeState) => new RelayObject(state as unknown as DurableObjectState);
  const asSocket = (ws: FakeSocket) => ws as unknown as WebSocket;

  /** A page's socket, upgraded, accepted, authenticated and subscribed to `drawing`. */
  function join(object: RelayObject, state: FakeState, drawing: string): FakeSocket {
    const response = object.fetch() as unknown as UpgradeResponse;
    expect(response.status).toBe(101);
    const server = state.accepted.at(-1)?.ws;
    if (!server) throw new Error("the object accepted no socket");
    object.webSocketMessage(asSocket(server), authFrame("dev"));
    object.webSocketMessage(asSocket(server), subscribeFrame(drawing));
    return server;
  }

  it("relays a publish to the other socket of the drawing, and not to another drawing's", () => {
    const state = new FakeState();
    const object = objectOn(state);
    const a = join(object, state, "drawing");
    const b = join(object, state, "drawing");
    const other = join(object, state, "another");
    object.webSocketMessage(asSocket(a), publishFrame("drawing", "patch", { v: 1 }));
    expect(b.payloads()).toEqual([{ v: 1 }]);
    expect(other.payloads()).toEqual([]);
  });

  it("rebuilds every socket's connection from its attachment when it wakes", () => {
    const state = new FakeState();
    const first = objectOn(state);
    const a = join(first, state, "drawing");
    const b = join(first, state, "drawing");
    // Hibernation: the object's memory is gone, its sockets and their attachments are not,
    // and the constructor runs again.
    const woken = objectOn(state);
    woken.webSocketMessage(asSocket(a), publishFrame("drawing", "patch", { v: 1 }));
    expect(b.payloads()).toEqual([{ v: 1 }]);
    woken.webSocketMessage(asSocket(b), publishFrame("drawing", "patch", { v: 2 }));
    expect(a.payloads()).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it("forgets a socket once it closes, though the runtime may still list it", () => {
    const state = new FakeState();
    const object = objectOn(state);
    const a = join(object, state, "drawing");
    const b = join(object, state, "drawing");
    object.webSocketClose(asSocket(b));
    object.webSocketMessage(asSocket(a), publishFrame("drawing", "patch", { v: 1 }));
    expect(a.payloads()).toEqual([{ v: 1 }]);
    expect(b.payloads()).toEqual([]);
  });

  it("forgets and closes a socket that errs, so its page reconnects at once", () => {
    const state = new FakeState();
    const object = objectOn(state);
    const a = join(object, state, "drawing");
    const b = join(object, state, "drawing");
    object.webSocketError(asSocket(b));
    object.webSocketMessage(asSocket(a), publishFrame("drawing", "patch", { v: 1 }));
    expect(b.payloads()).toEqual([]);
    expect(b.closed).toBe(true);
  });

  it("ignores a binary message, as engine/realtime's reader does", () => {
    const state = new FakeState();
    const object = objectOn(state);
    const a = join(object, state, "drawing");
    const before = a.sent.length;
    object.webSocketMessage(asSocket(a), new TextEncoder().encode(pingFrame()).buffer);
    expect(a.sent).toHaveLength(before);
    object.webSocketMessage(asSocket(a), pingFrame());
    expect(a.sent).toHaveLength(before + 1);
  });

  /*
   * Fix round 1. https://developers.cloudflare.com/durable-objects/api/state/ — a request
   * matching the pair is answered "without waking WebSockets in hibernation"; the pricing
   * page's footnote 3 — such auto-responses "will not be charged".
   */
  it("has the runtime answer the client's ping itself, set again on every wake", () => {
    const state = new FakeState();
    objectOn(state);
    expect(state.autoResponse?.request).toBe(pingFrame());
    expect((JSON.parse(state.autoResponse?.response ?? "null") as { type?: unknown }).type).toBe(
      "PONG",
    );
    state.autoResponse = undefined;
    objectOn(state);
    expect(state.autoResponse).toBeDefined();
  });

  it("serves the others when a frame nests 30,000 deep, which JSON.stringify cannot render", () => {
    const state = new FakeState();
    const object = objectOn(state);
    const a = join(object, state, "drawing");
    const b = join(object, state, "drawing");
    const deep = `{"type":"PUBLISH","topic":"boards/drawing/live","event_type":"patch","payload":${"[".repeat(30_000)}${"]".repeat(30_000)}}`;
    expect(() => object.webSocketMessage(asSocket(a), deep)).not.toThrow();
    object.webSocketMessage(asSocket(b), publishFrame("drawing", "patch", { v: 1 }));
    expect(a.payloads()).toEqual([{ v: 1 }]);
  });

  it("lets no error out of webSocketMessage, logs it, and serves the others", () => {
    const state = new FakeState();
    const object = objectOn(state);
    const a = join(object, state, "drawing");
    const b = join(object, state, "drawing");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    a.failNextAttachment = true;
    expect(() => object.webSocketMessage(asSocket(a), pingFrame())).not.toThrow();
    expect(logged).toHaveBeenCalledTimes(1);
    object.webSocketMessage(asSocket(b), publishFrame("drawing", "patch", { v: 1 }));
    expect(a.payloads()).toEqual([{ v: 1 }]);
    logged.mockRestore();
  });

  /* Ruling 26: `gone`, in the shape `handleControl` takes and `e2e/board.ts` › `relay()` sends. */
  it("tells the others on the drawing that a socket has closed, by its name", () => {
    const state = new FakeState();
    const object = objectOn(state);
    const a = join(object, state, "drawing");
    const b = join(object, state, "drawing");
    const other = join(object, state, "another");
    object.webSocketClose(asSocket(b));
    expect(a.control()).toEqual([{ type: "gone", socket: b.connId() }]);
    expect(a.sent.at(-1)).toBe(`{"type":"gone","socket":"${b.connId()}"}`);
    expect(other.control()).toEqual([]);
  });

  it("tells the others on the drawing that a socket has erred, by its name", () => {
    const state = new FakeState();
    const object = objectOn(state);
    const a = join(object, state, "drawing");
    const b = join(object, state, "drawing");
    object.webSocketError(asSocket(b));
    expect(a.control()).toEqual([{ type: "gone", socket: b.connId() }]);
  });
});

describe("the Worker", () => {
  /** The binding, recording which object each request was sent to. */
  function binding() {
    const named: string[] = [];
    const forwarded: Request[] = [];
    const RELAY: DurableObjectNamespace = {
      idFromName: (name) => {
        named.push(name);
        return name;
      },
      get: () => ({
        fetch: (request) => {
          forwarded.push(request);
          return Promise.resolve(new Response("the object"));
        },
      }),
    };
    return { env: { RELAY }, named, forwarded };
  }
  const upgrade = (path: string) =>
    new Request(`https://relay.example${path}`, { headers: { Upgrade: "websocket" } });

  it("answers GET /v1/health with 200, readable from any origin, without reaching the object", async () => {
    const { env, named } = binding();
    const response = await worker.fetch(new Request("https://relay.example/v1/health"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(named).toEqual([]);
  });

  it("hands every /ws upgrade to the one object, named relay", async () => {
    const { env, named, forwarded } = binding();
    const first = upgrade("/ws");
    const second = upgrade("/ws");
    await worker.fetch(first, env);
    await worker.fetch(second, env);
    expect(named).toEqual(["relay", "relay"]);
    expect(forwarded).toEqual([first, second]);
  });

  it("answers 404 to anything but those two", async () => {
    const { env, forwarded } = binding();
    const status = async (request: Request) => (await worker.fetch(request, env)).status;
    expect(await status(upgrade("/ws"))).toBe(200);
    expect(await status(new Request("https://relay.example/v1/health"))).toBe(200);
    for (const request of [
      new Request("https://relay.example/ws"),
      upgrade("/other"),
      new Request("https://relay.example/"),
      new Request("https://relay.example/v1/health", { method: "POST" }),
    ]) {
      expect(await status(request)).toBe(404);
    }
    expect(forwarded).toHaveLength(1);
  });
});
