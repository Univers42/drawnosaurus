import { afterEach, describe, expect, it, vi } from "vitest";
import { Relay, topicMatches, type Outbound } from "../src/relay.ts";

/*
 * The relay against engine/realtime's own behaviour. Frame shapes are
 * `realtime-core/src/protocol.rs`; what each frame does is the gateway's
 * `ws_handler/reader.rs` and `ws_handler/handlers.rs` — every case names the part it mirrors.
 * The frames are typed out here; `contract.test.ts` sends the client's own.
 */

const AUTH = JSON.stringify({ type: "AUTH", token: "dev" });
const PING = JSON.stringify({ type: "PING" });
const subscribe = (drawing: string, subId = "live"): string =>
  JSON.stringify({ type: "SUBSCRIBE", sub_id: subId, topic: `boards/${drawing}/*` });
const publish = (drawing: string, payload: unknown): string =>
  JSON.stringify({
    type: "PUBLISH",
    topic: `boards/${drawing}/live`,
    event_type: "patch",
    payload,
  });

/** What `id` was sent, parsed. */
function sentTo(out: Outbound[], id: string): Record<string, unknown>[] {
  return out.filter((o) => o.to === id).map((o) => JSON.parse(o.frame) as Record<string, unknown>);
}

/** A connection that has authenticated and subscribed to one drawing. */
function joined(relay: Relay, drawing: string): string {
  const { id } = relay.open();
  relay.receive(id, AUTH);
  relay.receive(id, subscribe(drawing));
  return id;
}

describe("AUTH — handle_auth, in no-auth mode", () => {
  it("answers AUTH_OK naming the connection, whatever the token", () => {
    const relay = new Relay();
    for (const token of ["dev", "", "anything"]) {
      const { id } = relay.open();
      const out = relay.receive(id, JSON.stringify({ type: "AUTH", token }));
      expect(out.map((o) => o.to)).toEqual([id]);
      // ServerMessage::AuthOk, its fields in serde's order.
      expect(out[0]?.frame).toMatch(
        /^\{"type":"AUTH_OK","conn_id":"[^"]+","server_time":"[^"]+"\}$/,
      );
      expect(sentTo(out, id)[0]?.conn_id).toBe(id);
      expect(Number.isNaN(Date.parse(String(sentTo(out, id)[0]?.server_time)))).toBe(false);
    }
  });

  it("names every connection differently", () => {
    const relay = new Relay();
    const ids = new Set(Array.from({ length: 20 }, () => relay.open().id));
    expect(ids.size).toBe(20);
  });

  it("serves nothing but PING before it — handle_subscribe and authorize_publish_topic", () => {
    const relay = new Relay();
    const listener = joined(relay, "one");
    const { id } = relay.open();
    expect(relay.receive(id, subscribe("one"))).toEqual([]);
    expect(sentTo(relay.receive(id, publish("one", { v: 1 })), listener)).toEqual([]);
    expect(sentTo(relay.receive(id, PING), id)).toEqual([
      { type: "PONG", server_time: expect.any(String) },
    ]);
  });
});

