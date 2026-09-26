/**
 * The Mermaid fuzzer's randomness: seeded, so a failing case is its seed and nothing else.
 * mulberry32 — small, fast, and good enough to spread cases, which is all it is for.
 */

export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

export function seeded(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)]!,
    chance: (p) => next() < p,
  };
}

/** Words from several scripts, so a label exercises more than ASCII widths. */
const WORDS = [
  "start",
  "end",
  "retry",
  "payment",
  "user",
  "cache",
  "Überprüfung",
  "façade",
  "naïve",
  "données",
  "日本語",
  "検証",
  "데이터",
  "Ελλάδα",
  "Москва",
  "שלום",
  "مرحبا",
  "हिन्दी",
  "🚀",
  "✓ ok",
  "a&b",
  "x<y",
];

/** ASCII words, for the grammars that take nothing else unquoted. */
const PLAIN = [
  "start",
  "end",
  "retry",
  "payment",
  "user",
  "cache",
  "build",
  "deploy",
  "review",
  "ship",
];

/** A label from ASCII words only: one to three of them. */
export function plain(random: Random): string {
  return Array.from({ length: random.int(1, 3) }, () => random.pick(PLAIN)).join(" ");
}

/**
 * A label a person might write: one to three words, now and then long enough to wrap
 * or to overflow a box sized for a shorter one. Never a character Mermaid's grammar
 * reserves inside the quotes the generators put labels in.
 */
export function label(random: Random): string {
  if (random.chance(0.08)) {
    return Array.from({ length: random.int(8, 24) }, () => random.pick(WORDS)).join(" ");
  }
  return Array.from({ length: random.int(1, 3) }, () => random.pick(WORDS)).join(" ");
}

/**
 * `text` as a definition writes it. Mermaid reads a raw `<` as the start of a tag and drops
 * what follows; its entity code is how a person writes one (`#lt;`), and the converter
 * turns it back.
 */
export function written(text: string): string {
  return text.replace(/</g, "#lt;");
}

/** An identifier Mermaid accepts anywhere: a letter, then letters and digits. */
export function ident(prefix: string, index: number): string {
  return `${prefix}${index}`;
}
