import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading `prompt/*.md` — the feature checklists this project is being built against.
 *
 * The documents are prose written by a person, not a schema, and they say the same thing
 * two different ways: `shortkey.md` is a Markdown checkbox list, and `design.md` is a
 * numbered architecture outline whose bullets lost their markers somewhere in a paste and
 * are now bare indented lines. Both are parsed here so that the matrix is checked against
 * what the documents actually say rather than against a transcription of them, which is
 * the thing that would quietly go stale.
 */

export interface ChecklistItem {
  /** The file it came from, e.g. `shortkey.md`. */
  source: string;
  /** The nearest heading above it — `⚡ Essential shortcuts`, `18. Binding system`. */
  section: string;
  /** The item's own text, with the checkbox marker and indentation removed. */
  text: string;
  /** 1-based, for pointing at it in an error. */
  line: number;
}

/** `- [ ] Foo` or `- [x] Foo`, at any indentation. */
const CHECKBOX = /^\s*-\s*\[[ xX]\]\s*(.+?)\s*$/;
/** `## Heading` or `### Heading`. */
const HEADING = /^#{2,4}\s+(.+?)\s*$/;
/** `18. Binding system` — design.md numbers its sections instead of heading them. */
const NUMBERED_SECTION = /^(\d+\.\s+\S.*?)\s*$/;
/** A bare indented bullet: design.md's checkboxes with their markers lost. */
const BARE_BULLET = /^ {1,3}(\S.*?)\s*$/;

/**
 * Lines that look like bullets but are not features.
 *
 * `design.md` interleaves ASCII diagrams and code sketches with its lists, and both are
 * indented. Treating a box-drawing character or a fragment of a type definition as a
 * feature would put unclassifiable noise in the matrix and teach everyone to ignore it.
 */
const NOT_A_FEATURE = [
  // Box drawing and code punctuation. Deliberately *not* a backtick: almost every entry
  // in the shortcut sheet opens with one — `` `V` — Selection tool `` — and excluding it
  // silently dropped the essential-shortcuts sections, which are the point of the file.
  // Fenced blocks are skipped separately, so there is nothing here for a backtick to do.
  /^[│├└┌┐┘─▼▲↓↑|+{}()[\]]/u,
  /^(type|const|export|import|function|return|interface)\b/,
  /^\w+[:?]\s/,
  /^\w+\s*=/,
  /^(G|GitHub|\+\d+)$/,
  /^\d+$/,
];

function isFeature(text: string): boolean {
  if (text.length < 3) return false;
  return !NOT_A_FEATURE.some((pattern) => pattern.test(text));
}

/** Every checklist item in one document. */
export function parseChecklist(source: string, markdown: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  let section = "(preamble)";
  let inFence = false;

  markdown.split("\n").forEach((raw, index) => {
    if (raw.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const heading = HEADING.exec(raw);
    if (heading?.[1]) {
      section = heading[1];
      return;
    }
    const numbered = NUMBERED_SECTION.exec(raw);
    if (numbered?.[1]) {
      section = numbered[1];
      return;
    }

    const checkbox = CHECKBOX.exec(raw);
    const text = checkbox?.[1] ?? (checkbox ? undefined : BARE_BULLET.exec(raw)?.[1]);
    if (!text || !isFeature(text)) return;

    // A wrapped continuation line — the documents wrap long items — belongs to the item
    // above rather than being one of its own.
    const previous = items[items.length - 1];
    if (!checkbox && previous && previous.line === index && previous.source === source) return;

    items.push({ source, section, text, line: index + 1 });
  });

  return items;
}

/** Every checklist item across `prompt/*.md`, or an empty list when the directory is absent. */
export function readChecklists(promptDir: string): ChecklistItem[] {
  let names: string[];
  try {
    names = readdirSync(promptDir)
      .filter((name) => name.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => parseChecklist(name, readFileSync(join(promptDir, name), "utf8")));
}
