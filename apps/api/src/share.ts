import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ShareInfo, ShareRole } from "@drawnosaurus/contract";
import type { Config } from "./config.ts";
import { Tunnel } from "./tunnel.ts";

/**
 * `/v1/share`: where other people can reach this drawnosaurus, and the internet link.
 *
 * The page cannot know where it can be reached — a board opened at localhost has no
 * idea which address a colleague would use — so the Share dialog asks here:
 *
 * - the network links `make up` found on the host (scripts/lan.sh): the computer's DNS
 *   name when the network has one, then its addresses. Inside the container there are
 *   no addresses but the container's own, so it is told;
 * - the internet link, while the tunnel is on — started and stopped from the dialog by
 *   the person at this computer, and by nobody else.
 *
 * Who is asking comes from the gateway, which knows it from the address the connection
 * arrived on (docker/gateway/Caddyfile), in X-Drawnosaurus-Role. A request with none did
 * not come through the gateway: it came to the API's own port, which only this computer
 * can reach, or through `make dev`'s proxy.
 */

const ROLE_HEADER = "x-drawnosaurus-role";

export function roleOf(request: Pick<FastifyRequest, "headers">): ShareRole {
  const role = request.headers[ROLE_HEADER];
  return role === "guest" || role === "internet" ? role : "host";
}

/** What `role` is told. */
export function shareInfoFor(
  role: ShareRole,
  lanOrigins: readonly string[],
  tunnel: Tunnel,
): ShareInfo {
  const { state, origin, message } = tunnel.current;
  return {
    // Someone on the internet has no use for the machine's network addresses.
    lan: role === "internet" ? [] : [...lanOrigins],
    public: state === "on" ? origin : null,
    // Why it failed is for the person who can do something about it.
    tunnel: role === "host" && message ? { state, message } : { state },
    canManage: role === "host",
  };
}

export function registerShareRoutes(
  app: FastifyInstance,
  config: Config,
  tunnel = new Tunnel(config.tunnelTarget),
): void {
  const answer = (request: FastifyRequest): ShareInfo =>
    shareInfoFor(roleOf(request), config.shareLanOrigins, tunnel);

  const hostOnly = {
    error: {
      code: "host_only",
      message: "Only the computer running drawnosaurus can open or close the internet link.",
    },
  };

  app.get("/v1/share", async (request) => answer(request));

  app.post("/v1/share/tunnel", async (request, reply) => {
    if (roleOf(request) !== "host") return reply.status(403).send(hostOnly);
    tunnel.start();
    return reply.status(202).send(answer(request));
  });

  app.delete("/v1/share/tunnel", async (request, reply) => {
    if (roleOf(request) !== "host") return reply.status(403).send(hostOnly);
    tunnel.stop();
    return answer(request);
  });

  // The tunnel is a child process: it goes when the API does.
  app.addHook("onClose", async () => {
    tunnel.stop();
  });
}
