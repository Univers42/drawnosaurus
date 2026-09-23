/**
 * Who holds what, when more than one person reaches for the same element.
 *
 * Everyone announces what they have selected (`presence`), with when they took each
 * element. The engine refuses to let anyone take what someone else already holds, so a
 * conflict is only possible inside the time a message takes to cross the room: two
 * people clicking the same shape at the same moment. Both then see both claims, and this
 * is the rule both apply — the earlier claim wins, the smaller client id on a tie — so
 * both reach the same answer without asking anyone. The loser's engine lets go on its
 * own when it is told (`engine/peers.rs`).
 *
 * The times come from different clocks, so "earlier" is only as good as their
 * agreement. That decides who wins a true race and nothing else: agreement is what
 * matters, and every client computes the same winner from the same claims.
 */

/** Element id → when it was taken, in milliseconds since the epoch. */
export type Claims = Readonly<Record<string, number>>;

export interface Claimant {
  clientId: string;
  claims: Claims;
}

export interface PeerState<T> extends Claimant {
  name: string;
  color: string;
  /** Their gesture in progress, when they have one. */
  preview?: readonly T[];
}

/** What the engine is told about one peer: see `DrawPeer` in the engine. */
export interface ResolvedPeer<T> {
  id: string;
  name: string;
  color: string;
  holds: string[];
  preview: T[];
}

/** Whether `a`'s claim on an element beats `b`'s. */
export function outranks(
  a: { clientId: string; at: number },
  b: { clientId: string; at: number },
): boolean {
  return a.at < b.at || (a.at === b.at && a.clientId < b.clientId);
}

/**
 * What each peer holds, once every claim on every element has been settled against
 * every other — this client's own included.
 *
 * A peer keeps an element only if their claim beats everyone else's. Their preview keeps
 * only what nobody else won: when two people drag the same shape at once, the loser's
 * copy is not shown moving under the winner's hands while their engine lets go of it.
 */
export function resolvePeers<T extends { id: string }>(
  self: Claimant,
  peers: readonly PeerState<T>[],
): ResolvedPeer<T>[] {
  const winner = new Map<string, { clientId: string; at: number }>();
  for (const claimant of [self, ...peers]) {
    for (const [id, at] of Object.entries(claimant.claims)) {
      const claim = { clientId: claimant.clientId, at };
      const best = winner.get(id);
      if (!best || outranks(claim, best)) winner.set(id, claim);
    }
  }
  const mine = (clientId: string, id: string): boolean => {
    const best = winner.get(id);
    return !best || best.clientId === clientId;
  };
  return peers.map((peer) => ({
    id: peer.clientId,
    name: peer.name,
    color: peer.color,
    holds: Object.keys(peer.claims).filter((id) => mine(peer.clientId, id)),
    preview: (peer.preview ?? []).filter((element) => mine(peer.clientId, element.id)),
  }));
}

/**
 * The claims for a new selection: what stays selected keeps the time it was taken,
 * what is new is taken `now`.
 *
 * Kept rather than restamped, or adding one shape to a selection would make every shape
 * in it a fresh claim — and a fresh claim loses the race it had already won.
 */
export function claimSelection(previous: Claims, selected: readonly string[], now: number): Claims {
  const next: Record<string, number> = {};
  for (const id of selected) next[id] = previous[id] ?? now;
  return next;
}

/**
 * How long to wait between two previews of a gesture, from the size of the last one.
 *
 * A shape moved is a few hundred bytes and goes twenty times a second, which is smooth.
 * A long freehand stroke is tens of kilobytes; at that rate it would saturate a slow
 * link and arrive late, which is worse than arriving less often.
 */
export function previewInterval(bytes: number): number {
  if (bytes <= 16_000) return 50;
  if (bytes <= 64_000) return 120;
  if (bytes <= 256_000) return 300;
  return 600;
}
