import { describe, expect, it } from "vitest";
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
