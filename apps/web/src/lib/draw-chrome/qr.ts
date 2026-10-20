import { renderSVG } from "uqr";

/**
 * The QR code of a link, as the data URL an `<img>` shows.
 *
 * The SVG, not a bitmap: it is a few kilobytes for a link, and it stays sharp on a
 * phone's screen — which is where a QR code is read, from another device.
 *
 * The link goes in as it is: it carries the drawing's secret in its fragment, and the
 * fragment is never sent to a server, so the code carries the secret and the code is
 * useless to anyone who does not open it.
 */
export const qrSource = (link: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(link, { pixelSize: 4, border: 2 }))}`;
