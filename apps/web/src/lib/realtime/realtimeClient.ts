import { env } from "$env/dynamic/public";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";
import {
  authFrame,
  collabPayloadFromServerFrame,
  isAuthOk,
  isSubscribedLive,
  liveSocketUrl,
  publishFrame,
  subscribeFrame,
} from "./realtimeProtocol.ts";
import { isSealedEnvelope, open, seal, type SealedEnvelope } from "./roomCrypto.ts";

export { liveSocketUrl } from "./realtimeProtocol.ts";

export interface PeerCursor {
  clientId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  lastActive: number;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type RealtimeMessage<T extends StampedElement> =
  | { type: "cursor"; clientId: string; name: string; color: string; x: number; y: number }
  | { type: "patch"; clientId: string; patch: ScenePatch<T> }
  | { type: "join"; clientId: string; name: string; color: string }
  | { type: "leave"; clientId: string };

const CURSOR_COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599"];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
/** Drop peers that go silent without a leave (tab crash, network drop). */
const PEER_STALE_MS = 45_000;
const PEER_SWEEP_MS = 10_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;
const DEV_AUTH_TOKEN = "dev";

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

/**
 * Live collab channel over engine/realtime: AUTH → SUBSCRIBE boards/{slug}/*
 * → PUBLISH sealed (or plaintext) collab payloads. Scene merge stays host-side.
 */
export class RealtimeChannel<T extends StampedElement> {
  readonly profile = getCollaboratorProfile();
  private ws: WebSocket | null = null;
  private readonly peers = new Map<string, PeerCursor>();
  private listeners: ((peers: PeerCursor[]) => void)[] = [];
  private patchListeners: ((patch: ScenePatch<T>) => void)[] = [];
  private statusListeners: ((status: ConnectionStatus) => void)[] = [];
  private sessionReady = false;
  private roomKey: CryptoKey | null;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private peerSweepTimer: ReturnType<typeof setInterval> | null = null;
  private status: ConnectionStatus = "disconnected";
  private preferredUrl: string | undefined;
  /** Outbound frames queued until AUTH+SUBSCRIBE completes. */
  private pendingOutbound: RealtimeMessage<T>[] = [];

  /**
   * @param roomKey When set, every frame is AES-GCM sealed and plaintext inbound is
   * dropped (no downgrade). When null, frames stay JSON plaintext for unkeyed URLs.
   */
  constructor(
    readonly slug: string,
    roomKey: CryptoKey | null = null,
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

  setRoomKey(key: CryptoKey | null): void {
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
  }

  private openSocket(): void {
    if (this.ws) return;
    const url = this.preferredUrl ?? this.defaultWsUrl();
    this.sessionReady = false;
    this.setStatus("connecting");
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.ws?.send(authFrame(env.PUBLIC_REALTIME_TOKEN || DEV_AUTH_TOKEN));
      };
      this.ws.onmessage = (event) => {
        void this.onServerFrame(event.data as string);
      };
      this.ws.onclose = () => {
        this.sessionReady = false;
        this.ws = null;
        this.setStatus("disconnected");
        if (!this.intentionalClose) this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        // onclose follows; reconnect is scheduled there.
      };
    } catch {
      this.sessionReady = false;
      this.ws = null;
      this.setStatus("disconnected");
      if (!this.intentionalClose) this.scheduleReconnect();
    }
  }

