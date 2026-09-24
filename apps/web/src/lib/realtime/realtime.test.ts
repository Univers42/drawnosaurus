import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authFrame,
  boardLiveTopic,
  boardSubscribePattern,
  collabPayloadFromServerFrame,
  isAuthOk,
  isSubscribedLive,
  liveSocketUrl,
  publishFrame,
  subscribeFrame,
} from "./realtimeProtocol.ts";
import { RealtimeChannel, getCollaboratorProfile } from "./realtimeClient.ts";
import { generateRoomKeyBytes, importRoomKey, isSealedEnvelope } from "./roomCrypto.ts";

describe("liveSocketUrl", () => {
  const page = "http://localhost:5273/boards/abc123";

  it("uses PUBLIC_REALTIME_WS_URL when set", () => {
    expect(liveSocketUrl("ws://localhost:4402/ws", page)).toBe("ws://localhost:4402/ws");
  });

  it("stays same-origin /ws when the realtime URL is unset", () => {
    expect(liveSocketUrl("", page)).toBe("ws://localhost:5273/ws");
  });

  it("upgrades https origins to wss", () => {
    expect(liveSocketUrl("https://rt.example.com/ws", page)).toBe("wss://rt.example.com/ws");
  });

  it("strips fragment room keys so they never reach the handshake URL", () => {
    const withRoom = "http://localhost:5273/boards/abc123#room=secretkeymaterialhere012345678901";
    expect(liveSocketUrl("ws://localhost:4402/ws", withRoom)).toBe("ws://localhost:4402/ws");
    expect(liveSocketUrl("http://localhost:4402/ws#room=leak", page)).toBe(
      "ws://localhost:4402/ws",
    );
  });

  it("strips query-string attempts to smuggle the room key", () => {
    expect(liveSocketUrl("ws://localhost:4402/ws?room=smuggled", page)).toBe(
      "ws://localhost:4402/ws",
    );
  });
});

describe("realtime protocol framing", () => {
  it("builds AUTH, SUBSCRIBE and PUBLISH frames for a board room", () => {
    expect(JSON.parse(authFrame("dev"))).toEqual({ type: "AUTH", token: "dev" });
    expect(JSON.parse(subscribeFrame("abc"))).toEqual({
      type: "SUBSCRIBE",
      sub_id: "live",
      topic: "boards/abc/*",
    });
    expect(boardSubscribePattern("abc")).toBe("boards/abc/*");
    expect(boardLiveTopic("abc")).toBe("boards/abc/live");

    const published = JSON.parse(
      publishFrame("abc", "patch", { type: "patch", clientId: "u1", patch: { elements: [] } }),
    );
    expect(published).toEqual({
      type: "PUBLISH",
      topic: "boards/abc/live",
      event_type: "patch",
      payload: { type: "patch", clientId: "u1", patch: { elements: [] } },
    });
  });

  it("recognises AUTH_OK and SUBSCRIBED control frames", () => {
    expect(isAuthOk({ type: "AUTH_OK", conn_id: "c1", server_time: "t" })).toBe(true);
    expect(isSubscribedLive({ type: "SUBSCRIBED", sub_id: "live", seq: 0 })).toBe(true);
    expect(isSubscribedLive({ type: "SUBSCRIBED", sub_id: "other", seq: 0 })).toBe(false);
  });

  it("extracts collab payloads from EVENT frames and ignores control frames", () => {
    const sealed = { v: 1, iv: "aa", ct: "bb" };
    expect(
      collabPayloadFromServerFrame({
        type: "EVENT",
        sub_id: "live",
        event: {
          event_id: "e1",
          topic: "boards/abc/live",
          event_type: "patch",
          sequence: 1,
          timestamp: "t",
          payload: sealed,
        },
      }),
    ).toEqual(sealed);
    expect(collabPayloadFromServerFrame({ type: "PONG", server_time: "t" })).toBeNull();
  });

  it("keeps a sealed envelope intact as PUBLISH.payload JSON", () => {
    const sealed = { v: 1, iv: "AAAA", ct: "BBBB" };
    const frame = JSON.parse(publishFrame("slug", "cursor", sealed));
    expect(frame.payload).toEqual(sealed);
    expect(JSON.stringify(frame).includes("MARKER")).toBe(false);
  });
});

