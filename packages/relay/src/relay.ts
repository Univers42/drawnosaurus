/**
 * The public build's relay, as a pure state machine: connections in, frames in, frames out
 * for each connection. No Cloudflare in it, so it is tested in plain Node, and the Durable
 * Object around it (`worker.ts`) is glue.
 *
 * It speaks the part of engine/realtime's wire protocol the web client uses
 * (`apps/web/src/lib/realtime/realtimeProtocol.ts`) — AUTH, SUBSCRIBE, PUBLISH, PING —
 * with the Rust relay's frame shapes (`realtime-core/src/protocol.rs`) and what its gateway
 * does with each (`realtime-gateway/src/ws_handler/reader.rs`, `handlers.rs`), so the
 * client cannot tell the two apart. The rest of that protocol (UNSUBSCRIBE,
 * SUBSCRIBE_BATCH, BROADCAST, TRACK, UNTRACK) the client never sends; here it is ignored
 * like any frame that does not parse.
 *
 * It never looks inside a payload: it measures it and passes it on, sealed as it came.
 */

/** handlers.rs `MAX_WS_PAYLOAD_BYTES`: a publish over it is dropped, unanswered. */
export const MAX_PAYLOAD_BYTES = 65_536;

/** The registry's `max_subscriptions_per_connection` (`filter_index/limits.rs`). */
export const MAX_SUBSCRIPTIONS = 200;

/**
 * What a connection may grow to, as JSON. Its socket's attachment holds at most 16,384
 * bytes serialized (Cloudflare, `serializeAttachment`); half of that leaves room for the
 * structured clone's own overhead, and the client needs under a hundred bytes.
 */
export const MAX_CONNECTION_BYTES = 8_192;

/** What one connection is: kept in its socket's attachment, so a woken object rebuilds it. */
export interface Connection {
  id: string;
  authenticated: boolean;
  /**
   * Its subscriptions, as the client named them: `sub_id` and topic pattern. Pairs rather
   * than an object keyed by `sub_id`, which the client chooses — `__proto__` included.
   */
  subs: [subId: string, pattern: string][];
}

/** One frame for one connection. */
export interface Outbound {
  to: string;
  frame: string;
}

type ClientFrame = Record<string, unknown>;

const utf8 = new TextEncoder();
const byteLength = (text: string): number => utf8.encode(text).length;

/** RFC 3339, as the Rust relay's `to_rfc3339()` stamps `server_time` and `timestamp`. */
const now = (): string => new Date().toISOString();

export class Relay {
  private readonly connections = new Map<string, Connection>();
  /** The last sequence given out per topic, as `SequenceGenerator` keeps it: in memory. */
  private readonly sequences = new Map<string, number>();

  /** A new connection, or one restored from what `connection` returned before. */
  open(restored?: Connection): Connection {
    const conn = restored ?? {
      id: `conn-${crypto.randomUUID()}`,
      authenticated: false,
      subs: [],
    };
    this.connections.set(conn.id, conn);
    return conn;
  }

  /** The connection as it now is, for its socket's attachment. */
  connection(id: string): Connection | undefined {
    return this.connections.get(id);
  }

  /** Forgets a connection: it is sent nothing more, and what it sends is not served. */
  close(id: string): Outbound[] {
    this.connections.delete(id);
    return [];
  }

