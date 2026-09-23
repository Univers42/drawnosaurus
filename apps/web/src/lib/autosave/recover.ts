import type { StampedElement } from "./sceneDiff.ts";

/**
 * What the server used to strip on the way in, because its schema did not have them:
 * an embed's page, a frame's name, what frame an element is in — and, before that, an
 * image's picture. Every board saved then came back with videos as empty boxes.
 */
const ONCE_STRIPPED = ["embedUrl", "frameId", "name", "dataUrl"] as const;

type Loose = Record<string, unknown> & { id: string; version: number; versionNonce: number };

const missing = (value: unknown): boolean => value === undefined || value === null;

/**
 * The board from the server, with what it lost given back from this browser's own draft.
 *
 * Only where the two are the same edit — the same stamp — and the draft has a field the
 * server's copy lacks: then the server's copy is the draft's, stripped. Such an element
 * comes back re-stamped, so it is saved again and sent to whoever has the stripped one;
 * `repaired` names them.
 */
export function recoverStripped<T extends StampedElement>(
  server: readonly T[],
  draft: readonly object[] | null,
  now: number,
  nonce: () => number,
): { elements: T[]; repaired: T[] } {
  if (!draft || draft.length === 0) return { elements: [...server], repaired: [] };
  const drafted = new Map((draft as Loose[]).map((element) => [element.id, element]));
  const repaired: T[] = [];
  const elements = server.map((element) => {
    const mine = drafted.get(element.id);
    if (
      !mine ||
      element.isDeleted ||
      mine.version !== element.version ||
      mine.versionNonce !== element.versionNonce
    ) {
      return element;
    }
    const theirs = element as unknown as Loose;
    const lost = ONCE_STRIPPED.filter((key) => missing(theirs[key]) && !missing(mine[key]));
    if (lost.length === 0) return element;
    const whole: Loose = { ...theirs };
    for (const key of lost) whole[key] = mine[key];
    const restamped = {
      ...whole,
      version: element.version + 1,
      versionNonce: nonce(),
      updated: now,
    } as unknown as T;
    repaired.push(restamped);
    return restamped;
  });
  return { elements, repaired };
}