describe("realtimeClient", () => {
  it("generates a valid collaborator profile", () => {
    const profile = getCollaboratorProfile();
    expect(profile.clientId).toBeTruthy();
    expect(profile.name).toBeTruthy();
    expect(profile.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("handles incoming peer cursors and notifies subscribers", () => {
    const channel = new RealtimeChannel("test-slug");
    let receivedPeers: unknown[] = [];
    const unsubscribe = channel.onPeers((peers) => {
      receivedPeers = peers;
    });

    channel.handleMessage({
      type: "cursor",
      clientId: "peer_123",
      name: "Alice",
      color: "#e03131",
      x: 250,
      y: 400,
    });

    expect(receivedPeers.length).toBe(1);
    const peer = receivedPeers[0] as { name: string; x: number; y: number };
    expect(peer.name).toBe("Alice");
    expect(peer.x).toBe(250);
    expect(peer.y).toBe(400);

    channel.handleMessage({ type: "leave", clientId: "peer_123" });
    expect(receivedPeers.length).toBe(0);

    unsubscribe();
  });

  it("handles join as presence before any cursor moves", () => {
    const channel = new RealtimeChannel("test-slug");
    let receivedPeers: { clientId: string; name: string }[] = [];
    channel.onPeers((peers) => {
      receivedPeers = peers.map((p) => ({ clientId: p.clientId, name: p.name }));
    });

    channel.handleMessage({
      type: "join",
      clientId: "peer_123",
      name: "Alice",
      color: "#e03131",
    });
    expect(receivedPeers).toEqual([{ clientId: "peer_123", name: "Alice" }]);

    channel.handleMessage({ type: "leave", clientId: "peer_123" });
    expect(receivedPeers).toEqual([]);
  });

  it("dispatches remote scene patches", () => {
    const channel = new RealtimeChannel("test-slug");
    let receivedPatch: unknown = null;
    const unsub = channel.onRemotePatch((p) => {
      receivedPatch = p;
    });

    const dummyPatch = {
      elements: [{ id: "el1", version: 2, versionNonce: 99, updated: 100, isDeleted: false }],
    };
    channel.handleMessage({
      type: "patch",
      clientId: "peer_456",
      patch: dummyPatch as never,
    });

    expect(receivedPatch).toEqual(dummyPatch);
    unsub();
  });
});

describe("realtimeClient encrypted frames", () => {
  it("seals outbound patches so the wire has no plaintext marker", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const channel = new RealtimeChannel("secure-slug", key);
    expect(channel.encrypted).toBe(true);

    const marker = "SECRET_ELEMENT_TEXT_xyz";
    const wire = await channel.encodeOutbound({
      type: "patch",
      clientId: "peer_other",
      patch: {
        elements: [
          {
            id: "el1",
            version: 1,
            versionNonce: 1,
            updated: 1,
            isDeleted: false,
            text: marker,
          } as never,
        ],
      },
    });

    expect(wire).toBeTruthy();
    expect(wire!.includes(marker)).toBe(false);
    expect(isSealedEnvelope(JSON.parse(wire!))).toBe(true);
  });

  it("opens a peer's sealed frame and dispatches the inner patch", async () => {
    const raw = generateRoomKeyBytes();
    const key = await importRoomKey(raw);
    const sender = new RealtimeChannel("secure-slug", key);
    const receiver = new RealtimeChannel("secure-slug", key);

    let receivedPatch: unknown = null;
    receiver.onRemotePatch((p) => {
      receivedPatch = p;
    });

    const patch = {
      elements: [{ id: "el1", version: 2, versionNonce: 99, updated: 100, isDeleted: false }],
    };
    const wire = await sender.encodeOutbound({
      type: "patch",
      clientId: "peer_remote",
      patch: patch as never,
    });
    expect(wire).toBeTruthy();
    await receiver.receiveFrame(wire!);
    expect(receivedPatch).toEqual(patch);
  });

  it("rejects plaintext inbound when a room key is set", async () => {
    const key = await importRoomKey(generateRoomKeyBytes());
    const channel = new RealtimeChannel("secure-slug", key);
    let receivedPatch: unknown = null;
    channel.onRemotePatch((p) => {
      receivedPatch = p;
    });

    await channel.receiveFrame(
      JSON.stringify({
        type: "patch",
        clientId: "attacker",
        patch: {
          elements: [{ id: "x", version: 1, versionNonce: 1, updated: 1, isDeleted: false }],
        },
      }),
    );
    expect(receivedPatch).toBeNull();
  });

  it("rejects sealed frames sealed under a different key", async () => {
    const sender = new RealtimeChannel("secure-slug", await importRoomKey(generateRoomKeyBytes()));
    const receiver = new RealtimeChannel(
      "secure-slug",
      await importRoomKey(generateRoomKeyBytes()),
    );
    let receivedPatch: unknown = null;
    receiver.onRemotePatch((p) => {
      receivedPatch = p;
    });

    const wire = await sender.encodeOutbound({
      type: "patch",
      clientId: "peer_remote",
      patch: {
        elements: [{ id: "el1", version: 1, versionNonce: 1, updated: 1, isDeleted: false }],
      } as never,
    });
    await receiver.receiveFrame(wire!);
    expect(receivedPatch).toBeNull();
  });
});

describe("realtimeClient reconnecting", () => {
  /** A socket the test opens and closes by hand. */
  class FakeSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static made: FakeSocket[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    sent: string[] = [];
    constructor(readonly url: string) {
      FakeSocket.made.push(this);
    }
    open(): void {
      this.readyState = 1;
      this.onopen?.();
    }
    drop(): void {
      this.readyState = 3;
      this.onclose?.();
    }
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.readyState = 3;
    }
  }

  function withBrowser() {
    vi.useFakeTimers();
    FakeSocket.made = [];
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", {
      location: { href: "http://localhost:5273/boards/abc" },
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("WebSocket", FakeSocket);
    return listeners;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reports every step, so the page can say the link is down", () => {
    withBrowser();
    const channel = new RealtimeChannel("abc");
    const seen: string[] = [];
    channel.onStatus((status) => seen.push(status));

    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    socket.open();
    // Connected only after AUTH_OK + SUBSCRIBED — the TCP open alone is still "connecting".
    socket.onmessage?.({ data: JSON.stringify({ type: "AUTH_OK", conn_id: "c1", server_time: "t" }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "SUBSCRIBED", sub_id: "live", seq: 0 }) });
    socket.drop();

    expect(seen).toEqual(["disconnected", "connecting", "connected", "disconnected"]);
    channel.disconnect();
  });

  it("tries again on its own after a drop", () => {
    withBrowser();
    const channel = new RealtimeChannel("abc");
    channel.connect("ws://api/live");
    FakeSocket.made[0]!.drop();

    vi.advanceTimersByTime(500);

    expect(FakeSocket.made).toHaveLength(2);
    channel.disconnect();
  });

  it("tries at once when the browser says it is back online", () => {
    // Rather than at the end of a backoff that may have grown to fifteen seconds.
    const listeners = withBrowser();
    const channel = new RealtimeChannel("abc");
    channel.connect("ws://api/live");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      FakeSocket.made.at(-1)!.drop();
      vi.advanceTimersByTime(15_000);
    }
    FakeSocket.made.at(-1)!.drop();
    const before = FakeSocket.made.length;

    listeners.get("online")!();

    expect(FakeSocket.made).toHaveLength(before + 1);
    channel.disconnect();
    expect(listeners.has("online"), "and stops listening when closed").toBe(false);
  });
});