  private async onServerFrame(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (isAuthOk(parsed)) {
      this.ws?.send(subscribeFrame(this.slug));
      return;
    }
    if (isSubscribedLive(parsed)) {
      this.sessionReady = true;
      this.setStatus("connected");
      void this.flushPendingOutbound();
      void this.send({
        type: "join",
        clientId: this.profile.clientId,
        name: this.profile.name,
        color: this.profile.color,
      });
      return;
    }

    const payload = collabPayloadFromServerFrame(parsed);
    if (payload !== null) {
      await this.receivePayload(payload);
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
    return liveSocketUrl(env.PUBLIC_REALTIME_WS_URL ?? "", window.location.href);
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

  private async send(msg: RealtimeMessage<T>): Promise<void> {
    if (!this.ws || !this.sessionReady || this.ws.readyState !== WebSocket.OPEN) {
      // Keep the latest join/leave/cursor; queue patches so early strokes aren't lost.
      if (msg.type === "join" || msg.type === "leave" || msg.type === "cursor") {
        this.pendingOutbound = this.pendingOutbound.filter((m) => m.type !== msg.type);
      }
      this.pendingOutbound.push(msg);
      if (this.pendingOutbound.length > 64) {
        this.pendingOutbound = this.pendingOutbound.slice(-48);
      }
      return;
    }
    const payload = await this.encodePayload(msg);
    if (payload === null) return;
    // Sealing is async: the socket may have dropped while we waited.
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.sessionReady) {
      if (msg.type === "join" || msg.type === "leave" || msg.type === "cursor") {
        this.pendingOutbound = this.pendingOutbound.filter((m) => m.type !== msg.type);
      }
      this.pendingOutbound.push(msg);
      return;
    }
    socket.send(publishFrame(this.slug, msg.type, payload));
  }

  private async flushPendingOutbound(): Promise<void> {
    const queued = this.pendingOutbound;
    this.pendingOutbound = [];
    for (const msg of queued) {
      await this.send(msg);
    }
  }

  /**
   * Collab payload as it appears inside PUBLISH / EVENT (object, not a double-encoded string).
   * Tests stringify this to assert ciphertext has no plaintext markers.
   */
  async encodeOutbound(msg: RealtimeMessage<T>): Promise<string | null> {
    const payload = await this.encodePayload(msg);
    if (payload === null) return null;
    return JSON.stringify(payload);
  }

  private async encodePayload(msg: RealtimeMessage<T>): Promise<unknown | null> {
    if (!this.roomKey) return msg;
    try {
      return await seal(this.roomKey, textEncoder.encode(JSON.stringify(msg)));
    } catch {
      return null;
    }
  }

  /** Accept a collab payload (sealed envelope or plaintext message). */
  async receiveFrame(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    await this.receivePayload(parsed);
  }

  async receivePayload(parsed: unknown): Promise<void> {
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
      this.peers.set(msg.clientId, {
        clientId: msg.clientId,
        name: msg.name,
        color: msg.color,
        x: msg.x,
        y: msg.y,
        lastActive: Date.now(),
      });
      this.notifyPeers();
    } else if (msg.type === "join") {
      const isNew = !this.peers.has(msg.clientId);
      const existing = this.peers.get(msg.clientId);
      this.peers.set(msg.clientId, {
        clientId: msg.clientId,
        name: msg.name,
        color: msg.color,
        // Keep a known cursor; otherwise leave unset so the overlay does not park
        // newcomers at the canvas origin until their first move arrives.
        x: existing?.x ?? Number.NaN,
        y: existing?.y ?? Number.NaN,
        lastActive: Date.now(),
      });
      this.notifyPeers();
      // Existing members re-announce so the newcomer sees them without waiting for a cursor.
      if (isNew) {
        void this.send({
          type: "join",
          clientId: this.profile.clientId,
          name: this.profile.name,
          color: this.profile.color,
        });
      }
    } else if (msg.type === "patch") {
      this.patchListeners.forEach((fn) => fn(msg.patch));
    } else if (msg.type === "leave") {
      this.peers.delete(msg.clientId);
      this.notifyPeers();
    }
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
    if (changed) this.notifyPeers();
  }

  onPeers(callback: (peers: PeerCursor[]) => void): () => void {
    this.listeners.push(callback);
    callback(Array.from(this.peers.values()));
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
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
    if (this.ws) {
      const socket = this.ws;
      const leave: RealtimeMessage<T> = { type: "leave", clientId: this.profile.clientId };
      void this.encodePayload(leave).then((payload) => {
        if (payload && socket.readyState === WebSocket.OPEN && this.sessionReady) {
          socket.send(publishFrame(this.slug, "leave", payload));
        }
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      });
      this.ws = null;
    }
    this.sessionReady = false;
    this.pendingOutbound = [];
    this.peers.clear();
    this.setStatus("disconnected");
  }
}

export type { SealedEnvelope };
