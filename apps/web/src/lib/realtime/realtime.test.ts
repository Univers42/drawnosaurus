import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeChannel, getCollaboratorProfile, liveSocketUrl } from "./realtimeClient.ts";
import { generateRoomKeyBytes, importRoomKey, isSealedEnvelope } from "./roomCrypto.ts";

describe("liveSocketUrl", () => {
  const page = "http://localhost:5273/boards/abc123";

  it("targets the API origin when PUBLIC_API_URL is set", () => {
    // The compose case: web on 5273, api on 4300. Deriving the host from the page
    // sent the handshake to the web server, which 404s — it has no /v1 route.
    expect(liveSocketUrl("abc123", "http://localhost:4300", page)).toBe(
      "ws://localhost:4300/v1/boards/abc123/live",
    );
  });

  it("stays same-origin when PUBLIC_API_URL is unset", () => {
    expect(liveSocketUrl("abc123", "", page)).toBe("ws://localhost:5273/v1/boards/abc123/live");
  });

  it("upgrades to wss when the API is https", () => {
    expect(liveSocketUrl("abc123", "https://api.example.com", page)).toBe(
      "wss://api.example.com/v1/boards/abc123/live",
    );
  });

  it("keeps a path prefix and tolerates a trailing slash in the base", () => {
    expect(liveSocketUrl("abc123", "https://example.com/api/", page)).toBe(
      "wss://example.com/api/v1/boards/abc123/live",
    );
  });

  it("strips fragment room keys so they never reach the handshake URL", () => {
    const withRoom = "http://localhost:5273/boards/abc123#room=secretkeymaterialhere012345678901";
    expect(liveSocketUrl("abc123", "http://localhost:4300", withRoom)).toBe(
      "ws://localhost:4300/v1/boards/abc123/live",
    );
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

    // Leave event
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

    channel.connect("ws://api/live");
    FakeSocket.made[0]!.open();
    FakeSocket.made[0]!.drop();

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
    channel.connect("ws://api/live");
    const socket = FakeSocket.made[0]!;
    socket.readyState = 1;
    socket.onopen?.();
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

    expect(socket.sent.map((wire) => (JSON.parse(wire) as { type: string }).type)).toEqual([
      "preview",
      "preview-end",
    ]);
    channel.disconnect();
  });

  it("says what it holds on joining, answers every join with it, and forgets peers when the link drops", async () => {
    const { channel, socket } = connected();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const types = () => socket.sent.map((wire) => (JSON.parse(wire) as { type: string }).type);
    expect(types()).toEqual(["join", "presence"]);

    channel.setClaims({ A: 3 });
    channel.handleMessage({ type: "join", clientId: "ana", name: "Ana", color: "#e03131" });
    channel.handleMessage({ type: "join", clientId: "ana", name: "Ana", color: "#e03131" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const presences = socket.sent
      .map((wire) => JSON.parse(wire) as { type: string; claims?: Record<string, number> })
      .filter((msg) => msg.type === "presence");
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