describe("realtimeClient holds and gestures", () => {
  type El = {
    id: string;
    version: number;
    versionNonce: number;
    updated: number;
    isDeleted: boolean;
  };
  const el = (id: string): El => ({
    id,
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
  });

  it("reports what a peer holds and is doing, and not every cursor move", () => {
    const channel = new RealtimeChannel<El>("abc");
    const states: { claims: Record<string, number>; preview?: readonly El[] }[][] = [];
    channel.onPeerState((peers) =>
      states.push(peers.map(({ claims, preview }) => ({ claims, preview }))),
    );
    states.length = 0;

    channel.handleMessage({
      type: "cursor",
      clientId: "ana",
      name: "Ana",
      color: "#e03131",
      x: 1,
      y: 2,
    });
    expect(states, "a cursor move is not news for the engine").toHaveLength(0);

    channel.handleMessage({
      type: "presence",
      clientId: "ana",
      name: "Ana",
      color: "#e03131",
      claims: { A: 5 },
    });
    channel.handleMessage({ type: "preview", clientId: "ana", elements: [el("A")] });
    channel.handleMessage({ type: "preview-end", clientId: "ana" });
    expect(states).toEqual([
      [{ claims: { A: 5 }, preview: undefined }],
      [{ claims: { A: 5 }, preview: [el("A")] }],
      [{ claims: { A: 5 }, preview: undefined }],
    ]);

    channel.handleMessage({ type: "leave", clientId: "ana" });
    expect(states.at(-1), "and lets go of it all when they leave").toEqual([]);
  });

  it("has no position for someone who has not pointed anywhere yet", () => {
    const channel = new RealtimeChannel<El>("abc");
    let peers: { pointed?: boolean }[] = [];
    channel.onPeers((list) => (peers = list));
    channel.handleMessage({ type: "join", clientId: "ana", name: "Ana", color: "#e03131" });
    channel.handleMessage({
      type: "presence",
      clientId: "ana",
      name: "Ana",
      color: "#e03131",
      claims: {},
    });
    expect(peers[0]!.pointed).toBeFalsy();
    channel.handleMessage({
      type: "cursor",
      clientId: "ana",
      name: "Ana",
      color: "#e03131",
      x: 5,
      y: 6,
    });
    expect(peers[0]!.pointed).toBe(true);
  });

  it("keeps the cursor it had when presence arrives, and the name when a preview does", () => {
    const channel = new RealtimeChannel<El>("abc");
    let peers: { name: string; x: number; claims: Record<string, number> }[] = [];
    channel.onPeers((list) => (peers = list));
    channel.handleMessage({
      type: "cursor",
      clientId: "ana",
      name: "Ana",
      color: "#e03131",
      x: 40,
      y: 2,
    });
    channel.handleMessage({
      type: "presence",
      clientId: "ana",
      name: "Ana",
      color: "#e03131",
      claims: { A: 1 },
    });
    channel.handleMessage({ type: "preview", clientId: "ana", elements: [el("A")] });
    expect(peers.map(({ name, x, claims }) => ({ name, x, claims }))).toEqual([
      { name: "Ana", x: 40, claims: { A: 1 } },
    ]);
  });
});

