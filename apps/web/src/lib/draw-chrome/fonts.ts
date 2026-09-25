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