describe("SUBSCRIBE — handle_subscribe", () => {
  it("answers SUBSCRIBED with the client's sub_id and seq 0", () => {
    const relay = new Relay();
    const { id } = relay.open();
    relay.receive(id, AUTH);
    expect(relay.receive(id, subscribe("one"))).toEqual([
      { to: id, frame: '{"type":"SUBSCRIBED","sub_id":"live","seq":0}' },
    ]);
  });

  it("matches a pattern to a topic as TopicPattern does: `*` one segment, `**` the rest, a trailing `/` a prefix, else exact", () => {
    expect(topicMatches("boards/one/*", "boards/one/live")).toBe(true);
    expect(topicMatches("boards/one/*", "boards/two/live")).toBe(false);
    expect(topicMatches("boards/one/*", "boards/one/live/more")).toBe(false);
    expect(topicMatches("boards/one/*", "boards/one")).toBe(false);
    // A `*` inside a segment is not a wildcard: glob_match compares the segment whole.
    expect(topicMatches("boards/o*/live", "boards/one/live")).toBe(false);
    expect(topicMatches("boards/**", "boards/one/live")).toBe(true);
    expect(topicMatches("boards/one/", "boards/one/live")).toBe(true);
    expect(topicMatches("boards/one/live", "boards/one/live")).toBe(true);
    expect(topicMatches("boards/one/live", "boards/one/livex")).toBe(false);
  });

  it("refuses the 201st subscription with CAPACITY_EXCEEDED — the registry's per-connection guard", () => {
    const relay = new Relay();
    const { id } = relay.open();
    relay.receive(id, AUTH);
    for (let i = 0; i < 200; i += 1) {
      expect(sentTo(relay.receive(id, subscribe("d", `s${i}`)), id)).toMatchObject([
        { type: "SUBSCRIBED" },
      ]);
    }
    expect(sentTo(relay.receive(id, subscribe("d", "s200")), id)).toEqual([
      { type: "ERROR", code: "CAPACITY_EXCEEDED", message: expect.any(String) },
    ]);
  });

  it("refuses a subscription that would not fit in the socket's attachment, and carries on", () => {
    const relay = new Relay();
    const { id } = relay.open();
    relay.receive(id, AUTH);
    const huge = JSON.stringify({ type: "SUBSCRIBE", sub_id: "big", topic: "x".repeat(16_384) });
    expect(sentTo(relay.receive(id, huge), id)).toMatchObject([
      { type: "ERROR", code: "CAPACITY_EXCEEDED" },
    ]);
    expect(JSON.stringify(relay.connection(id)).length).toBeLessThan(16_384);
    expect(sentTo(relay.receive(id, subscribe("one")), id)).toMatchObject([{ type: "SUBSCRIBED" }]);
  });
});

describe("PUBLISH — handle_publish and the router", () => {
  it("delivers to the other subscriber of the drawing as EVENT, and not to another drawing's", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    const c = joined(relay, "two");
    const sealed = { v: 1, iv: "aXY=", ct: "Y3Q=" };
    const out = relay.receive(a, publish("one", sealed));
    expect(sentTo(out, b)).toEqual([
      {
        type: "EVENT",
        sub_id: "live",
        event: {
          event_id: expect.any(String),
          topic: "boards/one/live",
          event_type: "patch",
          sequence: 1,
          timestamp: expect.any(String),
          payload: sealed,
        },
      },
    ]);
    // ServerMessage::Event around EventPayload, both in serde's field order.
    expect(out.find((o) => o.to === b)?.frame).toMatch(
      /^\{"type":"EVENT","sub_id":"live","event":\{"event_id":"[^"]+","topic":"boards\/one\/live","event_type":"patch","sequence":1,"timestamp":"[^"]+","payload":\{.*\}\}\}$/,
    );
    expect(sentTo(out, c)).toEqual([]);
  });

  it("numbers events per topic, from 1 — SequenceGenerator", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const c = joined(relay, "two");
    const sequence = (out: Outbound[], id: string) =>
      sentTo(out, id).map((f) => (f.event as { sequence: number }).sequence);
    relay.receive(a, publish("one", 1));
    expect(sequence(relay.receive(a, publish("one", 2)), a)).toEqual([2]);
    expect(sequence(relay.receive(c, publish("two", 1)), c)).toEqual([1]);
  });

  it("sends the publisher its own EVENT too — the router matches every subscription, its own included", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    expect(sentTo(relay.receive(a, publish("one", { v: 1 })), a)).toMatchObject([
      { type: "EVENT", sub_id: "live", event: { payload: { v: 1 } } },
    ]);
  });

  it("sends one EVENT per matching subscription, under each one's sub_id", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    relay.receive(b, JSON.stringify({ type: "SUBSCRIBE", sub_id: "all", topic: "boards/**" }));
    expect(sentTo(relay.receive(a, publish("one", 1)), b).map((f) => f.sub_id)).toEqual([
      "live",
      "all",
    ]);
  });

  it("delivers a null payload, which serde reads as a JSON null", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    expect(sentTo(relay.receive(a, publish("one", null)), b)).toMatchObject([
      { type: "EVENT", event: { payload: null } },
    ]);
  });
});

