import { describe, expect, it } from "vitest";
import { RealtimeChannel, getCollaboratorProfile, liveSocketUrl } from "./realtimeClient.ts";

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
