/**
 * What of `document.fonts` this needs, so a test can hand in a plain `EventTarget`.
 */
export interface FontEvents {
  addEventListener(type: "loadingdone", listener: () => void): void;
  removeEventListener(type: "loadingdone", listener: () => void): void;
  readonly ready: Promise<unknown>;
}

/**
 * Calls `loaded` each time web fonts finish loading, until the returned function is called.
 *
 * Text is measured the moment it is laid out, and a face declared in `fonts.css` only
 * starts loading once some text asks for it — so the first layout is in a fallback's
 * widths. Excalidraw listens the same way (`components/App.tsx@1118751f:4016`, and
 * `fonts.ready` for faces that finished before anyone listened); the engine's
 * `fontsLoaded` then re-lays the text in the real font without stamping it.
 */
export function watchFonts(fonts: FontEvents, loaded: () => void): () => void {
  let live = true;
  const onLoaded = (): void => {
    if (live) loaded();
  };
  fonts.addEventListener("loadingdone", onLoaded);
  void fonts.ready.then(onLoaded);
  return () => {
    live = false;
    fonts.removeEventListener("loadingdone", onLoaded);
  };
}