describe("PING — handle_ping", () => {
  it("answers PONG with the server's time", () => {
    const relay = new Relay();
    const { id } = relay.open();
    const out = relay.receive(id, PING);
    expect(out.map((o) => o.to)).toEqual([id]);
    expect(out[0]?.frame).toMatch(/^\{"type":"PONG","server_time":"[^"]+"\}$/);
  });
});

describe("the 64 KiB cap — MAX_WS_PAYLOAD_BYTES in handlers.rs", () => {
  /** A string payload whose JSON is `bytes` long: two quotes around it. */
  const ofBytes = (bytes: number) => "x".repeat(bytes - 2);

  it("delivers a payload of exactly 65,536 bytes", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    expect(sentTo(relay.receive(a, publish("one", ofBytes(65_536))), b)).toHaveLength(1);
  });

  it("drops one a byte over without an answer to anyone, and the connection carries on", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    expect(relay.receive(a, publish("one", ofBytes(65_537)))).toEqual([]);
    expect(sentTo(relay.receive(a, publish("one", { v: 1 })), b)).toHaveLength(1);
  });

  it("counts UTF-8 bytes, as serde_json::to_vec does, not characters", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    // "é" is two bytes: 32,767 of them and two quotes is 65,536 bytes in 32,769 characters.
    expect(sentTo(relay.receive(a, publish("one", "é".repeat(32_767))), b)).toHaveLength(1);
    expect(relay.receive(a, publish("one", "é".repeat(32_768)))).toEqual([]);
  });
});

describe("a malformed frame — dispatch_text drops what does not parse as a ClientMessage", () => {
  it.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["null", "null"],
    ["a string", '"PING"'],
    ["no type", '{"token":"dev"}'],
    ["an unknown type", '{"type":"HELLO"}'],
    ["a type in the wrong case", '{"type":"ping"}'],
    ["AUTH without a token", '{"type":"AUTH"}'],
    ["AUTH with a number for a token", '{"type":"AUTH","token":5}'],
    ["SUBSCRIBE without a topic", '{"type":"SUBSCRIBE","sub_id":"x"}'],
    ["SUBSCRIBE without a sub_id", '{"type":"SUBSCRIBE","topic":"boards/one/*"}'],
    [
      "PUBLISH without a payload",
      '{"type":"PUBLISH","topic":"boards/one/live","event_type":"patch"}',
    ],
    ["PUBLISH without an event_type", '{"type":"PUBLISH","topic":"boards/one/live","payload":1}'],
    [
      "PUBLISH with a number for a topic",
      '{"type":"PUBLISH","topic":1,"event_type":"p","payload":1}',
    ],
  ])("ignores %s, answering nothing, and the connection carries on", (_what, frame) => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    expect(relay.receive(a, frame)).toEqual([]);
    expect(sentTo(relay.receive(a, publish("one", { v: 1 })), b)).toHaveLength(1);
  });
});

describe("a closed connection", () => {
  it("is sent nothing more, and what it sends is not served", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    expect(sentTo(relay.receive(a, publish("one", 1)), b)).toHaveLength(1);
    relay.close(b);
    const out = relay.receive(a, publish("one", 2));
    expect(sentTo(out, b)).toEqual([]);
    expect(sentTo(out, a)).toHaveLength(1);
    expect(relay.receive(b, PING)).toEqual([]);
  });
});

describe("a connection restored from what `connection` returned — a woken object", () => {
  it("is served as before: still authenticated, still subscribed", () => {
    const before = new Relay();
    const a = joined(before, "one");
    const b = joined(before, "one");
    const kept = [a, b].map((id) => structuredClone(before.connection(id)));
    const after = new Relay();
    for (const conn of kept) {
      if (conn) after.open(conn);
    }
    expect(sentTo(after.receive(a, publish("one", { v: 1 })), b)).toMatchObject([
      { type: "EVENT", event: { payload: { v: 1 } } },
    ]);
  });
});

/*
 * Fix round 1. What one frame may cost the one object every drawing shares: none of these
 * frames is one the client sends, so refusing them changes nothing it can see.
 */
