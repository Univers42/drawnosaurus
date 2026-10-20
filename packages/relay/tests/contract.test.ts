import { describe, expect, it } from "vitest";
// The web client's own wire helpers: the frames it sends, and how it reads the answers.
// Nothing here is typed out by hand, so if the client and this relay drift apart, this
// file fails.
import {
  authFrame,
  collabPayloadFromServerFrame,
  isAuthOk,
  isSubscribedLive,
  pingFrame,
  publishFrame,
  subscribeFrame,
} from "../../../apps/web/src/lib/realtime/realtimeProtocol.ts";
import { PING, PONG, Relay, type Outbound } from "../src/relay.ts";

/**
 * The token `realtimeClient.ts` sends when none is configured (`DEV_AUTH_TOKEN`) — always,
 * in the public build (`relayToken()` is empty there, `lib/config.ts`).
 */
const CLIENT_TOKEN = "dev";

/** A sealed collab payload's shape (`roomCrypto.ts`, `SealedEnvelope`); the relay never opens it. */
const SEALED = { v: 1, iv: "AAECAwQFBgcICQoL", ct: "c2VhbGVkIGJ5IHRoZSBwYWdl" };

/** What `id` was sent, parsed as the client parses it (`onServerFrame`). */
function sentTo(out: Outbound[], id: string): unknown[] {
  return out.filter((o) => o.to === id).map((o) => JSON.parse(o.frame) as unknown);
}

/**
 * The client's handshake (`RealtimeChannel.openSocket`, `onServerFrame`): AUTH on open,
 * SUBSCRIBE on AUTH_OK, and connected on SUBSCRIBED.
 */
function connect(relay: Relay, drawing: string): string {
  const { id } = relay.open();
  expect(sentTo(relay.receive(id, authFrame(CLIENT_TOKEN)), id).filter(isAuthOk)).toHaveLength(1);
  expect(
    sentTo(relay.receive(id, subscribeFrame(drawing)), id).filter(isSubscribedLive),
  ).toHaveLength(1);
  return id;
}

describe("the web client against the relay", () => {
  it("is taken through AUTH and SUBSCRIBE to connected", () => {
    connect(new Relay(), "drawing");
  });

  it("is told its connection's name in AUTH_OK, which it keeps as its socket", () => {
    const relay = new Relay();
    const { id } = relay.open();
    const [authOk] = sentTo(relay.receive(id, authFrame(CLIENT_TOKEN)), id);
    expect(isAuthOk(authOk)).toBe(true);
    expect((authOk as { conn_id?: unknown }).conn_id).toBe(id);
  });

  it("hands its sealed payload to the other page of the drawing, as that page reads it", () => {
    const relay = new Relay();
    const a = connect(relay, "drawing");
    const b = connect(relay, "drawing");
    const other = connect(relay, "another-drawing");
    const out = relay.receive(a, publishFrame("drawing", "patch", SEALED));
    expect(sentTo(out, b).map(collabPayloadFromServerFrame)).toEqual([SEALED]);
    expect(sentTo(out, other)).toEqual([]);
  });

  it("hands the publisher its own payload back, which the client drops by its clientId", () => {
    const relay = new Relay();
    const a = connect(relay, "drawing");
    const out = relay.receive(a, publishFrame("drawing", "patch", SEALED));
    expect(sentTo(out, a).map(collabPayloadFromServerFrame)).toEqual([SEALED]);
  });

  it("answers its ping with what its isPong reads as a pong: a frame of type PONG", () => {
    const relay = new Relay();
    const { id } = relay.open();
    const out = sentTo(relay.receive(id, pingFrame()), id);
    expect(out.map((f) => (f as { type?: unknown }).type)).toEqual(["PONG"]);
  });

  it("drops its publish whose payload is over 64 KiB, as the Rust relay does", () => {
    const relay = new Relay();
    const a = connect(relay, "drawing");
    const b = connect(relay, "drawing");
    const big = { ...SEALED, ct: "A".repeat(65_536) };
    expect(sentTo(relay.receive(a, publishFrame("drawing", "patch", big)), b)).toEqual([]);
    expect(
      sentTo(relay.receive(a, publishFrame("drawing", "patch", SEALED)), b).map(
        collabPayloadFromServerFrame,
      ),
    ).toEqual([SEALED]);
  });

  /*
   * Fix round 1. The frame cap is read before parsing, so it must never refuse a frame the
   * client sends and the relay would forward: the largest is a PUBLISH of a 64 KiB payload,
   * under the longest topic a slug makes (32 characters, `slugSchema` in
   * packages/contract) and the longest event type the client sends (`preview-end`,
   * `RealtimeMessage` in realtimeClient.ts).
   */
  it("has its largest frame forwarded: a 64 KiB payload, the longest slug, the longest event type", () => {
    const relay = new Relay();
    const slug = "z9".repeat(16);
    const a = connect(relay, slug);
    const b = connect(relay, slug);
    const payload = "A".repeat(65_534);
    const frame = publishFrame(slug, "preview-end", payload);
    expect(frame.length).toBe(65_536 + 111);
    expect(sentTo(relay.receive(a, frame), b).map(collabPayloadFromServerFrame)).toEqual([payload]);
  });

  /*
   * Ruling 26. `handleControl` (realtimeClient.ts) takes a frame with no `clientId`, of
   * type `gone`, naming a `socket` — the name its peer was given in AUTH_OK and repeats in
   * its presence — and lets go of everything that peer held.
   */
  it("is told a peer has gone, naming the socket AUTH_OK gave that peer", () => {
    const relay = new Relay();
    const a = connect(relay, "drawing");
    const { id: b } = relay.open();
    const [authOk] = sentTo(relay.receive(b, authFrame(CLIENT_TOKEN)), b);
    relay.receive(b, subscribeFrame("drawing"));
    const socket = (authOk as { conn_id: string }).conn_id;
    const told = sentTo(relay.close(b), a);
    expect(told).toEqual([{ type: "gone", socket }]);
    expect(told.every((f) => !("clientId" in (f as object)))).toBe(true);
  });

  /*
   * The runtime answers the client's ping itself (`setWebSocketAutoResponse`, worker.ts), so
   * the pair has to be the client's ping byte for byte, and an answer its isPong takes.
   */
  it("pings with exactly the frame the runtime answers, and reads that answer as a pong", () => {
    expect(pingFrame()).toBe(PING);
    expect((JSON.parse(PONG) as { type?: unknown }).type).toBe("PONG");
  });
});
