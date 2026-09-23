import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { registerShareRoutes, roleOf, shareInfoFor } from "../../src/share.ts";
import { Tunnel, type TunnelProcess } from "../../src/tunnel.ts";

const base = { MONGO_URL: "mongodb://localhost:27017" } satisfies NodeJS.ProcessEnv;
const LAN = ["http://c2r19s1.42madrid.com:5273", "http://10.12.19.1:5273"];

/** A stand-in for cloudflared: what it writes is what the test says. */
function fakeCloudflared() {
  const spawned: { args: string[]; process: FakeProcess }[] = [];
  const spawn = (args: string[]): TunnelProcess => {
    const process = new FakeProcess();
    spawned.push({ args, process });
    return process;
  };
  return { spawn, spawned };
}

class FakeProcess extends EventEmitter implements TunnelProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push(signal);
    return true;
  }
  /** A line of cloudflared's log, as it writes it: on stderr. */
  log(line: string): void {
    this.stderr.write(`${line}\n`);
  }
}

// cloudflared's own lines, as it prints them.
const NAME_LINES = [
  "2026-09-23T18:40:01Z INF Requesting new quick Tunnel on trycloudflare.com...",
  "2026-09-23T18:40:03Z INF +--------------------------------------------------------------------------------------------+",
  "2026-09-23T18:40:03Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
  "2026-09-23T18:40:03Z INF |  https://proper-ensure-suse-moss.trycloudflare.com                                         |",
];
const CONNECTED_LINE =
  "2026-09-23T18:40:04Z INF Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.200.13 location=mad01 protocol=http2";

const flush = () => new Promise((done) => setTimeout(done, 5));

/** DNS that has the name — or says so only from the `after`th question on. */
function dns(after = 1) {
  const asked: string[] = [];
  const isPublished = async (hostname: string) => {
    asked.push(hostname);
    return asked.length >= after;
  };
  return { isPublished, asked };
}

/** A tunnel with a fake cloudflared, and DNS that publishes the name at once. */
function tunnelWith(cloudflared: ReturnType<typeof fakeCloudflared>, over: object = {}) {
  return new Tunnel("http://gateway:82", {
    spawn: cloudflared.spawn,
    isPublished: dns().isPublished,
    pollMs: 1,
    ...over,
  });
}

describe("the network links make up passes in", () => {
  it("are read as origins, best first, and anything that is not one is dropped", () => {
    const config = loadConfig({
      ...base,
      SHARE_LAN_ORIGINS:
        "http://c2r19s1.42madrid.com:5273, not a url ,javascript:alert(1),http://10.12.19.1:5273/",
    });
    expect(config.shareLanOrigins).toEqual(LAN);
    expect(loadConfig(base).shareLanOrigins).toEqual([]);
    expect(loadConfig(base).tunnelTarget).toBeNull();
  });
});

describe("who is asking", () => {
  it("is what the gateway said, and this computer when it said nothing", () => {
    expect(roleOf({ headers: { "x-drawnosaurus-role": "guest" } })).toBe("guest");
    expect(roleOf({ headers: { "x-drawnosaurus-role": "internet" } })).toBe("internet");
    // No gateway: the API's own port, which only this computer reaches.
    expect(roleOf({ headers: {} })).toBe("host");
    expect(roleOf({ headers: { "x-drawnosaurus-role": "admin" } })).toBe("host");
  });
});

describe("what each is told", () => {
  const tunnel = new Tunnel(null);

  it("gives the network links to this computer and to the network", () => {
    expect(shareInfoFor("host", LAN, tunnel).lan).toEqual(LAN);
    expect(shareInfoFor("guest", LAN, tunnel).lan).toEqual(LAN);
  });

  it("keeps them from someone who arrived through the internet link", () => {
    expect(shareInfoFor("internet", LAN, tunnel).lan).toEqual([]);
  });

  it("lets only this computer open or close the internet link", () => {
    expect(shareInfoFor("host", LAN, tunnel).canManage).toBe(true);
    expect(shareInfoFor("guest", LAN, tunnel).canManage).toBe(false);
    expect(shareInfoFor("internet", LAN, tunnel).canManage).toBe(false);
  });
});