describe("what one frame may cost", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A connection subscribed to every topic, which sees whatever is published. */
  function watcher(relay: Relay): string {
    const { id } = relay.open();
    relay.receive(id, AUTH);
    relay.receive(id, JSON.stringify({ type: "SUBSCRIBE", sub_id: "all", topic: "**" }));
    return id;
  }

  it("drops a frame far longer than any the client sends without parsing it, and carries on", () => {
    const relay = new Relay();
    const all = watcher(relay);
    const a = joined(relay, "one");
    const huge = JSON.stringify({
      type: "PUBLISH",
      topic: `boards/${"x".repeat(5_000_000)}/live`,
      event_type: "patch",
      payload: 1,
    });
    const parse = vi.spyOn(JSON, "parse");
    expect(relay.receive(a, huge)).toEqual([]);
    expect(parse.mock.calls.some(([text]) => text === huge)).toBe(false);
    expect(sentTo(relay.receive(a, publish("one", 1)), all)).toHaveLength(1);
  });

  it("drops a publish whose topic is over 256 bytes, and serves one of 256", () => {
    const relay = new Relay();
    const all = watcher(relay);
    const a = joined(relay, "one");
    const topic = (bytes: number) => `boards/${"x".repeat(bytes - 7)}`;
    const to = (t: string) =>
      JSON.stringify({ type: "PUBLISH", topic: t, event_type: "patch", payload: 1 });
    expect(sentTo(relay.receive(a, to(topic(257))), all)).toEqual([]);
    expect(sentTo(relay.receive(a, to(topic(256))), all)).toHaveLength(1);
  });

  it("keeps a sequence for at most 10,000 topics, forgetting the least recently published", () => {
    const relay = new Relay();
    const all = watcher(relay);
    const a = joined(relay, "one");
    const sequenceOf = (topic: string) => {
      const out = relay.receive(
        a,
        JSON.stringify({ type: "PUBLISH", topic, event_type: "patch", payload: 1 }),
      );
      return (sentTo(out, all)[0]?.event as { sequence?: number } | undefined)?.sequence;
    };
    expect(sequenceOf("t/0")).toBe(1);
    for (let i = 1; i <= 10_000; i += 1) sequenceOf(`t/${i}`);
    // 10,001 topics seen: the first is forgotten, the last is still counted.
    expect(sequenceOf("t/10000")).toBe(2);
    expect(sequenceOf("t/0")).toBe(1);
  });

  it("drops a frame nested deeper than 127 levels, as serde_json's recursion limit does", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    /** A PUBLISH whose payload is `n` arrays deep, so the frame is `n + 1` deep. */
    const nested = (n: number) =>
      `{"type":"PUBLISH","topic":"boards/one/live","event_type":"patch","payload":${"[".repeat(n)}${"]".repeat(n)}}`;
    expect(sentTo(relay.receive(a, nested(126)), b)).toHaveLength(1);
    expect(relay.receive(a, nested(127))).toEqual([]);
    // Deep enough that JSON.stringify would throw RangeError; still under the frame cap.
    expect(() => relay.receive(a, nested(30_000))).not.toThrow();
    expect(relay.receive(a, nested(30_000))).toEqual([]);
    // Brackets inside a string are not nesting.
    expect(sentTo(relay.receive(a, publish("one", "[".repeat(1_000))), b)).toHaveLength(1);
    // Nor after an escaped quote, which does not end the string.
    expect(sentTo(relay.receive(a, publish("one", `"${"[".repeat(1_000)}`)), b)).toHaveLength(1);
    expect(sentTo(relay.receive(a, publish("one", 1)), b)).toHaveLength(1);
  });
});

/*
 * Fix round 1, Ruling 26: beyond the Rust relay, and additive. The client lets go of what a
 * peer held as soon as it hears `gone` about that peer's socket (`realtimeClient.ts`,
 * `handleControl`); the browser tests' stub relay sends it (`e2e/board.ts`, `relay()`).
 */
describe("a connection that closes", () => {
  it("is announced as gone, by the name AUTH_OK gave it, to the others on its drawing only", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const b = joined(relay, "one");
    const c = joined(relay, "two");
    const out = relay.close(b);
    expect(out).toEqual([{ to: a, frame: `{"type":"gone","socket":"${b}"}` }]);
    expect(sentTo(out, c)).toEqual([]);
  });

  it("is announced once to a peer, however many of its subscriptions they share", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    relay.receive(a, subscribe("two", "second"));
    const b = joined(relay, "one");
    relay.receive(b, subscribe("two", "second"));
    expect(relay.close(b).map((o) => o.to)).toEqual([a]);
  });

  it("is announced to no one when it never subscribed, or is already gone", () => {
    const relay = new Relay();
    const a = joined(relay, "one");
    const { id } = relay.open();
    relay.receive(id, AUTH);
    expect(relay.close(id)).toEqual([]);
    const b = joined(relay, "one");
    expect(relay.close(b).map((o) => o.to)).toEqual([a]);
    expect(relay.close(b)).toEqual([]);
  });
});
