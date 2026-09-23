import { isAddressHost, isLoopbackHost, type ShareInfo } from "@drawnosaurus/contract";

/**
 * Which links the Share dialog offers, what it says about each, and copying one.
 *
 * The dialog used to offer the page's own address. Opened at `http://localhost:5273` —
 * where the board is used on the computer running it — that is a link to the
 * colleague's own machine, where nothing is listening. The server says which addresses
 * others can reach (`/v1/share`), best first; this turns them into links to this board,
 * with the room key in the fragment, where the server never sees it.
 */

export interface ShareLink {
  /** Who can open it. */
  kind: "network" | "internet" | "this-computer";
  /** For a network link: by the computer's name, or by its address. */
  via?: "name" | "address";
  url: string;
}

interface PageLocation {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * The links to this board that other people can open, the one to send first.
 *
 * `info` is what the server said, or null before it answered or when it could not.
 *
 * - A page already opened from another computer — a colleague's — offers first the
 *   address it was opened at: that one is known to work for them.
 * - Then the network links, in the server's order: the computer's name first, which
 *   works from the wired network and the Wi-Fi alike and survives a change of address,
 *   then its addresses.
 * - Then the internet link, while it is on: it works from anywhere, but goes through
 *   Cloudflare, so on the same network the network link is the better one to send.
 * - With nothing else, the page's own address, for what it is: this computer only.
 */
export function shareLinks(page: PageLocation, info: ShareInfo | null): ShareLink[] {
  const rest = `${page.pathname}${page.search}${page.hash}`;
  const links: ShareLink[] = [];
  const add = (kind: ShareLink["kind"], origin: string): void => {
    const base = origin.replace(/\/$/, "");
    const url = `${base}${rest}`;
    if (links.some((link) => link.url === url)) return;
    const link: ShareLink = { kind, url };
    if (kind === "network") link.via = isAddressHost(new URL(base).host) ? "address" : "name";
    links.push(link);
  };

  const here = new URL(page.origin);
  if (!isLoopbackHost(here.host)) {
    add(info?.public && sameOrigin(info.public, page.origin) ? "internet" : "network", page.origin);
  }
  for (const origin of info?.lan ?? []) add("network", origin);
  if (info?.public) add("internet", info.public);

  if (links.length === 0) add("this-computer", page.origin);
  return links;
}

const sameOrigin = (a: string, b: string): boolean => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/** What the dialog says about a link: who it is for, and when to use it. */
export function describeLink(link: ShareLink): { title: string; hint: string } {
  const host = new URL(link.url).host;
  switch (link.kind) {
    case "network":
      return link.via === "name"
        ? {
            title: "People on your network — wired or Wi-Fi",
            hint: `Uses this computer's name, ${host}, so it keeps working if its address changes.`,
          }
        : {
            title: "People on your network",
            hint: `By this computer's address, ${host}.`,
          };
    case "internet":
      return {
        title: "Anyone, anywhere",
        hint: "A public link: works on any network, phones on mobile data included.",
      };
    case "this-computer":
      return {
        title: "Only this computer",
        hint: "Nobody else can open this address. Restart with `make up` so your network address is known.",
      };
  }
}

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