describe("the internet link", () => {
  it("is offered only once the tunnel is connected, at the name cloudflared gave", async () => {
    const cloudflared = fakeCloudflared();
    const tunnel = tunnelWith(cloudflared);

    expect(tunnel.start().state).toBe("starting");
    const [{ args, process }] = cloudflared.spawned as [{ args: string[]; process: FakeProcess }];
    expect(args).toEqual([
      "tunnel",
      "--no-autoupdate",
      "--protocol",
      "http2",
      "--url",
      "http://gateway:82",
    ]);

    for (const line of NAME_LINES) process.log(line);
    await flush();
    // Named but not connected: the name does not answer yet.
    expect(tunnel.current).toEqual({ state: "starting", origin: null });

    process.log(CONNECTED_LINE);
    await flush();
    expect(tunnel.current).toEqual({
      state: "on",
      origin: "https://proper-ensure-suse-moss.trycloudflare.com",
    });
  });

  it("waits for the name to be published before offering it", async () => {
    // A browser that asks DNS before the name exists is told it does not — and may be
    // told so again, from cache, for half an hour.
    const cloudflared = fakeCloudflared();
    const published = dns(3);
    const tunnel = tunnelWith(cloudflared, { isPublished: published.isPublished });
    tunnel.start();
    const { process } = cloudflared.spawned[0]!;
    for (const line of [...NAME_LINES, CONNECTED_LINE]) process.log(line);
    await flush();
    expect(published.asked[0]).toBe("proper-ensure-suse-moss.trycloudflare.com");
    await new Promise((done) => setTimeout(done, 30));
    expect(published.asked.length).toBeGreaterThanOrEqual(3);
    expect(tunnel.current.state).toBe("on");
  });

  it("finds the name when the log arrives in pieces", async () => {
    const cloudflared = fakeCloudflared();
    const tunnel = tunnelWith(cloudflared);
    tunnel.start();
    const { process } = cloudflared.spawned[0]!;
    process.stderr.write("INF |  https://proper-ensure-su");
    process.stderr.write("se-moss.trycloudflare.com   |\n");
    process.log(CONNECTED_LINE);
    await flush();
    expect(tunnel.current.origin).toBe("https://proper-ensure-suse-moss.trycloudflare.com");
  });

  it("is started once, however many times the button is pressed", () => {
    const cloudflared = fakeCloudflared();
    const tunnel = tunnelWith(cloudflared);
    tunnel.start();
    tunnel.start();
    expect(cloudflared.spawned).toHaveLength(1);
  });

  it("closes, and the process with it", async () => {
    const cloudflared = fakeCloudflared();
    const tunnel = tunnelWith(cloudflared);
    tunnel.start();
    const { process } = cloudflared.spawned[0]!;
    for (const line of [...NAME_LINES, CONNECTED_LINE]) process.log(line);
    await flush();

    expect(tunnel.stop()).toEqual({ state: "off", origin: null });
    expect(process.killed).toEqual(["SIGTERM"]);
    // Its exit, after the stop, changes nothing.
    process.emit("exit", 0);
    expect(tunnel.current.state).toBe("off");
  });

  it("says why when it cannot come up, and can be tried again", async () => {
    const cloudflared = fakeCloudflared();
    const tunnel = tunnelWith(cloudflared);
    tunnel.start();
    cloudflared.spawned[0]!.process.emit("exit", 1);
    expect(tunnel.current.state).toBe("failed");
    expect(tunnel.current.message).toMatch(/Cloudflare/);

    expect(tunnel.start().state).toBe("starting");
    expect(cloudflared.spawned).toHaveLength(2);
  });

  it("gives up on a tunnel that never connects", async () => {
    const cloudflared = fakeCloudflared();
    const tunnel = tunnelWith(cloudflared, { startTimeoutMs: 20 });
    tunnel.start();
    await new Promise((done) => setTimeout(done, 40));
    expect(tunnel.current.state).toBe("failed");
    expect(cloudflared.spawned[0]!.process.killed).toEqual(["SIGTERM"]);
  });

  it("is not offered where there is no tunnel to start", () => {
    const tunnel = new Tunnel(null);
    expect(tunnel.start().state).toBe("unavailable");
    expect(tunnel.stop().state).toBe("unavailable");
  });

  it("reports a binary that is not there", () => {
    const tunnel = new Tunnel("http://gateway:82", {
      spawn: () => {
        throw new Error("spawn cloudflared ENOENT");
      },
    });
    expect(tunnel.start()).toMatchObject({ state: "failed", message: /ENOENT/ });
  });
});

describe("the routes", () => {
  async function app() {
    const cloudflared = fakeCloudflared();
    const server = Fastify({ logger: false });
    registerShareRoutes(
      server,
      loadConfig({ ...base, SHARE_LAN_ORIGINS: LAN.join(",") }),
      tunnelWith(cloudflared),
    );
    return { server, cloudflared };
  }

  it("open and close the internet link for this computer", async () => {
    const { server, cloudflared } = await app();
    const opened = await server.inject({ method: "POST", url: "/v1/share/tunnel" });
    expect(opened.statusCode).toBe(202);
    expect(opened.json()).toMatchObject({ tunnel: { state: "starting" }, canManage: true });

    const { process } = cloudflared.spawned[0]!;
    for (const line of [...NAME_LINES, CONNECTED_LINE]) process.log(line);
    await flush();
    const shown = await server.inject({ method: "GET", url: "/v1/share" });
    expect(shown.json()).toEqual({
      lan: LAN,
      public: "https://proper-ensure-suse-moss.trycloudflare.com",
      tunnel: { state: "on" },
      canManage: true,
    });

    const closed = await server.inject({ method: "DELETE", url: "/v1/share/tunnel" });
    expect(closed.json()).toMatchObject({ public: null, tunnel: { state: "off" } });
    await server.close();
  });

  it("refuse anyone else, whatever they claim to be", async () => {
    const { server, cloudflared } = await app();
    for (const role of ["guest", "internet"]) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/share/tunnel",
        headers: { "x-drawnosaurus-role": role, host: "localhost:5273" },
      });
      expect(response.statusCode, role).toBe(403);
    }
    expect(cloudflared.spawned).toHaveLength(0);

    const told = await server.inject({
      method: "GET",
      url: "/v1/share",
      headers: { "x-drawnosaurus-role": "internet" },
    });
    expect(told.json()).toMatchObject({ lan: [], canManage: false });
    await server.close();
  });
});
