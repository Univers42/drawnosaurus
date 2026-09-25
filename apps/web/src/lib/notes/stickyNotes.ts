import type { StampedElement } from "../autosave/sceneDiff.ts";

/**
 * Boards saved while a sticky note was four plain elements in one group — a shadow, the
 * pad, a date and a label — brought up to the note the engine draws natively: one
 * `stickynote` element and its label.
 *
 * Found by shape, never by id: a paste re-mints every id. The four pieces are only
 * recognised whole, so a group a user has since added to, or taken a piece out of, is
 * left as it is rather than guessed at.
 */

/** An element as the migration reads it: a stamp, and whatever else it carries. */
type Loose = StampedElement & Record<string, unknown>;

const view = (element: StampedElement): Loose => element as Loose;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The footer the old factory wrote: "24 Sep". A year is taken when there is one. */
const DATE_LABEL = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?: (\d{4}))?$/;
/** The ink a label is written in when the old one gives none worth keeping. */
const DEFAULT_INK = "#1e1e1e";
/** What a label's `fontSize` meant when it had none. */
const DEFAULT_FONT_SIZE = 20;

/**
 * The day a legacy footer names, as local noon of it — or null for a day no month has.
 *
 * The old footer had no year, and a legacy element's `updated` is not the wall clock, so
 * the year is inferred: the latest one that puts the day no later than `now`. A note is
 * never dated in the future, and one drawn last December reads as last December in the
 * first days of January.
 */
function createdFrom(label: unknown, now: number): number | null {
  const match = typeof label === "string" ? DATE_LABEL.exec(label) : null;
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS.indexOf(match[2] ?? "");
  const exists = (year: number): boolean => new Date(year, month, day).getDate() === day;
  const noon = (year: number): number => new Date(year, month, day, 12).getTime();
  if (match[3] !== undefined) {
    const year = Number(match[3]);
    return exists(year) ? noon(year) : null;
  }
  const thisYear = new Date(now).getFullYear();
  // Eight years back reaches the leap day across a century that has none.
  for (let year = thisYear; year > thisYear - 8; year -= 1) {
    if (exists(year) && new Date(year, month, day).getTime() <= now) return noon(year);
  }
  return null;
}

/** The innermost group an element is in, in either spelling. */
function innermostGroup(element: Loose): string | undefined {
  const { groupIds, groupId } = element;
  if (Array.isArray(groupIds)) return typeof groupIds[0] === "string" ? groupIds[0] : undefined;
  return typeof groupId === "string" && groupId !== "" ? groupId : undefined;
}

/** The element out of its innermost group, the key gone rather than left empty. */
function ungrouped(element: Loose): Loose {
  const next: Loose = { ...element };
  if (Array.isArray(element.groupIds)) {
    const rest: unknown[] = element.groupIds.slice(1);
    if (rest.length > 0) next.groupIds = rest;
    else delete next.groupIds;
  } else {
    delete next.groupId;
  }
  return next;
}

const isShadow = (element: Loose): boolean =>
  element.type === "rectangle" &&
  typeof element.backgroundColor === "string" &&
  element.backgroundColor.toLowerCase() === "#000000" &&
  element.strokeColor === "transparent" &&
  typeof element.opacity === "number" &&
  element.opacity < 100 &&
  !element.boundTextId;

const isBlank = (element: Loose): boolean =>
  (typeof element.text === "string" ? element.text : "").trim() === "" &&
  (typeof element.originalText === "string" ? element.originalText : "").trim() === "";

interface LegacyPieces {
  shadow: Loose;
  note: Loose;
  date: Loose;
  created: number;
  label: Loose | undefined;
}

/** The live members of one group as a legacy note's pieces, or null when they are not. */
function legacyPieces(members: readonly Loose[], now: number): LegacyPieces | null {
  if (members.length < 3 || members.length > 4) return null;
  const rectangles = members.filter((element) => element.type === "rectangle");
  const texts = members.filter((element) => element.type === "text");
  if (rectangles.length !== 2 || rectangles.length + texts.length !== members.length) return null;
  const shadows = rectangles.filter(isShadow);
  const shadow = shadows[0];
  const note = rectangles.find((element) => element !== shadow);
  if (shadows.length !== 1 || !shadow || !note || note.backgroundColor === "transparent") {
    return null;
  }
  const dates = texts.filter((element) => !element.containerId);
  const date = dates[0];
  const created = date ? createdFrom(date.text, now) : null;
  const labels = texts.filter((element) => element.containerId === note.id);
  if (dates.length !== 1 || !date || created === null) return null;
  if (labels.length + dates.length !== texts.length) return null;
  return { shadow, note, date, created, label: labels[0] };
}

/**
 * Every legacy note in `elements` made native, in place.
 *
 * `elements` keeps its order: the pad becomes the note where it stood, a label that says
 * something stays, bound to it, and the shadow, the date and an empty label are dropped.
 * `changed` are the note and the labels kept, and `removed` a tombstone for each piece
 * dropped — each one stamped edit, so saving them reaches the server and every peer.
 * Without a legacy note the very same objects come back, and nothing to save.
 */
