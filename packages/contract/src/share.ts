import { z } from "zod";

/**
 * Where other people can reach this drawnosaurus, for the Share dialog.
 *
 * The page cannot work it out for itself: a board opened at `http://localhost:5273` has
 * no idea which address a colleague's computer would use to reach it, and a link with
 * `localhost` in it sends them to their own machine. The server is told — the network
 * links by `make up`, the internet one by the tunnel, when it is on.
 */

/** Who is asking: this computer, someone on the network, someone on the internet. */
export const shareRoleSchema = z.enum(["host", "guest", "internet"]);
export type ShareRole = z.infer<typeof shareRoleSchema>;

export const tunnelStateSchema = z.enum(["off", "starting", "on", "failed", "unavailable"]);
export type TunnelState = z.infer<typeof tunnelStateSchema>;

export const shareInfoSchema = z.object({
  /**
   * Origins on the local network, best first: the computer's DNS name when the network
   * has one — `http://c2r19s1.42madrid.com:5273`, which works from the wired network and
   * the Wi-Fi alike — then its addresses.
   */
  lan: z.array(z.string().url()),
  /** The public origin through the tunnel, while it is on, or null. */
  public: z.string().url().nullable(),
  /** The internet link: off, starting, on, failed (with why), or not offered here. */
  tunnel: z.object({ state: tunnelStateSchema, message: z.string().optional() }),
  /** Whether the asker may open and close the internet link: this computer only. */
  canManage: z.boolean(),
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

/** Whether `host` is a bare address rather than a name. */
export function isAddressHost(host: string): boolean {
  const name = bareHost(host);
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(":");
}
