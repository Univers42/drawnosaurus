/** The families `fonts.css` serves: what the canvas draws text in. */
export const TEXT_FAMILIES: ReadonlySet<string> = new Set([
  "Virgil",
  "Excalifont",
  "Cascadia",
  "Nunito",
  "Lilita One",
  "Comic Shanns",
]);

/** What of a `FontFace` this reads. */
export interface LoadedFace {
  readonly family: string;
  readonly style: string;
  readonly weight: string;
  readonly unicodeRange: string;
}

/** What of a `FontFaceSetLoadEvent` this reads. */
interface FacesLoaded {
  readonly fontfaces: readonly LoadedFace[];
}

/**
 * What of `document.fonts` this needs, so a test can hand in a plain `EventTarget`.
 */
export interface FontEvents {
  addEventListener(type: "loadingdone", listener: (event: FacesLoaded) => void): void;
  removeEventListener(type: "loadingdone", listener: (event: FacesLoaded) => void): void;
}

/**
 * Calls `loaded` each time a face some text is drawn in finishes loading for the first
 * time, until the returned function is called.
 *
 * Text is measured the moment it is laid out, and a face declared in `fonts.css` only
 * starts loading once some text asks for it — so text laid out before then is in a
 * fallback's widths, and the engine's `fontsLoaded` re-lays it in the real face without
 * stamping it. Excalidraw listens the same way (`components/App.tsx@1118751f:4016`) and
 * bails when every face in the event was seen before (`Fonts.onLoaded`,
 * `fonts/Fonts.ts@1118751f:106-127`).
 *
 * Two departures, both because a relayout of every text costs far more than the cache
 * reset Excalidraw does there: faces of other families — the UI's Inter, loaded in shards
 * as the UI needs them — are ignored, and nothing is reported when watching starts.
 * `document.fonts.ready` would have been: it resolves before any face is asked for, and
 * reporting it re-laid every text in the fallback's widths, where a shape grown for them
 * stays grown.
 */
