import { env } from "$env/dynamic/public";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";
import { isSealedEnvelope, open, seal, type SealedEnvelope } from "./roomCrypto.ts";

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
  lastActive: number;
}

export type RealtimeMessage<T extends StampedElement> =
  | { type: "cursor"; clientId: string; name: string; color: string; x: number; y: number }
  | { type: "patch"; clientId: string; patch: ScenePatch<T> }
  | { type: "join"; clientId: string; name: string; color: string }
  | { type: "leave"; clientId: string };

const CURSOR_COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599"];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
  private readonly peers = new Map<string, PeerCursor>();
  private listeners: ((peers: PeerCursor[]) => void)[] = [];
  private patchListeners: ((patch: ScenePatch<T>) => void)[] = [];
  private connected = false;
  private roomKey: CryptoKey | null;

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

  setRoomKey(key: CryptoKey | null): void {
    this.roomKey = key;
  }

  connect(wsUrl?: string): void {
    if (typeof window === "undefined" || this.ws) return;
    const url = wsUrl ?? this.defaultWsUrl();
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.connected = true;
        void this.send({
          type: "join",
          clientId: this.profile.clientId,
          name: this.profile.name,
          color: this.profile.color,
        });
      };
      this.ws.onmessage = (event) => {
        void this.receiveFrame(event.data as string);
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.ws = null;
      };
    } catch {
      this.connected = false;
      this.ws = null;
    }
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

  private async send(msg: RealtimeMessage<T>): Promise<void> {
    if (!this.ws || !this.connected || this.ws.readyState !== WebSocket.OPEN) return;
    const wire = await this.encodeOutbound(msg);
    if (wire !== null) this.ws.send(wire);
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
      this.peers.set(msg.clientId, {
        clientId: msg.clientId,
        name: msg.name,
        color: msg.color,
        x: msg.x,
        y: msg.y,
        lastActive: Date.now(),
      });
      this.notifyPeers();
    } else if (msg.type === "patch") {
      this.patchListeners.forEach((fn) => fn(msg.patch));
    } else if (msg.type === "leave") {
      this.peers.delete(msg.clientId);
      this.notifyPeers();
    }
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

  private notifyPeers(): void {
    const list = Array.from(this.peers.values());
    this.listeners.forEach((fn) => fn(list));
  }

  disconnect(): void {
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
  }
}

export type { SealedEnvelope };
