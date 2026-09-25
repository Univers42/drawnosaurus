/**
 * Feeding peers' laser pointers into the engine, from their cursor updates.
 *
 * The engine already draws every peer's trail — started on down, grown while it stays
 * down, ended and left to fade on up — in that peer's colour, session state like the
 * local one: never the scene, its history, the autosave or undo (`engine/peers.rs`,
 * `DrawEngine.peerLaser`). What was missing is telling it: nothing called
 * `engine.peerLaser` from a cursor frame, so the trail a peer saw on their own screen
 * never reached anyone else's.
 *
 * `sync` is that call, run once per cursor update (`RealtimeChannel.onPeers`, which fires
 * at cursor rate — unlike `onPeerState`, which only fires on a meaningful change). It is
 * plain data in, plain calls out, so it is tested without an engine or a socket.
 */

/** As much of a peer's cursor as a trail update needs. */
export interface LaserCursor {
  clientId: string;
  color: string;
  x: number;
  y: number;
  /** Missing reads as `"pointer"` — see `PeerCursor.tool`. */
  tool?: "laser" | "pointer";
  /** Missing reads as up. */
  down?: boolean;
  /** Missing reads as never having pointed — see `PeerCursor.pointed`. */
  pointed?: boolean;
}

/** `engine.peerLaser(id, color, x, y, down)` — or anything that takes the same shape. */
export type EmitPeerLaser = (
  id: string,
  color: string,
  x: number,
  y: number,
  down: boolean,
) => void;

/**
 * Advances every peer's laser trail from `previous` (the last cursor list) to `next`
 * (this one), calling `emit` for each point that belongs in it.
 *
 * A peer pointing with the laser, held or not, is one call with their current position
 * and button state — `down: true` starts or extends their trail, `down: false` ends it,
 * exactly as their own screen would. A peer who *was* lasering and is gone from `next` —
 * left, or dropped (`gone`/`leave`, `sweepStalePeers`) — gets one final `down: false` at
 * their last known position, so their trail ends instead of hanging mid-air forever.
 *
 * Nothing is sent for a peer who never picked up the laser: `tool` other than `"laser"`
 * — including missing, an old peer's frame — is skipped outright, so an ordinary cursor
 * never touches the engine's peer-laser state.
 */
export function syncPeerLasers(
  previous: readonly LaserCursor[],
  next: readonly LaserCursor[],
  emit: EmitPeerLaser,
): void {
  const stillHere = new Set(next.map((peer) => peer.clientId));
  for (const peer of previous) {
    if (peer.tool === "laser" && peer.down && !stillHere.has(peer.clientId)) {
      emit(peer.clientId, peer.color, peer.x, peer.y, false);
    }
  }
  for (const peer of next) {
    if (peer.tool !== "laser" || !peer.pointed) continue;
    emit(peer.clientId, peer.color, peer.x, peer.y, Boolean(peer.down));
  }
}
