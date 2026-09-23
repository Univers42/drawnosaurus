import { env } from "$env/dynamic/public";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";
import type { Claims, PeerState } from "./peerClaims.ts";
import { isSealedEnvelope, open, seal, type RoomKey, type SealedEnvelope } from "./roomCrypto.ts";

/**
 * The live socket lives on the API, which is not always the page's origin: compose
 * publishes web and api on different host ports, and the browser — not the compose
 * network — resolves this URL. So it mirrors the HTTP client exactly: PUBLIC_API_URL
 * when set, relative otherwise (dev proxy and same-origin deploys), then http(s)
 * swapped for ws(s). Resolving against the page href keeps any path prefix in the
 * base, which a bare `new URL(path, origin)` would drop.
 */
export function liveSocketUrl(slug: string, apiBase: string, pageHref: string): string {
  const base = apiBase.replace(/\/$/, "");
  const url = new URL(`${base}/v1/boards/${slug}/live`, pageHref);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // Fragment room keys must never land on the handshake URL — the server would see them.
  url.hash = "";
  url.search = "";
  return url.toString();
}

export interface PeerCursor {
  clientId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  /**
   * Whether they have pointed anywhere yet. Someone known only from a join or their
   * presence has no position, and drawing them at 0,0 put a stranger's cursor in the
   * top-left corner of every board.
   */
  pointed?: boolean;
  lastActive: number;
}

/** A peer, with what they hold and their gesture in progress — see `peerClaims.ts`. */
export interface Peer<T> extends PeerCursor, PeerState<T> {}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type RealtimeMessage<T extends StampedElement> =
  | { type: "cursor"; clientId: string; name: string; color: string; x: number; y: number }
  | { type: "patch"; clientId: string; patch: ScenePatch<T> }
  | { type: "join"; clientId: string; name: string; color: string }
  | { type: "leave"; clientId: string }
  /** What the sender holds: their selection, with when they took each element. */
  | { type: "presence"; clientId: string; name: string; color: string; claims: Claims }
  /** Their gesture in progress: the elements it changes, as they are right now. */
  | { type: "preview"; clientId: string; elements: T[] }
  /** The gesture is over; its commit went out before this, as a patch. */
  | { type: "preview-end"; clientId: string };

const CURSOR_COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599"];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
/** Drop peers that go silent without a leave (tab crash, network drop). */
const PEER_STALE_MS = 45_000;
const PEER_SWEEP_MS = 10_000;
/**
 * How often presence is repeated with nothing new in it. Well inside `PEER_STALE_MS`, so
 * someone who has stopped moving their mouse — reading, thinking — is not swept from the
 * room and does not lose hold of what they have selected.
 */
const PRESENCE_HEARTBEAT_MS = 15_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