  /**
   * One frame from `id`, and what it causes. A frame that does not parse is dropped
   * without an answer and the connection carries on, as `dispatch_text` does.
   */
  receive(id: string, text: string): Outbound[] {
    const conn = this.connections.get(id);
    const msg = parse(text);
    if (!conn || !msg) return [];
    const reply = (frame: unknown): Outbound[] => [{ to: id, frame: JSON.stringify(frame) }];
    switch (msg.type) {
      case "AUTH":
        // No-auth mode (`NoAuthProvider`): any token is accepted, the empty one included.
        if (typeof msg.token !== "string") return [];
        conn.authenticated = true;
        return reply({ type: "AUTH_OK", conn_id: id, server_time: now() });
      case "SUBSCRIBE":
        if (typeof msg.sub_id !== "string" || typeof msg.topic !== "string") return [];
        // Before AUTH: dropped, unanswered (`handle_subscribe`).
        if (!conn.authenticated) return [];
        return reply(subscribe(conn, msg.sub_id, msg.topic));
      case "PUBLISH":
        // `payload` may be any JSON, `null` included, but not missing.
        if (typeof msg.topic !== "string" || typeof msg.event_type !== "string") return [];
        if (!("payload" in msg) || !conn.authenticated) return [];
        return this.publish(msg.topic, msg.event_type, msg.payload);
      case "PING":
        // Answered before AUTH too (`handle_ping` checks nothing).
        return reply({ type: "PONG", server_time: now() });
      default:
        return [];
    }
  }

  /**
   * An EVENT for every subscription whose pattern matches the topic, the publisher's own
   * included — the router excludes no one (`route_event`), and the client drops its own
   * frames by their `clientId`.
   */
  private publish(topic: string, eventType: string, payload: unknown): Outbound[] {
    const body = JSON.stringify(payload);
    if (byteLength(body) > MAX_PAYLOAD_BYTES) return [];
    const sequence = (this.sequences.get(topic) ?? 0) + 1;
    this.sequences.set(topic, sequence);
    // Rendered once for every subscriber, as the Rust writer does (`serialize_event`),
    // with `EventPayload`'s fields in its order.
    const event = JSON.stringify({
      event_id: crypto.randomUUID(),
      topic,
      event_type: eventType,
      sequence,
      timestamp: now(),
      payload,
    });
    const out: Outbound[] = [];
    for (const conn of this.connections.values()) {
      for (const [subId, pattern] of conn.subs) {
        if (!topicMatches(pattern, topic)) continue;
        const frame = `{"type":"EVENT","sub_id":${JSON.stringify(subId)},"event":${event}}`;
        out.push({ to: conn.id, frame });
      }
    }
    return out;
  }
}

/** SUBSCRIBED, or the ERROR the registry's guard answers when the connection is full. */
function subscribe(conn: Connection, subId: string, pattern: string): unknown {
  const count = conn.subs.length;
  if (count >= MAX_SUBSCRIPTIONS) {
    return capacityExceeded(
      `connection ${conn.id} already has ${count} subscriptions (max: ${MAX_SUBSCRIPTIONS})`,
    );
  }
  // The same sub_id again replaces its pattern rather than adding a second one.
  const subs: Connection["subs"] = [...conn.subs.filter(([id]) => id !== subId), [subId, pattern]];
  if (byteLength(JSON.stringify({ ...conn, subs })) > MAX_CONNECTION_BYTES) {
    return capacityExceeded(
      `connection ${conn.id}'s subscriptions would be over ${MAX_CONNECTION_BYTES} bytes`,
    );
  }
  conn.subs = subs;
  return { type: "SUBSCRIBED", sub_id: subId, seq: 0 };
}

/** `RealtimeError::CapacityExceeded`, as `handle_subscribe` sends it. */
function capacityExceeded(reason: string): unknown {
  return { type: "ERROR", code: "CAPACITY_EXCEEDED", message: `Capacity exceeded: ${reason}` };
}

/** A JSON object, or null for anything else: serde's tagged enum takes nothing else. */
function parse(text: string): ClientFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ClientFrame)
    : null;
}

/**
 * `TopicPattern::parse` then `matches` (`realtime-core/src/types/topic_pattern.rs`): with
 * a `*` it is a glob — `*` is one whole segment, `**` everything after it; ending in `/`
 * it is a prefix; otherwise it is the topic exactly.
 */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern.includes("*")) {
    const want = pattern.split("/");
    const have = topic.split("/");
    for (const [i, segment] of want.entries()) {
      if (segment === "**") return true;
      if (i >= have.length) return false;
      if (segment !== "*" && segment !== have[i]) return false;
    }
    return want.length === have.length;
  }
  if (pattern.endsWith("/")) return topic.startsWith(pattern);
  return pattern === topic;
}
