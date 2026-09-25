import { env } from "$env/dynamic/public";
import type { ScenePatch, StampedElement } from "../autosave/sceneDiff.ts";
import type { Inventory } from "./liveBroadcast.ts";
import type { Claims, PeerState } from "./peerClaims.ts";
import {
  authFrame,
  collabPayloadFromServerFrame,
  isAuthOk,
  isSubscribedLive,
  liveSocketUrl,
  pingFrame,
  publishFrame,
  subscribeFrame,
} from "./realtimeProtocol.ts";
import { isSealedEnvelope, open, seal, type RoomKey, type SealedEnvelope } from "./roomCrypto.ts";

export { liveSocketUrl } from "./realtimeProtocol.ts";

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
  /**
   * What they are pointing with, as of their last cursor update. Missing — an older
   * peer's frame, or one of ours before this field existed — reads as `"pointer"`: never
   * a laser, the same default Excalidraw's own collaborator pointer resolves to.
   */
  tool?: "laser" | "pointer";
  /** Whether their pointer button is down, as of their last cursor update. Missing reads as up. */
  down?: boolean;
  /** The server's name for their connection, so its `gone` can be matched to them. */
  socket?: string;
  lastActive: number;
}

/** A peer, with what they hold and their gesture in progress — see `peerClaims.ts`. */
export interface Peer<T> extends PeerCursor, PeerState<T> {}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type RealtimeMessage<T extends StampedElement> =
  /**
   * `tool`/`down` are additive: an old peer's frame carries neither, and reads as
   * `"pointer"`/up — see `PeerCursor`. Sent only for the laser, so an ordinary cursor's
   * wire shape (and every existing test asserting it) is unchanged.
   */
  | {
      type: "cursor";
      clientId: string;
      name: string;
      color: string;
      x: number;
      y: number;
      tool?: "laser" | "pointer";
      down?: boolean;
    }
  | { type: "patch"; clientId: string; patch: ScenePatch<T> }
  /** `have`: what the newcomer has, so those already here can send what it lacks. */
  | {
      type: "join";
      clientId: string;
      name: string;
      color: string;
      socket?: string;
      have?: Inventory;
    }
  | { type: "leave"; clientId: string }
  /** What the sender holds: their selection, with when they took each element. */
  | {
      type: "presence";
      clientId: string;
      name: string;
      color: string;
      claims: Claims;
      socket?: string;
    }
  /**
   * The answer to a join, for the one who joined: what they lack, and what the sender
   * has, so the newcomer can send back what the sender lacks in turn.
   */
  | { type: "sync"; clientId: string; to: string; elements: T[]; have?: Inventory }
  /** Their gesture in progress: the elements it changes, as they are right now. */
  | { type: "preview"; clientId: string; elements: T[] }
  /** The gesture is over; its commit went out before this, as a patch. */
  | { type: "preview-end"; clientId: string }
  /**
   * Presenting, and on which slide: a frame's id, or `null` for the one slide of a
   * frame-less board. Sent on entering Present and again on every slide change — see
   * `presentation.ts`. Additive: an old peer's frame is simply never this type, the same
   * way it is simply never `preview`.
   */
  | { type: "present"; clientId: string; name: string; color: string; frameId: string | null }
  /** Left Present — pairs with `present` the way `preview-end` pairs with `preview`. */
  | { type: "present-end"; clientId: string };

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
const DEV_AUTH_TOKEN = "dev";

/**
 * Asking the realtime gateway whether the link still carries anything.
 *
 * A link can die without closing — a laptop lid shut, a network changed — and the socket
 * then reads as open for as long as TCP takes to notice, which can be many minutes.
 * Everything sent meanwhile went nowhere and everything others did never came, while the
 * page said it was connected. A ping unanswered for `LINK_TIMEOUT_MS` ends the socket and
 * a new one is opened, which sends and asks for everything missed. Any frame counts as
 * an answer; a server that has never answered one is not held to it.
 */
const LINK_CHECK_MS = 5_000;
const LINK_TIMEOUT_MS = 10_000;

/**
 * How much may sit unsent on the socket before cursors and previews are dropped rather
 * than queued. Both are superseded by the next one, and behind a slow link a queue of
 * them delayed the edits behind it — every patch waited for seconds of stale cursors.
 */
const VOLATILE_BUFFER_LIMIT = 256 * 1024;

/** What the page lends the channel to bring a newcomer up to date — see `liveBroadcast.ts`. */
export interface SceneSync<T> {
  /** What this client has. */
  inventory(): Inventory;
  /** What someone with `have` lacks, whole. */
  missing(have: Inventory): T[];
}

