import { isLoopbackHost, isPrivateHost, type ShareInfo } from "@drawnosaurus/contract";

/**
 * Which links the Share dialog offers, and copying one.
 *
 * The dialog used to offer the page's own address. Opened at `http://localhost:5273` —
 * where the board is used on the computer running it — that is a link to the
 * colleague's own machine, where nothing is listening. The server says which addresses
 * others can reach (see `/v1/share`); this turns them into links to this board, with
 * the room key in the fragment, where the server never sees it.
 */

export interface ShareLink {
  /** Who the link is for. */
  kind: "network" | "internet" | "this-computer";
  url: string;
}

interface PageLocation {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * The links to this board that other people can open, most local first.
 *
 * `info` is what the server said, or null before it answered or when it could not. A
 * page already opened at an address others can use — a colleague's, on the network or
 * through the tunnel — offers that address too. When there is nothing else, the page's
 * own address is offered for what it is: good on this computer only.
 */
export function shareLinks(page: PageLocation, info: ShareInfo | null): ShareLink[] {
  const rest = `${page.pathname}${page.search}${page.hash}`;
  const links: ShareLink[] = [];
  const add = (kind: ShareLink["kind"], origin: string): void => {
    const url = `${origin.replace(/\/$/, "")}${rest}`;
    if (!links.some((link) => link.url === url)) links.push({ kind, url });
  };

  const host = new URL(page.origin).host;
  if (!isLoopbackHost(host)) add(isPrivateHost(host) ? "network" : "internet", page.origin);
  for (const origin of info?.lan ?? []) add("network", origin);
  if (info?.public) add("internet", info.public);

  links.sort((a, b) => rank(a.kind) - rank(b.kind));
  if (links.length === 0) add("this-computer", page.origin);
  return links;
}

const rank = (kind: ShareLink["kind"]): number =>
  kind === "network" ? 0 : kind === "internet" ? 1 : 2;

/**
 * Puts `text` on the clipboard, and says whether it got there.
 *
 * `navigator.clipboard` exists only in a secure context — https or localhost — so the
 * copy button did nothing at all for a colleague on `http://10.x.x.x`. There, a selected
 * text field and `execCommand("copy")`, which every browser still honours on a click.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window !== "undefined" && window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused — a permission, an unfocused page. The old way may still work.
    }
  }
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  field.remove();
  return copied;
}