export function watchFonts(fonts: FontEvents, loaded: () => void): () => void {
  const seen = new Set<string>();
  const onLoaded = (event: FacesLoaded): void => {
    let fresh = false;
    for (const face of event.fontfaces) {
      // Chromium reports the family as it is declared, quotes and all.
      const family = face.family.replace(/^["']|["']$/g, "");
      const signature = `${family}-${face.style}-${face.weight}-${face.unicodeRange}`;
      if (TEXT_FAMILIES.has(family) && !seen.has(signature)) {
        seen.add(signature);
        fresh = true;
      }
    }
    if (fresh) loaded();
  };
  fonts.addEventListener("loadingdone", onLoaded);
  return () => fonts.removeEventListener("loadingdone", onLoaded);
}

/** The icons a family is shown with (`getFontFamilyIcon`, `FontPickerList.tsx@1118751f:76-94`). */
export type FontIcon = "freedraw" | "fontNormal" | "fontHeading" | "fontCode";

/** A family the picker offers. */
export interface FontChoice {
  /** Excalidraw's `FONT_FAMILY` id, what the engine's `setFontFamily` takes. */
  readonly id: number;
  /** Its `FONT_FAMILY` key, as the oracle labels it (`getFontFamilyLabel`, `:96-103`). */
  readonly label: string;
  readonly icon: FontIcon;
  /** Listed only when the board uses it, badged "old" (`font-metadata.ts@1118751f:68-95`). */
  readonly deprecated: boolean;
}

/**
 * The families the picker lists — the oracle's registered fonts less the private and
 * fallback ones (`FontPickerList.tsx@1118751f:126-155`), sorted by label. Liberation Sans
 * is private there too; Helvetica is the system's.
 */
export const FONT_CHOICES: readonly FontChoice[] = [
  { id: 3, label: "Cascadia", icon: "fontCode", deprecated: true },
  { id: 8, label: "Comic Shanns", icon: "fontCode", deprecated: false },
  { id: 5, label: "Excalifont", icon: "freedraw", deprecated: false },
  { id: 2, label: "Helvetica", icon: "fontNormal", deprecated: true },
  { id: 7, label: "Lilita One", icon: "fontHeading", deprecated: false },
  { id: 6, label: "Nunito", icon: "fontNormal", deprecated: false },
  { id: 1, label: "Virgil", icon: "freedraw", deprecated: true },
];

/** The three quick picks beside the list's trigger (`DEFAULT_FONTS`, `FontPicker.tsx@1118751f:42-61`). */
export const QUICK_FONTS: ReadonlyArray<{ id: number; label: string; icon: FontIcon }> = [
  { id: 5, label: "Hand-drawn", icon: "freedraw" },
  { id: 6, label: "Normal", icon: "fontNormal" },
  { id: 8, label: "Code", icon: "fontCode" },
];

/** A family's name, for a title: the system stack a text with no family is drawn in is 0. */
export function fontLabel(id: number | null): string {
  if (id === null) return "mixed";
  if (id === 0) return "System";
  return FONT_CHOICES.find((font) => font.id === id)?.label ?? "Unknown";
}

/**
 * The list as the picker shows it (`FontPickerList.tsx@1118751f:157-187`, `:283-291`):
 * the families the board uses first — deprecated ones too — then every other one that is
 * not deprecated, each group in label order, both narrowed to the labels containing the
 * search term, whatever its case.
 */
export function fontGroups(
  sceneFamilies: readonly number[],
  search: string,
): { inScene: FontChoice[]; available: FontChoice[] } {
  const term = search.trim().toLowerCase();
  const shown = FONT_CHOICES.filter((font) => font.label.toLowerCase().includes(term));
  return {
    inScene: shown.filter((font) => sceneFamilies.includes(font.id)),
    available: shown.filter((font) => !sceneFamilies.includes(font.id) && !font.deprecated),
  };
}

/** What a key does in the open picker. `null` leaves it to whoever is next. */
export type FontPickerKey =
  | { kind: "focusSearch" }
  | { kind: "close" }
  | { kind: "select"; id: number }
  | { kind: "hover"; id: number }
  /** Taken, and nothing to do: Enter with nothing hovered. */
  | { kind: "none" };

/**
 * `fontPickerKeyHandler` (`keyboardNavHandlers.ts@1118751f:17-68`): Shift+F back to the
 * search, Escape closes, Enter picks the hovered family, and the arrows walk the list —
 * round from either end, as its `arrayToList` links head and tail — starting from the
 * first or last when nothing listed is hovered.
 */
export function fontPickerKey(
  event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  hovered: number | null,
  listed: readonly number[],
): FontPickerKey | null {
  if (!event.ctrlKey && !event.metaKey && event.shiftKey && event.key.toLowerCase() === "f") {
    return { kind: "focusSearch" };
  }
  if (event.key === "Escape") return { kind: "close" };
  if (event.key === "Enter")
    return hovered === null ? { kind: "none" } : { kind: "select", id: hovered };
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return null;
  if (listed.length === 0) return { kind: "none" };
  const at = hovered === null ? -1 : listed.indexOf(hovered);
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next =
    at < 0 ? (step > 0 ? 0 : listed.length - 1) : (at + step + listed.length) % listed.length;
  const id = listed[next];
  return id === undefined ? { kind: "none" } : { kind: "hover", id };
}

/** What of `document.fonts` loading a face needs. */
export interface FontLoader {
  load(font: string): Promise<unknown>;
}

/**
 * Loads the face a family is drawn in, before the engine lays text out in it — as the
 * oracle's `changeFontFamily` waits for `document.fonts.load` (`actionProperties.tsx@1118751f:1302-1356`).
 * Laid out in a fallback wider than the face, a shape grows and keeps the growth. A face
 * that fails to load is no reason not to change the family: the engine then measures in
 * the fallback, and `watchFonts` re-lays it if the face arrives later.
 *
 * ponytail: loads the shard the default sample text needs (Latin); a text in another
 * script is re-laid by `watchFonts` when its shard arrives. Loading by the texts' own
 * characters, as the oracle does, is the upgrade.
 */
export async function loadFontFamily(fonts: FontLoader, stack: string): Promise<void> {
  try {
    await fonts.load(`10px ${stack}`);
  } catch {
    // Measured in the fallback until the face arrives; see above.
  }
}

/**
 * A size typed into the panel's field, or `null` for one that is not a number — an empty
 * field included, which `Number` would read as 0 — so the size stays as it was. The
 * engine keeps a size within what the contract stores (1 to 1000).
 */
export function readFontSize(text: string): number | null {
  const size = text.trim() === "" ? Number.NaN : Number(text);
  return Number.isFinite(size) ? size : null;
}