describe("realtimeClient sending", () => {
  class FakeSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static made: FakeSocket[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    sent: string[] = [];
    constructor(readonly url: string) {
      FakeSocket.made.push(this);
    }
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.readyState = 3;
    }
  }

  /** Collab payloads from PUBLISH frames (skips AUTH and other control). */
  function collabTypes(socket: FakeSocket): string[] {
    return socket.sent
      .map((wire) => JSON.parse(wire) as { type?: string; event_type?: string; payload?: { type?: string } })
      .filter((frame) => frame.type === "PUBLISH")
      .map((frame) => frame.event_type ?? frame.payload?.type ?? "");
  }

  function collabPayloads(socket: FakeSocket): { type: string; claims?: Record<string, number> }[] {
    return socket.sent
      .map((wire) => JSON.parse(wire) as { type?: string; payload?: { type: string; claims?: Record<string, number> } })
      .filter((frame) => frame.type === "PUBLISH" && frame.payload)
      .map((frame) => frame.payload!);
  }

  function handshake(socket: FakeSocket): void {
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({ type: "AUTH_OK", conn_id: "c1", server_time: "t" }),
    });
    socket.onmessage?.({ data: JSON.stringify({ type: "SUBSCRIBED", sub_id: "live", seq: 0 }) });
  }

  function connected(): { channel: RealtimeChannel<never>; socket: FakeSocket } {
    FakeSocket.made = [];
    vi.stubGlobal("window", {
      location: { href: "http://localhost:5273/boards/abc" },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("WebSocket", FakeSocket);
    const channel = new RealtimeChannel<never>("abc");
    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    handshake(socket);
    return { channel, socket };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes frames in the order they were sent, however long each takes to seal", async () => {
    // A preview written after its end would leave a shape frozen mid-move on every
    // other screen. Sealing is asynchronous, and a large frame can take longer.
    const { channel, socket } = connected();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.sent = [];
    const encode = channel.encodeOutbound.bind(channel);
    let first = true;
    channel.encodeOutbound = async (msg) => {
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return encode(msg);
    };

    channel.sendPreview([]);
    channel.sendPreviewEnd();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(collabTypes(socket)).toEqual(["preview", "preview-end"]);
    channel.disconnect();
  });

  it("says what it holds on joining, answers every join with it, and forgets peers when the link drops", async () => {
    const { channel, socket } = connected();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(collabTypes(socket)).toEqual(["join", "presence"]);

    channel.setClaims({ A: 3 });
    channel.handleMessage({ type: "join", clientId: "ana", name: "Ana", color: "#e03131" });
    channel.handleMessage({ type: "join", clientId: "ana", name: "Ana", color: "#e03131" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const presences = collabPayloads(socket).filter((msg) => msg.type === "presence");
    expect(presences.at(-1)!.claims).toEqual({ A: 3 });
    expect(presences, "a known peer back from a drop is answered too").toHaveLength(4);

    let peers: unknown[] = ["x"];
    channel.onPeerState((list) => (peers = list));
    expect(peers).toHaveLength(1);
    socket.readyState = 3;
    socket.onclose?.();
    expect(peers).toEqual([]);
    channel.disconnect();
  });
});

describe("realtimeClient keeping everyone up to date", () => {
  type El = {
    id: string;
    version: number;
    versionNonce: number;
    updated: number;
    isDeleted: boolean;
  };
  const el = (id: string, version = 1): El => ({
    id,
    version,
    versionNonce: version,
    updated: 1,
    isDeleted: false,
  });

  class FakeSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static made: FakeSocket[] = [];
    readyState = 0;
    bufferedAmount = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    sent: string[] = [];
    closed = false;
    constructor(readonly url: string) {
      FakeSocket.made.push(this);
    }
    open(): void {
      this.readyState = 1;
      this.onopen?.();
    }
    receive(data: string): void {
      this.onmessage?.({ data });
    }
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.readyState = 3;
      this.closed = true;
    }
    /** Collab payloads from PUBLISH frames — pings and AUTH are separate. */
    messages(): { type: string; [key: string]: unknown }[] {
      return this.sent
        .map((wire) => JSON.parse(wire) as { type?: string; payload?: { type: string; [key: string]: unknown } })
        .filter((frame) => frame.type === "PUBLISH" && frame.payload)
        .map((frame) => frame.payload!);
    }
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  function handshake(socket: FakeSocket): void {
    socket.open();
    socket.receive(JSON.stringify({ type: "AUTH_OK", conn_id: "c1", server_time: "t" }));
    socket.receive(JSON.stringify({ type: "SUBSCRIBED", sub_id: "live", seq: 0 }));
  }

  function browser(): void {
    FakeSocket.made = [];
    vi.stubGlobal("window", {
      location: { href: "http://localhost:5273/boards/abc" },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("sessionStorage", { getItem: () => "user_copied", setItem: () => undefined });
    vi.stubGlobal("WebSocket", FakeSocket);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is someone new in every page, even a tab duplicated with its session", () => {
    // A duplicated tab copies sessionStorage. Two pages sharing an id each dropped the
    // other's frames as their own echo, and never saw each other's edits.
    browser();
    const first = new RealtimeChannel("abc");
    const second = new RealtimeChannel("abc");
    expect(first.profile.clientId).not.toBe(second.profile.clientId);
    expect(first.profile.clientId).not.toBe("user_copied");
  });

  it("says what it has on joining, and is answered with what it lacks", async () => {
    browser();
    const channel = new RealtimeChannel<El>("abc");
    channel.setSceneSync({ inventory: () => ({ a: [1, 1] }), missing: () => [] });
    const received: El[][] = [];
    channel.onRemotePatch((patch) => received.push(patch.elements));
    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    handshake(socket);
    await tick();
    expect(socket.messages()[0]).toMatchObject({ type: "join", have: { a: [1, 1] } });

    channel.handleMessage({
      type: "sync",
      clientId: "ana",
      to: "someone else",
      elements: [el("x")],
    });
    channel.handleMessage({
      type: "sync",
      clientId: "ana",
      to: channel.profile.clientId,
      elements: [el("b")],
    });
    expect(received, "only what was sent to it").toEqual([[el("b")]]);
    channel.disconnect();
  });

  it("answers a join with what the newcomer lacks and what it has", async () => {
    browser();
    const channel = new RealtimeChannel<El>("abc");
    const asked: unknown[] = [];
    channel.setSceneSync({
      inventory: () => ({ a: [3, 3] }),
      missing: (have) => {
        asked.push(have);
        return [el("a", 3)];
      },
    });
    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    handshake(socket);

    channel.handleMessage({
      type: "join",
      clientId: "ana",
      name: "Ana",
      color: "#e03131",
      have: { a: [1, 1] },
    });
    await tick();

    expect(asked).toEqual([{ a: [1, 1] }]);
    expect(socket.messages().find((msg) => msg.type === "sync")).toEqual({
      type: "sync",
      clientId: channel.profile.clientId,
      to: "ana",
      elements: [el("a", 3)],
      have: { a: [3, 3] },
    });
    channel.disconnect();
  });

  it("sends back what a peer who answered lacks, as an ordinary patch", async () => {
    // What was drawn here while the link was down never reached them.
    browser();
    const channel = new RealtimeChannel<El>("abc");
    channel.setSceneSync({ inventory: () => ({}), missing: () => [el("offline", 2)] });
    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    handshake(socket);

    channel.handleMessage({
      type: "sync",
      clientId: "ana",
      to: channel.profile.clientId,
      elements: [],
      have: {},
    });
    await tick();

    expect(socket.messages().find((msg) => msg.type === "patch")).toMatchObject({
      patch: { elements: [el("offline", 2)] },
    });
    channel.disconnect();
  });

  it("forgets at once what someone held when the server says their connection went", async () => {
    browser();
    const channel = new RealtimeChannel<El>("abc");
    let holds: string[][] = [];
    channel.onPeerState((peers) => (holds = peers.map((peer) => Object.keys(peer.claims))));
    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    handshake(socket);
    // AUTH_OK already named the socket `c1`; welcome overrides for the relay case.
    socket.receive('{"type":"welcome","socket":"7"}');
    await tick();
    expect(socket.messages().at(-1), "says which connection is its own").toMatchObject({
      type: "presence",
      socket: "7",
    });

    channel.handleMessage({
      type: "presence",
      clientId: "ana",
      name: "Ana",
      color: "#e03131",
      claims: { A: 1 },
      socket: "3",
    });
    expect(holds).toEqual([["A"]]);
    await channel.receiveFrame('{"type":"gone","socket":"4"}');
    expect(holds, "someone else's connection").toEqual([["A"]]);
    await channel.receiveFrame('{"type":"gone","socket":"3"}');
    expect(holds).toEqual([]);
    channel.disconnect();
  });

  it("gives up on a link that stopped answering, and opens another", async () => {
    // A laptop lid shut, a network changed: the socket still reads as open.
    vi.useFakeTimers();
    browser();
    const channel = new RealtimeChannel<El>("abc");
    const seen: string[] = [];
    channel.onStatus((status) => seen.push(status));
    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    handshake(socket);

    vi.advanceTimersByTime(5_000);
    expect(socket.sent.at(-1)).toBe('{"type":"PING"}');
    socket.receive(JSON.stringify({ type: "PONG", server_time: "t" }));
    // From here nothing arrives.
    vi.advanceTimersByTime(5_000);
    expect(socket.closed, "given up on while it still answered").toBe(false);
    vi.advanceTimersByTime(15_000);

    expect(socket.closed).toBe(true);
    expect(seen.at(-1) === "disconnected" || FakeSocket.made.length > 1).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.made, "a new link").toHaveLength(2);
    channel.disconnect();
  });

  it("does not hold a server that never answers pings to them", () => {
    vi.useFakeTimers();
    browser();
    const channel = new RealtimeChannel<El>("abc");
    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    handshake(socket);
    vi.advanceTimersByTime(60_000);
    expect(socket.closed).toBe(false);
    expect(FakeSocket.made).toHaveLength(1);
    channel.disconnect();
  });

  it("drops cursors and previews behind a clogged link, never edits", async () => {
    browser();
    const channel = new RealtimeChannel<El>("abc");
    channel.connect("ws://rt/ws");
    const socket = FakeSocket.made[0]!;
    handshake(socket);
    await tick();
    socket.sent = [];
    socket.bufferedAmount = 10 * 1024 * 1024;

    channel.sendCursor(1, 2);
    channel.sendPreview([el("a")]);
    channel.sendPatch({ elements: [el("a", 2)] });
    channel.sendPreviewEnd();
    await tick();

    expect(socket.messages().map((msg) => msg.type)).toEqual(["patch", "preview-end"]);
    channel.disconnect();
  });
});
