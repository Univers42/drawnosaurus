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
import { Relay, type Outbound } from "../src/relay.ts";

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
});
