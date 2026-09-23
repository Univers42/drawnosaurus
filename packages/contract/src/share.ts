import { z } from "zod";

/**
 * Where other people can reach this drawnosaurus, for the Share dialog.
 *
 * The page cannot work it out for itself: a board opened at `http://localhost:5273` has
 * no idea which address a colleague's computer would use to reach it, and a link with
 * `localhost` in it sends them to their own machine. The server is told — the LAN
 * addresses by whoever started it, the public one by the tunnel, when there is one.
 */
export const shareInfoSchema = z.object({
  /** Origins on the local network — LAN or wifi — such as `http://10.12.19.1:5273`. */
  lan: z.array(z.string().url()),
  /** The public origin through a tunnel, when one is running, or null. */
  public: z.string().url().nullable(),
});

export type ShareInfo = z.infer<typeof shareInfoSchema>;

/** A host name without its port or IPv6 brackets, lower-cased. */
function bareHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(1, trimmed.indexOf("]"));
  const colon = trimmed.lastIndexOf(":");
  // One colon is a port; more is an IPv6 address written without brackets.
  return colon > 0 && trimmed.indexOf(":") === colon ? trimmed.slice(0, colon) : trimmed;
}

/** Whether `host` (with or without a port) is this computer. */
export function isLoopbackHost(host: string): boolean {
  const name = bareHost(host);
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)
  );
}

/**
 * Whether `host` is this computer or an address on a private network — anything that
 * is not the public internet: RFC 1918 and link-local IPv4, unique-local and link-local
 * IPv6, and `.local` names.
 */
export function isPrivateHost(host: string): boolean {
  if (isLoopbackHost(host)) return true;
  const name = bareHost(host);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(name);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (name.includes(":")) return /^(fc|fd|fe8|fe9|fea|feb)/.test(name);
  return name.endsWith(".local");
}