export function migrateLegacyStickyGroups<T extends StampedElement>(
  elements: readonly T[],
  now: number,
  nonce: () => number,
): { elements: T[]; changed: T[]; removed: T[] } {
  // One cheap pass first: a group without a free text that reads as a date is none, and
  // most boards have no such text at all.
  const candidates = new Set<string>();
  for (const element of elements) {
    const loose = view(element);
    if (loose.isDeleted || loose.type !== "text" || loose.containerId) continue;
    const group = innermostGroup(loose);
    if (group !== undefined && typeof loose.text === "string" && DATE_LABEL.test(loose.text)) {
      candidates.add(group);
    }
  }
  if (candidates.size === 0) return { elements: [...elements], changed: [], removed: [] };

  const members = new Map<string, Loose[]>();
  for (const element of elements) {
    const loose = view(element);
    const group = loose.isDeleted ? undefined : innermostGroup(loose);
    if (group === undefined || !candidates.has(group)) continue;
    const list = members.get(group);
    if (list) list.push(loose);
    else members.set(group, [loose]);
  }

  /** By id: what an element becomes, or `null` for one dropped (its tombstone below). */
  const replaced = new Map<string, T | null>();
  const tombstones = new Map<string, T>();
  const stamp = (element: Loose): T =>
    ({ ...element, version: element.version + 1, versionNonce: nonce(), updated: now }) as T;
  const drop = (element: Loose): void => {
    replaced.set(element.id, null);
    tombstones.set(element.id, stamp({ ...element, isDeleted: true }));
  };

  /** A dropped shadow's id, to the note an arrow bound to it binds to instead. */
  const rebound = new Map<string, string>();
  for (const pieces of members.values()) {
    const found = legacyPieces(pieces, now);
    if (!found) continue;
    const { shadow, note, date, created, label } = found;
    rebound.set(shadow.id, note.id);
    const kept = label && !isBlank(label) ? label : undefined;
    const ink =
      typeof label?.strokeColor === "string" && label.strokeColor !== "transparent"
        ? label.strokeColor
        : DEFAULT_INK;
    const native = ungrouped(note);
    if (kept) native.boundTextId = kept.id;
    else delete native.boundTextId;
    replaced.set(
      note.id,
      stamp({
        ...native,
        type: "stickynote",
        fillStyle: "solid",
        // The legacy border was the pad's own colour; a native note's stroke is its ink —
        // the label's and the footer's.
        strokeColor: ink,
        baseHeight: note.height,
        created,
      }),
    );
    if (kept) {
      const fontSize = typeof kept.fontSize === "number" ? kept.fontSize : DEFAULT_FONT_SIZE;
      replaced.set(kept.id, stamp({ ...ungrouped(kept), baseFontSize: fontSize }));
    } else if (label) {
      drop(label);
    }
    drop(shadow);
    drop(date);
  }
  if (replaced.size === 0) return { elements: [...elements], changed: [], removed: [] };

  // An arrow bound to a shadow — one drawn before shadows were locked, or after one was
  // unlocked — binds to its note: the shadow was the note's, three units off it.
  for (const element of elements) {
    const loose = view(element);
    if (loose.isDeleted || replaced.has(loose.id)) continue;
    const start =
      typeof loose.startBinding === "string" ? rebound.get(loose.startBinding) : undefined;
    const end = typeof loose.endBinding === "string" ? rebound.get(loose.endBinding) : undefined;
    if (start === undefined && end === undefined) continue;
    replaced.set(
      loose.id,
      stamp({
        ...loose,
        ...(start === undefined ? {} : { startBinding: start }),
        ...(end === undefined ? {} : { endBinding: end }),
      }),
    );
  }

  const next: T[] = [];
  const changed: T[] = [];
  const removed: T[] = [];
  for (const element of elements) {
    const replacement = replaced.get(element.id);
    if (replacement === undefined) {
      next.push(element);
    } else if (replacement === null) {
      const tombstone = tombstones.get(element.id);
      if (tombstone) removed.push(tombstone);
    } else {
      next.push(replacement);
      changed.push(replacement);
    }
  }
  return { elements: next, changed, removed };
}

/**
 * An `.osidraw` document's text with its legacy notes made native — for a file opened or
 * a scene pasted — or null when it is no such document or has none, so the caller goes
 * on with the text it had. The pieces dropped are left out, not tombstoned: nothing that
 * reads the document has them yet.
 */
export function migrateLegacyStickyJson(
  json: string,
  now: number,
  nonce: () => number,
): string | null {
  let document: unknown;
  try {
    document = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof document !== "object" || document === null) return null;
  const { type, elements } = document as { type?: unknown; elements?: unknown };
  if (type !== "osidraw" || !Array.isArray(elements)) return null;
  if (!elements.every((element) => typeof element === "object" && element !== null)) return null;
  const migrated = migrateLegacyStickyGroups(elements as StampedElement[], now, nonce);
  if (migrated.changed.length === 0) return null;
  return JSON.stringify({ ...document, elements: migrated.elements });
}
