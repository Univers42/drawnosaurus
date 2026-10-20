/** Which board's picture, and which version of it: its `thumbnailAt`. */
export interface CardPictureSource {
  slug: string;
  version: string;
}

/**
 * The gallery card's picture: an `<img>` action that asks the store for it and lets go of
 * every address it was given.
 *
 * In the public build the address is an object URL for a Blob read from IndexedDB, which
 * holds the Blob in memory until it is revoked — one per card per visit to the gallery, for
 * the life of the tab, unless each is released. So an address is released when a newer
 * picture replaces it, when the card goes, and as soon as it arrives if it is no longer
 * wanted: the card went, or a newer picture was asked for meanwhile. The Docker build's
 * address is a plain URL, which `URL.revokeObjectURL` ignores.
 *
 * No picture, or one that cannot be read, is reported the way an `<img>` reports one that
 * will not load — an `error` event — so the card falls back to its badge the one way it
 * already does.
 */
export function cardPicture(
  read: (slug: string, version: string) => Promise<string | null>,
  release: (url: string) => void = (url) => URL.revokeObjectURL(url),
) {
  return (node: HTMLImageElement, source: CardPictureSource) => {
    let wanted = source;
    let shown: string | null = null;
    let gone = false;

    const arrived = (asked: CardPictureSource, url: string | null): void => {
      const current = !gone && asked === wanted;
      if (url === null) {
        if (current) node.dispatchEvent(new Event("error"));
      } else if (!current) {
        release(url);
      } else {
        if (shown !== null) release(shown);
        shown = url;
        node.src = url;
      }
    };
    const load = (asked: CardPictureSource): void => {
      wanted = asked;
      void read(asked.slug, asked.version).then(
        (url) => arrived(asked, url),
        () => arrived(asked, null),
      );
    };

    load(source);
    return {
      update(next: CardPictureSource): void {
        if (next.slug !== wanted.slug || next.version !== wanted.version) load(next);
      },
      destroy(): void {
        gone = true;
        if (shown !== null) release(shown);
        shown = null;
      },
    };
  };
}
