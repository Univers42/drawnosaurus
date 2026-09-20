import { describe, expect, it } from "vitest";
import { RealtimeChannel, getCollaboratorProfile } from "./realtimeClient.ts";

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
