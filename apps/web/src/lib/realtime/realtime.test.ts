import { describe, expect, it } from "vitest";
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