export function getCollaboratorProfile(): { clientId: string; name: string; color: string } {
  if (typeof window === "undefined") {
    return { clientId: "ssr", name: "Guest", color: "#1971c2" };
  }
  let id = sessionStorage.getItem("drawnosaurus:clientId");
  if (!id) {
    id = `user_${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem("drawnosaurus:clientId", id);
  }
  let name = sessionStorage.getItem("drawnosaurus:userName");
  if (!name) {
    const num = Math.floor(Math.random() * 900 + 100);
    name = `Dino ${num}`;
    sessionStorage.setItem("drawnosaurus:userName", name);
  }
  const colorIndex =
    Math.abs(id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)) % CURSOR_COLORS.length;
  return { clientId: id, name, color: CURSOR_COLORS[colorIndex] ?? "#1971c2" };
}

export class RealtimeChannel<T extends StampedElement> {
  readonly profile = getCollaboratorProfile();
  private ws: WebSocket | null = null;
  private readonly peers = new Map<string, Peer<T>>();
  private listeners: ((peers: Peer<T>[]) => void)[] = [];
  private stateListeners: ((peers: Peer<T>[]) => void)[] = [];
  /** What this client holds, repeated on every join and heartbeat. */
  private claims: Claims = {};
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Frames go out in the order they were sent. Sealing is asynchronous, and two seals
   * in flight can finish in either order — a gesture's preview arriving after its end
   * would leave a shape frozen mid-move on everyone else's screen.
   */
  private outbound: Promise<void> = Promise.resolve();
  private patchListeners: ((patch: ScenePatch<T>) => void)[] = [];
  private statusListeners: ((status: ConnectionStatus) => void)[] = [];
  private connected = false;
  private roomKey: RoomKey | null;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private peerSweepTimer: ReturnType<typeof setInterval> | null = null;
  private status: ConnectionStatus = "disconnected";
  private preferredUrl: string | undefined;

  /**
   * @param roomKey When set, every frame is AES-GCM sealed and plaintext inbound is
   * dropped (no downgrade). When null, frames stay JSON plaintext for unkeyed URLs.
   */
  constructor(
    readonly slug: string,
    roomKey: RoomKey | null = null,
  ) {
    this.roomKey = roomKey;
  }

  get encrypted(): boolean {
    return this.roomKey !== null;
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * The network is back: try now rather than at the end of a backoff that may have grown
   * to fifteen seconds while it was gone.
   */
  private readonly onOnline = (): void => {
    if (this.intentionalClose || this.ws) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.openSocket();
  };

  setRoomKey(key: RoomKey | null): void {
    this.roomKey = key;
  }

  connect(wsUrl?: string): void {
    if (typeof window === "undefined") return;
    this.intentionalClose = false;
    this.preferredUrl = wsUrl;
    window.addEventListener("online", this.onOnline);
    this.openSocket();
    if (!this.peerSweepTimer) {
      this.peerSweepTimer = setInterval(() => this.sweepStalePeers(), PEER_SWEEP_MS);
    }
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => this.sendPresence(), PRESENCE_HEARTBEAT_MS);
    }
  }

  private openSocket(): void {
    if (this.ws) return;
    const url = this.preferredUrl ?? this.defaultWsUrl();
    this.setStatus("connecting");
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempt = 0;
        this.setStatus("connected");
        void this.send({
          type: "join",
          clientId: this.profile.clientId,
          name: this.profile.name,
          color: this.profile.color,
        });
        this.sendPresence();
      };
      this.ws.onmessage = (event) => {
        void this.receiveFrame(event.data as string);
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        // Nothing heard from anyone from here on is current: a gesture frozen mid-move
        // or a hold released meanwhile. They say it all again when we are back.
        if (this.peers.size > 0) {
          this.peers.clear();
          this.notifyPeers();
          this.notifyState();
        }
        this.setStatus("disconnected");
        if (!this.intentionalClose) this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        // onclose follows; reconnect is scheduled there.
      };
    } catch {
      this.connected = false;
      this.ws = null;
      this.setStatus("disconnected");
      if (!this.intentionalClose) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of this.statusListeners) listener(next);
  }

  private defaultWsUrl(): string {
    return liveSocketUrl(this.slug, env.PUBLIC_API_URL ?? "", window.location.href);
  }

  sendCursor(x: number, y: number): void {
    void this.send({
      type: "cursor",
      clientId: this.profile.clientId,
      name: this.profile.name,
      color: this.profile.color,
      x,
      y,
    });
  }

  sendPatch(patch: ScenePatch<T>): void {
    void this.send({
      type: "patch",
      clientId: this.profile.clientId,
      patch,
    });
  }

  /** Says what this client now holds, and keeps saying it — see `PRESENCE_HEARTBEAT_MS`. */
  setClaims(claims: Claims): void {
    this.claims = claims;
    this.sendPresence();
  }

  get ownClaims(): Claims {
    return this.claims;
  }

  private sendPresence(): void {
    void this.send({
      type: "presence",
      clientId: this.profile.clientId,
      name: this.profile.name,
      color: this.profile.color,
      claims: this.claims,
    });
  }

  sendPreview(elements: T[]): void {
    void this.send({ type: "preview", clientId: this.profile.clientId, elements });
  }

  sendPreviewEnd(): void {
    void this.send({ type: "preview-end", clientId: this.profile.clientId });
  }

  private send(msg: RealtimeMessage<T>): Promise<void> {
    const socket = this.ws;
    if (!socket || !this.connected || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve();
    }
    // Sealed now, in parallel with whatever is ahead; written only after it.
    const sealed = this.encodeOutbound(msg);
    this.outbound = this.outbound.then(async () => {
      const wire = await sealed;
      // The socket as it was before the await: sealing is asynchronous, and a drop in
      // between left `this.ws` null — a send racing a disconnect threw an unhandled error.
      if (wire !== null && socket.readyState === WebSocket.OPEN) socket.send(wire);
    });
    return this.outbound;
  }

  /** Encode a message the way the wire would carry it (for tests). */
  async encodeOutbound(msg: RealtimeMessage<T>): Promise<string | null> {
    if (!this.roomKey) {
      return JSON.stringify(msg);
    }
    try {
      const envelope = await seal(this.roomKey, textEncoder.encode(JSON.stringify(msg)));
      return JSON.stringify(envelope);
    } catch {
      return null;
    }
  }

  async receiveFrame(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (this.roomKey) {
      if (!isSealedEnvelope(parsed)) {
        // Keyed mode never accepts plaintext — blocks a server/network downgrade.
        return;
      }
      const plain = await open(this.roomKey, parsed);
      if (!plain) return;
      try {
        const msg = JSON.parse(textDecoder.decode(plain)) as RealtimeMessage<T>;
        this.handleMessage(msg);
      } catch {
        // ignore malformed inner payload
      }
      return;
    }

    if (isSealedEnvelope(parsed)) {
      // Unkeyed client cannot read sealed frames.
      return;
    }
    this.handleMessage(parsed as RealtimeMessage<T>);
  }

  handleMessage(msg: RealtimeMessage<T>): void {
    if (msg.clientId === this.profile.clientId) return;
    if (msg.type === "cursor") {
      this.upsertPeer(msg.clientId, {
        name: msg.name,
        color: msg.color,
        x: msg.x,
        y: msg.y,
        pointed: true,
      });
      this.notifyPeers();
    } else if (msg.type === "join") {
      this.upsertPeer(msg.clientId, { name: msg.name, color: msg.color });
      this.notifyPeers();
      this.notifyState();
      // Existing members answer so the newcomer sees them without waiting for a cursor —
      // and sees what they hold, so it cannot take it. Every join, not only a stranger's:
      // someone back from a dropped connection is still known here, but no longer knows
      // anyone. Answered with presence, which is never answered, so it cannot echo.
      this.sendPresence();
    } else if (msg.type === "presence") {
      this.upsertPeer(msg.clientId, { name: msg.name, color: msg.color, claims: msg.claims ?? {} });
      this.notifyPeers();
      this.notifyState();
    } else if (msg.type === "preview") {
      if (!Array.isArray(msg.elements)) return;
      this.upsertPeer(msg.clientId, { preview: msg.elements });
      this.notifyState();
    } else if (msg.type === "preview-end") {
      const peer = this.peers.get(msg.clientId);
      if (!peer?.preview) return;
      delete peer.preview;
      this.notifyState();
    } else if (msg.type === "patch") {
      this.patchListeners.forEach((fn) => fn(msg.patch));
    } else if (msg.type === "leave") {
      this.peers.delete(msg.clientId);
      this.notifyPeers();
      this.notifyState();
    }
  }

  /** Updates what is known of a peer, meeting them first if need be. Any word from them is a sign of life. */
  private upsertPeer(clientId: string, update: Partial<Peer<T>>): void {
    const existing = this.peers.get(clientId);
    const peer: Peer<T> = existing ?? {
      clientId,
      name: "Guest",
      color: "#1971c2",
      x: 0,
      y: 0,
      lastActive: 0,
      claims: {},
    };
    Object.assign(peer, update, { lastActive: Date.now() });
    this.peers.set(clientId, peer);
  }

  private sweepStalePeers(): void {
    const cutoff = Date.now() - PEER_STALE_MS;
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (peer.lastActive < cutoff) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.notifyPeers();
      this.notifyState();
    }
  }

  onPeers(callback: (peers: Peer<T>[]) => void): () => void {
    this.listeners.push(callback);
    callback(Array.from(this.peers.values()));
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /**
   * Called when what a peer holds or is doing changes — not on every cursor move, which
   * `onPeers` reports sixty times a second and which the engine has no use for.
   */
  onPeerState(callback: (peers: Peer<T>[]) => void): () => void {
    this.stateListeners.push(callback);
    callback(Array.from(this.peers.values()));
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== callback);
    };
  }

  onRemotePatch(callback: (patch: ScenePatch<T>) => void): () => void {
    this.patchListeners.push(callback);
    return () => {
      this.patchListeners = this.patchListeners.filter((l) => l !== callback);
    };
  }

  onStatus(callback: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.push(callback);
    callback(this.status);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== callback);
    };
  }

  private notifyPeers(): void {
    const list = Array.from(this.peers.values());
    this.listeners.forEach((fn) => fn(list));
  }

  private notifyState(): void {
    const list = Array.from(this.peers.values());
    this.stateListeners.forEach((fn) => fn(list));
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.peerSweepTimer) {
      clearInterval(this.peerSweepTimer);
      this.peerSweepTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      const socket = this.ws;
      const leave: RealtimeMessage<T> = { type: "leave", clientId: this.profile.clientId };
      // Seal is async; close only after the leave frame is queued so peers drop the cursor.
      void this.encodeOutbound(leave).then((wire) => {
        if (wire && socket.readyState === WebSocket.OPEN) {
          socket.send(wire);
        }
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      });
      this.ws = null;
    }
    this.connected = false;
    this.peers.clear();
    this.notifyPeers();
    this.notifyState();
    this.setStatus("disconnected");
  }
}

export type { SealedEnvelope };
