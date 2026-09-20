import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";

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

  constructor(readonly slug: string) {}

  connect(wsUrl?: string): void {
    if (typeof window === "undefined" || this.ws) return;
    const url = wsUrl ?? this.defaultWsUrl();
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.connected = true;
        this.send({
          type: "join",
          clientId: this.profile.clientId,
          name: this.profile.name,
          color: this.profile.color,
        });
      };
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as RealtimeMessage<T>;
          this.handleMessage(msg);
        } catch {
          // ignore malformed frame
        }
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
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${loc.host}/v1/boards/${this.slug}/live`;
  }

  sendCursor(x: number, y: number): void {
    this.send({
      type: "cursor",
      clientId: this.profile.clientId,
      name: this.profile.name,
      color: this.profile.color,
      x,
      y,
    });
  }

  sendPatch(patch: ScenePatch<T>): void {
    this.send({
      type: "patch",
      clientId: this.profile.clientId,
      patch,
    });
  }

  private send(msg: RealtimeMessage<T>): void {
    if (this.ws && this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
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
      this.send({ type: "leave", clientId: this.profile.clientId });
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.peers.clear();
  }
}
