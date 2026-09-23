import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { registerShareRoutes, shareInfoFor, tunnelOrigin } from "../../src/share.ts";

const base = { MONGO_URL: "mongodb://localhost:27017" } satisfies NodeJS.ProcessEnv;

/** A stand-in for cloudflared's metrics server. */
function tunnel(body: unknown, ok = true) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status: ok ? 200 : 503 });
  };
  return { fetcher, calls };
}

describe("the LAN origins make up passes in", () => {
  it("are read as origins, and anything that is not one is dropped", () => {
    const config = loadConfig({
      ...base,
      SHARE_LAN_ORIGINS:
        "http://10.12.19.1:5273, not a url ,javascript:alert(1),http://192.168.1.20:5273/",
    });
    expect(config.shareLanOrigins).toEqual(["http://10.12.19.1:5273", "http://192.168.1.20:5273"]);
    expect(loadConfig(base).shareLanOrigins).toEqual([]);
    expect(loadConfig(base).tunnelMetricsUrl).toBeNull();
  });
});

describe("what a request is told", () => {
  const lan = ["http://10.12.19.1:5273"];

  it("gives the LAN addresses to this computer and to the local network", () => {
    expect(shareInfoFor("localhost:5273", lan, null).lan).toEqual(lan);
    expect(shareInfoFor("10.12.19.1:5273", lan, null).lan).toEqual(lan);
  });

  it("keeps them from someone who arrived through the public tunnel", () => {
    // Someone on the internet has no use for the machine's private addresses.
    const told = shareInfoFor(
      "abc-def.trycloudflare.com",
      lan,
      "https://abc-def.trycloudflare.com",
    );
    expect(told).toEqual({ lan: [], public: "https://abc-def.trycloudflare.com" });
  });
});

describe("the tunnel's public address", () => {
  it("is the name cloudflared reports, over https", async () => {
    const { fetcher, calls } = tunnel({ hostname: "keen-lamp-rise.trycloudflare.com" });
    const origin = tunnelOrigin("http://tunnel:2000", fetcher);
    expect(await origin(0)).toBe("https://keen-lamp-rise.trycloudflare.com");
    expect(calls).toEqual(["http://tunnel:2000/quicktunnel"]);
  });

  it("is nothing without a tunnel, or with an answer that is not a host name", async () => {
    expect(await tunnelOrigin(null)(0)).toBeNull();
    const down = tunnelOrigin("http://tunnel:2000", async () => {
      throw new TypeError("getaddrinfo ENOTFOUND tunnel");
    });
    expect(await down(0)).toBeNull();
    expect(
      await tunnelOrigin("http://tunnel:2000", tunnel({ hostname: "" }).fetcher)(0),
    ).toBeNull();
    expect(
      await tunnelOrigin("http://tunnel:2000", tunnel({ hostname: "x.com/<script>" }).fetcher)(0),
    ).toBeNull();
    expect(await tunnelOrigin("http://tunnel:2000", tunnel({}, false).fetcher)(0)).toBeNull();
  });

  it("is asked again only after a few seconds", async () => {
    const { fetcher, calls } = tunnel({ hostname: "a.trycloudflare.com" });
    const origin = tunnelOrigin("http://tunnel:2000", fetcher);
    await origin(0);
    await origin(1_000);
    expect(calls).toHaveLength(1);
    await origin(6_000);
    expect(calls).toHaveLength(2);
  });
});

describe("GET /v1/share", () => {
  it("answers by the Host the browser used", async () => {
    const app = Fastify({ logger: false });
    registerShareRoutes(app, loadConfig({ ...base, SHARE_LAN_ORIGINS: "http://10.12.19.1:5273" }));

    const local = await app.inject({
      method: "GET",
      url: "/v1/share",
      headers: { host: "localhost:5273" },
    });
    expect(local.json()).toEqual({ lan: ["http://10.12.19.1:5273"], public: null });

    const remote = await app.inject({
      method: "GET",
      url: "/v1/share",
      headers: { host: "abc.trycloudflare.com" },
    });
    expect(remote.json()).toEqual({ lan: [], public: null });
    await app.close();
  });
});