/**
 * Who this page is to the others in the room.
 *
 * The id is new for every page, never stored. It was kept in `sessionStorage`, which a
 * browser copies into a duplicated tab — and two tabs with one id each took the other's
 * frames for its own echo and dropped them, so neither ever saw the other's edits. A
 * page reloaded is a new id too; the server says when the old one's connection goes, so
 * nothing it held stays held (`gone`). The name is kept: it is the same person.
 */
export function getCollaboratorProfile(): { clientId: string; name: string; color: string } {
  if (typeof window === "undefined") {
    return { clientId: "ssr", name: "Guest", color: "#1971c2" };
  }
  const id = `user_${Math.random().toString(36).slice(2, 11)}`;
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
 * Live collab over engine/realtime: AUTH → SUBSCRIBE boards/{slug}/* → PUBLISH sealed
 * (or plaintext) collab payloads. Presence, sync, and holds stay host-side.
 */
export class RealtimeChannel<T extends StampedElement> {
  readonly profile = getCollaboratorProfile();
  private ws: WebSocket | null = null;
  private readonly peers = new Map<string, Peer<T>>();
  private listeners: ((peers: Peer<T>[]) => void)[] = [];
  private stateListeners: ((peers: Peer<T>[]) => void)[] = [];
  /** What this client holds, repeated on every join and heartbeat. */
  private claims: Claims = {};
  /** The slide this client is presenting, repeated with its presence; `undefined` when
   *  not presenting — `null` is the one slide of a frame-less board. */
  private presenting: string | null | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Frames go out in the order they were sent. Sealing is asynchronous, and two seals
   * in flight can finish in either order — a gesture's preview arriving after its end
   * would leave a shape frozen mid-move on everyone else's screen.
   */
  private outbound: Promise<void> = Promise.resolve();
  private patchListeners: ((patch: ScenePatch<T>) => void)[] = [];
  private statusListeners: ((status: ConnectionStatus) => void)[] = [];
  /** True once AUTH+SUBSCRIBE have completed for the current socket. */
  private sessionReady = false;
  private roomKey: RoomKey | null;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private peerSweepTimer: ReturnType<typeof setInterval> | null = null;
  private status: ConnectionStatus = "disconnected";
  private preferredUrl: string | undefined;
  private sync: SceneSync<T> | null = null;
  /** The server's name for this client's connection (`AUTH_OK.conn_id` or a relay welcome). */
  private socketId: string | undefined;
  private linkTimer: ReturnType<typeof setInterval> | null = null;
  /** When the ping in flight was sent, and when anything was last heard. */
  private pingSentAt = 0;
  private heardAt = 0;
  /** Whether this server answers pings at all: an older one does not. */
  private answersPings = false;
  /** Outbound frames queued until AUTH+SUBSCRIBE completes. */
  private pendingOutbound: RealtimeMessage<T>[] = [];

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

  /** How to bring someone who joins up to date, and to be brought up to date on joining. */
  setSceneSync(sync: SceneSync<T>): void {
    this.sync = sync;
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
    if (!this.linkTimer) {
      this.linkTimer = setInterval(() => this.checkLink(), LINK_CHECK_MS);
    }
  }

  private openSocket(): void {
    if (this.ws) return;
    const url = this.preferredUrl ?? this.defaultWsUrl();
    this.sessionReady = false;
    this.setStatus("connecting");
    try {
      const socket = new WebSocket(url);
      this.ws = socket;
      this.socketId = undefined;
      this.answersPings = false;
      this.pingSentAt = 0;
      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.reconnectAttempt = 0;
        this.heardAt = Date.now();
        socket.send(authFrame(env.PUBLIC_REALTIME_TOKEN || DEV_AUTH_TOKEN));
      };
      socket.onmessage = (event) => {
        if (this.ws !== socket) return;
        this.heardAt = Date.now();
        void this.onServerFrame(event.data as string);
      };
      // Events of a socket already given up on are ignored: a new one may be open by
      // the time the old one's close arrives, and must not be taken for closed.
      socket.onclose = () => {
        if (this.ws === socket) this.lost();
      };
      socket.onerror = () => {
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
    if (this.isPong(raw)) {
      this.answersPings = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (isAuthOk(parsed)) {
      const connId = (parsed as { conn_id?: unknown }).conn_id;
      if (typeof connId === "string") this.socketId = connId;
      this.ws?.send(subscribeFrame(this.slug));
      return;
    }
    if (isSubscribedLive(parsed)) {
      this.sessionReady = true;
      this.setStatus("connected");
      void this.flushPendingOutbound();
      const join: Extract<RealtimeMessage<T>, { type: "join" }> = {
        type: "join",
        clientId: this.profile.clientId,
        name: this.profile.name,
        color: this.profile.color,
      };
      if (this.sync) join.have = this.sync.inventory();
      void this.send(join);
      this.sendPresence();
      return;
    }

    // Relay/test control: `welcome` / `gone` about connections, never sealed.
    if (this.handleControl(parsed)) return;

    const payload = collabPayloadFromServerFrame(parsed);
    if (payload !== null) {
      await this.receivePayload(payload);
    }
  }

  /** The link is gone: forget who was here, say so, and try again. */
  private lost(): void {
    this.sessionReady = false;
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
  }

  /** Pings, and gives up on a link that has stopped answering — see `pingFrame`. */
  private checkLink(): void {
    const socket = this.ws;
    if (!socket || !this.sessionReady || socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const waiting = this.pingSentAt > this.heardAt;
    if (waiting && this.answersPings && now - this.pingSentAt >= LINK_TIMEOUT_MS) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Already closing: it is being replaced either way.
      }
      this.lost();
      return;
    }
    if (!waiting) {
      socket.send(pingFrame());
      this.pingSentAt = now;
    }
  }

  private isPong(raw: string): boolean {
    if (raw === '{"type":"pong"}') return true;
    try {
      const parsed = JSON.parse(raw) as { type?: unknown };
      return parsed.type === "PONG" || parsed.type === "pong";
    } catch {
      return false;
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

  /**
   * `tool`/`down` ride along only for the laser (`DrawSurface` passes them while it is
   * the active tool): an ordinary cursor's wire payload is exactly what it was before
   * either existed, which is what keeps this additive rather than a format bump.
   */
  sendCursor(x: number, y: number, tool: "laser" | "pointer" = "pointer", down = false): void {
    void this.send({
      type: "cursor",
      clientId: this.profile.clientId,
      name: this.profile.name,
      color: this.profile.color,
      x,
      y,
      ...(tool === "laser" ? { tool, down } : {}),
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
    const presence: Extract<RealtimeMessage<T>, { type: "presence" }> = {
      type: "presence",
      clientId: this.profile.clientId,
      name: this.profile.name,
      color: this.profile.color,
      claims: this.claims,
    };
    if (this.socketId) presence.socket = this.socketId;
    void this.send(presence);
    // Someone who joins mid-show would otherwise only learn of it at the next slide.
    if (this.presenting !== undefined) this.sendPresentFrame(this.presenting);
  }

  sendPreview(elements: T[]): void {
    void this.send({ type: "preview", clientId: this.profile.clientId, elements });
  }

  sendPreviewEnd(): void {
    void this.send({ type: "preview-end", clientId: this.profile.clientId });
  }

  /** Announces the slide now showing — the frame's id, or `null` for a frame-less
   *  board's one slide. Call again on every slide change; see `presentation.ts`. */
  sendPresent(frameId: string | null): void {
    this.presenting = frameId;
    this.sendPresentFrame(frameId);
  }

  private sendPresentFrame(frameId: string | null): void {
    void this.send({
      type: "present",
      clientId: this.profile.clientId,
      name: this.profile.name,
      color: this.profile.color,
      frameId,
    });
  }

  sendPresentEnd(): void {
    this.presenting = undefined;
    void this.send({ type: "present-end", clientId: this.profile.clientId });
  }

  private send(msg: RealtimeMessage<T>): Promise<void> {
    const socket = this.ws;
    if (!socket || !this.sessionReady || socket.readyState !== WebSocket.OPEN) {
      if (
        msg.type === "join" ||
        msg.type === "leave" ||
        msg.type === "cursor" ||
        msg.type === "presence"
      ) {
        this.pendingOutbound = this.pendingOutbound.filter((m) => m.type !== msg.type);
      }
      this.pendingOutbound.push(msg);
      if (this.pendingOutbound.length > 64) {
        this.pendingOutbound = this.pendingOutbound.slice(-48);
      }
      return Promise.resolve();
    }
    if (
      (msg.type === "cursor" || msg.type === "preview") &&
      socket.bufferedAmount > VOLATILE_BUFFER_LIMIT
    ) {
      return Promise.resolve();
    }
    // Sealed now, in parallel with whatever is ahead; written only after it.
    const sealed = this.encodeOutbound(msg);
    this.outbound = this.outbound.then(async () => {
      const wire = await sealed;
      if (wire === null) return;
      // The socket as it was before the await: sealing is asynchronous, and a drop in
      // between left `this.ws` null — a send racing a disconnect threw an unhandled error.
      if (socket.readyState !== WebSocket.OPEN || !this.sessionReady) return;
      let payload: unknown;
      try {
        payload = JSON.parse(wire);
      } catch {
        return;
      }
      socket.send(publishFrame(this.slug, msg.type, payload));
    });
    return this.outbound;
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
    if (this.isPong(raw)) {
      this.answersPings = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (this.handleControl(parsed)) return;
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

  /** `welcome` and `gone` — from a test relay, or mirrored when AUTH_OK names the socket. */
  private handleControl(parsed: unknown): boolean {
    if (typeof parsed !== "object" || parsed === null || "clientId" in parsed) return false;
    const { type, socket } = parsed as { type?: unknown; socket?: unknown };
    if (typeof socket !== "string") return false;
    if (type === "welcome") {
      this.socketId = socket;
      this.sendPresence();
      return true;
    }
    if (type === "gone") {
      let changed = false;
      for (const [id, peer] of this.peers) {
        if (peer.socket === socket) {
          this.peers.delete(id);
          changed = true;
        }
      }
      if (changed) {
        this.notifyPeers();
        this.notifyState();
      }
      return true;
    }
    return false;
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
        tool: msg.tool ?? "pointer",
        down: msg.down ?? false,
      });
      this.notifyPeers();
    } else if (msg.type === "join") {
      this.upsertPeer(msg.clientId, withSocket({ name: msg.name, color: msg.color }, msg.socket));
      this.notifyPeers();
      this.notifyState();
      // Existing members answer so the newcomer sees them without waiting for a cursor —
      // and sees what they hold, so it cannot take it. Every join, not only a stranger's:
      // someone back from a dropped connection is still known here, but no longer knows
      // anyone. Answered with presence, which is never answered, so it cannot echo.
      this.sendPresence();
      // And with what they lack, as Excalidraw sends its scene to whoever joins: the
      // server has only what has been saved, which is not yet everything on screen here.
      if (msg.have && this.sync) {
        void this.send({
          type: "sync",
          clientId: this.profile.clientId,
          to: msg.clientId,
          elements: this.sync.missing(msg.have),
          have: this.sync.inventory(),
        });
      }
    } else if (msg.type === "sync") {
      if (msg.to !== this.profile.clientId) return;
      if (Array.isArray(msg.elements) && msg.elements.length > 0) {
        const patch = { elements: msg.elements };
        this.patchListeners.forEach((fn) => fn(patch));
      }
      // What we have that they lack — whatever we did while our link was down, which
      // never reached them. A patch, never answered, so it cannot echo.
      if (msg.have && this.sync) {
        const lacking = this.sync.missing(msg.have);
        if (lacking.length > 0) this.sendPatch({ elements: lacking });
      }
    } else if (msg.type === "presence") {
      this.upsertPeer(
        msg.clientId,
        withSocket({ name: msg.name, color: msg.color, claims: msg.claims ?? {} }, msg.socket),
      );
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
    } else if (msg.type === "present") {
      if (msg.frameId !== null && typeof msg.frameId !== "string") return;
      this.upsertPeer(msg.clientId, { name: msg.name, color: msg.color, presenting: msg.frameId });
      this.notifyState();
    } else if (msg.type === "present-end") {
      const peer = this.peers.get(msg.clientId);
      if (peer?.presenting === undefined) return;
      delete peer.presenting;
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
    if (this.linkTimer) {
      clearInterval(this.linkTimer);
      this.linkTimer = null;
    }
    if (this.ws) {
      const socket = this.ws;
      const leave: RealtimeMessage<T> = { type: "leave", clientId: this.profile.clientId };
      // Seal is async; close only after the leave frame is queued so peers drop the cursor.
      void this.encodeOutbound(leave).then((wire) => {
        if (wire && socket.readyState === WebSocket.OPEN && this.sessionReady) {
          try {
            socket.send(publishFrame(this.slug, "leave", JSON.parse(wire)));
          } catch {
            // Closing anyway.
          }
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
    this.notifyPeers();
    this.notifyState();
    this.setStatus("disconnected");
  }
}

/** `update`, with the peer's connection when they said which it is. */
function withSocket<P extends object>(
  update: P,
  socket: string | undefined,
): P & { socket?: string } {
  return typeof socket === "string" ? { ...update, socket } : update;
}

export type { SealedEnvelope };
