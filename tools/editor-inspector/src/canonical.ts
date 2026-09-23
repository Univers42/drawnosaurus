/**
 * Canonical scene form, for comparing two editors.
 *
 * Raw scenes never compare equal, and almost none of the reasons are interesting: ids are
 * random, seeds are random, stamps are wall-clock, floats carry noise from a different
 * rounding path. Diffing them directly produces a wall of differences with the real one
 * buried in it, which is the same as producing nothing.
 *
 * So: strip what cannot meaningfully match, round what only differs by noise, and map
 * what is random-but-structural onto something stable.
 *
 * The group-id mapping is the load-bearing part. Group ids are minted per session, so two
 * scenes with *identical* group structure share no group id at all. Mapping them to
 * indices in first-appearance order turns "random strings that happen to be equal in the
 * right places" into something a diff can actually compare — and nested groups are
 * exactly a statement about which ids appear together, so without it a nested-group
 * comparison cannot be done.
 */

/** Fields that are identity or bookkeeping, never geometry or appearance. */
const DROPPED = new Set([
  "id",
  // Random per element; drives the hand-drawn jitter. Two scenes drawn the same way have
  // different seeds and identical semantics.
  "seed",
  "version",
  "versionNonce",
  "updated",
  // Handled separately: tombstones are removed rather than compared.
  "isDeleted",
  // Positional bookkeeping that the array order already carries.
  "index",
]);

/** Fields holding an id that must be mapped rather than dropped. */
const ID_REFERENCES = ["containerId", "boundTextId", "frameId"] as const;

export interface CanonicalOptions {
  /** Decimal places for coordinates. Three is well under a pixel at any sane zoom. */
  precision?: number;
}

type Json = Record<string, unknown>;

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  // `+ 0` so `-0` and `0` compare equal; they are the same position and a sign flip on
  // zero is the sort of difference that looks alarming and means nothing.
  return Math.round(value * factor) / factor + 0;
}

/**
 * Maps random ids to stable, first-appearance-ordered names.
 *
 * Order of first appearance rather than sorted, because sorting random strings is not
 * stable across runs either — it would just be a different arbitrary order.
 */
class IdMap {
  private readonly seen = new Map<string, string>();
  // An explicit field rather than a constructor parameter property: this file runs under
  // Node's type stripping, which erases types but cannot emit the assignment a parameter
  // property implies. Same constraint `apps/api` runs under.
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  to(id: string): string {
    const existing = this.seen.get(id);
    if (existing) return existing;
    const name = `${this.prefix}${this.seen.size}`;
    this.seen.set(id, name);
    return name;
  }
}

function canonicalValue(value: unknown, places: number): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? roundTo(value, places) : value;
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, places));
  if (value && typeof value === "object") {
    const out: Json = {};
    for (const [key, inner] of Object.entries(value as Json)) {
      out[key] = canonicalValue(inner, places);
    }
    return out;
  }
  return value;
}

/**
 * One element, stripped and normalized.
 *
 * `groupIds` is read in both spellings on purpose. The engine is moving from a single
 * `groupId` to an ordered `groupIds` array, and a comparison tool that only understood
 * one of them would stop working exactly during the change it is most needed for.
 */
function canonicalElement(element: Json, groups: IdMap, elements: IdMap, places: number): Json {
  const out: Json = {};

  const rawGroups = Array.isArray(element.groupIds)
    ? (element.groupIds as string[])
    : typeof element.groupId === "string"
      ? [element.groupId]
      : [];
  if (rawGroups.length > 0) {
    // Order is preserved: for nested groups it is innermost → outermost, and that order
    // *is* the nesting. Sorting here would erase the thing being compared.
    out.groupIds = rawGroups.map((id) => groups.to(id));
  }

  for (const [key, value] of Object.entries(element)) {
    if (DROPPED.has(key) || key === "groupId" || key === "groupIds") continue;
    if ((ID_REFERENCES as readonly string[]).includes(key)) {
      out[key] = typeof value === "string" ? elements.to(value) : value;
      continue;
    }
    if (value === undefined) continue;
    out[key] = canonicalValue(value, places);
  }
  return out;
}

/**
 * A scene reduced to what two implementations can meaningfully be asked to agree on.
 *
 * Tombstones are dropped rather than compared: a deleted element is an absence to a user,
 * and whether it is represented as a tombstone or a removal is a synchronisation
 * strategy, not behaviour.
 *
 * Array order is **kept** — it is z-order, which is observable — so a reordering shows up
 * as a difference rather than being sorted away.
 */
export function canonicalScene(elements: readonly Json[], options: CanonicalOptions = {}): Json[] {
  const places = options.precision ?? 3;
  const groups = new IdMap("g");
  const ids = new IdMap("e");
  const live = elements.filter((element) => element.isDeleted !== true);
  // Ids are assigned in z-order first, so a reference to an element reads as the index of
  // something already named rather than as a forward reference.
  for (const element of live) {
    if (typeof element.id === "string") ids.to(element.id);
  }
  return live.map((element) => canonicalElement(element, groups, ids, places));
}

export interface SceneDiff {
  equal: boolean;
  /** Human-readable, one line per difference, most structural first. */
  differences: string[];
}

/**
 * Compares two canonical scenes and says where they differ.
 *
 * Reports the **first** structural difference prominently: a count mismatch makes every
 * later positional comparison meaningless, and a list of forty differences caused by one
 * missing element is forty pieces of noise.
 */
export function diffScenes(ours: readonly Json[], reference: readonly Json[]): SceneDiff {
  const differences: string[] = [];

  if (ours.length !== reference.length) {
    differences.push(
      `element count: ours ${ours.length}, reference ${reference.length} — ` +
        `every positional comparison below is unreliable until this matches`,
    );
  }

  const shared = Math.min(ours.length, reference.length);
  for (let i = 0; i < shared; i += 1) {
    const a = ours[i]!;
    const b = reference[i]!;
    if (a.type !== b.type) {
      differences.push(`[${i}] type: ours ${String(a.type)}, reference ${String(b.type)}`);
      continue;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      const left = JSON.stringify(a[key]);
      const right = JSON.stringify(b[key]);
      if (left !== right) {
        differences.push(`[${i}] ${String(a.type)}.${key}: ours ${left}, reference ${right}`);
      }
    }
  }

  return { equal: differences.length === 0, differences };
}
