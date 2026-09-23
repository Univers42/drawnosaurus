import { spawn } from "node:child_process";
import type { TunnelState } from "@drawnosaurus/contract";

/**
 * The internet link: a Cloudflare quick tunnel, started and stopped from the Share
 * dialog.
 *
 * It used to take a terminal and `make share`. Now the person at the computer running
 * drawnosaurus presses a button: the API starts `cloudflared`, which dials out to
 * Cloudflare — no account, no open port — and is given a random public HTTPS name that
 * passes requests back to the gateway's internet entrance (:82). The name is read from
 * cloudflared's own log.
 *
 * # When the link is offered
 *
 * Not when the name is known, nor when the tunnel says it is connected: a new name takes
 * a few seconds more to appear in DNS, and a browser that asks before then is told it
 * does not exist — measured here, the first attempt failed with ERR_NAME_NOT_RESOLVED.
 * Worse, that answer can be cached: `trycloudflare.com` allows thirty minutes, so one
 * early look-up through a school's shared resolver could break the link for everyone
 * behind it. So the tunnel asks Cloudflare's own DNS, over HTTPS — outside any local
 * resolver, whose cache it cannot spoil — and offers the link once the name is published.
 */

export interface TunnelStatus {
  state: TunnelState;
  /** The public origin, once the tunnel is on. */
  origin: string | null;
  /** Why it failed, in words for the person who pressed the button. */
  message?: string;
}

/** What the tunnel needs of a child process — the real one, or a test's. */
export interface TunnelProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnTunnel = (args: string[]) => TunnelProcess;

const spawnCloudflared: SpawnTunnel = (args) =>
  spawn("cloudflared", args, { stdio: ["ignore", "pipe", "pipe"] });

/** Whether a name is published in DNS: true, false, or null when that cannot be told. */
export type IsPublished = (hostname: string) => Promise<boolean | null>;

/** Asks Cloudflare's DNS, over HTTPS, whether the name exists yet. */
const askCloudflareDns: IsPublished = async (hostname) => {
  try {
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4_000) },
    );
    if (!response.ok) return null;
    const answer = (await response.json()) as { Status?: number; Answer?: unknown[] };
    return answer.Status === 0 && Array.isArray(answer.Answer) && answer.Answer.length > 0;
  } catch {
    return null;
  }
};

const PUBLIC_NAME = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/;
const CONNECTED = /Registered tunnel connection/;
/** How long a tunnel may take to come up, name published, before it is given up on. */
const START_TIMEOUT_MS = 60_000;
/** How often to ask whether the name is published yet. */
const PUBLISH_POLL_MS = 1_500;
/** When DNS cannot be asked at all, how long to wait after connecting instead. */
const UNVERIFIED_WAIT_MS = 10_000;
/** How much of the log is kept to look for the name in: it can arrive split. */
const LOG_TAIL = 8_192;

export class Tunnel {
  private readonly target: string | null;
  private readonly spawnTunnel: SpawnTunnel;
  private readonly startTimeoutMs: number;
  private readonly isPublished: IsPublished;
  private readonly pollMs: number;
  private child: TunnelProcess | null = null;
  private status: TunnelStatus;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * `target` is where the tunnel sends requests — the gateway's internet entrance — or
   * null where there is no tunnel to offer (tests, `make dev`).
   */
  constructor(
    target: string | null,
    options: {
      spawn?: SpawnTunnel;
      isPublished?: IsPublished;
      startTimeoutMs?: number;
      pollMs?: number;
    } = {},
  ) {
    this.target = target;
    this.spawnTunnel = options.spawn ?? spawnCloudflared;
    this.isPublished = options.isPublished ?? askCloudflareDns;
    this.startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
    this.pollMs = options.pollMs ?? PUBLISH_POLL_MS;
    this.status = target ? { state: "off", origin: null } : { state: "unavailable", origin: null };
  }

  get current(): TunnelStatus {
    return this.status;
  }

  /** Starts the tunnel, or leaves the one already starting or running alone. */
  start(): TunnelStatus {
    if (!this.target || this.child) return this.status;
    this.status = { state: "starting", origin: null };

    let child: TunnelProcess;
    try {
      child = this.spawnTunnel([
        "tunnel",
        "--no-autoupdate",
        // http2 rather than QUIC: QUIC is UDP, which school and office networks often
        // drop, and then the tunnel never comes up. http2 goes out on 443 like a web page.
        "--protocol",
        "http2",
        "--url",
        this.target,
      ]);
    } catch (error) {
      return this.fail(`the tunnel could not start: ${(error as Error).message}`);
    }
    this.child = child;

    let log = "";
    let hostname: string | null = null;
    let waiting = false;
    const read = (chunk: Buffer | string): void => {
      if (this.child !== child) return;
      log = (log + chunk.toString()).slice(-LOG_TAIL);
      hostname ??= PUBLIC_NAME.exec(log)?.[1] ?? null;
      if (hostname && CONNECTED.test(log) && !waiting) {
        waiting = true;
        void this.awaitPublished(child, hostname);
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);

    child.on("error", (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.fail(`the tunnel could not start: ${error.message}`);
    });
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      this.clearTimer();
      if (this.status.state === "starting") {
        this.fail(
          "the tunnel stopped before it was connected — this network may block connections to Cloudflare",
        );
      } else {
        this.status = { state: "off", origin: null };
      }
    });

    this.timer = setTimeout(() => {
      if (this.child !== child || this.status.state !== "starting") return;
      this.child = null;
      child.kill("SIGTERM");
      this.fail(
        "the tunnel did not connect in time — this network may block connections to Cloudflare",
      );
    }, this.startTimeoutMs);

    return this.status;
  }

  /** Offers the link once its name is published — see the module notes. */
  private async awaitPublished(child: TunnelProcess, hostname: string): Promise<void> {
    const connectedAt = Date.now();
    let unknown = 0;
    while (this.child === child && this.status.state === "starting") {
      const published = await this.isPublished(hostname);
      if (this.child !== child || this.status.state !== "starting") return;
      if (published === null) unknown += 1;
      // Published — or DNS cannot be asked at all, and a fair wait has passed instead.
      if (published === true || (unknown >= 3 && Date.now() - connectedAt >= UNVERIFIED_WAIT_MS)) {
        this.clearTimer();
        this.status = { state: "on", origin: `https://${hostname}` };
        return;
      }
      await new Promise((done) => setTimeout(done, this.pollMs));
    }
  }

  /** Closes the internet link. The name stops working at once, and is not reused. */
  stop(): TunnelStatus {
    const child = this.child;
    this.child = null;
    this.clearTimer();
    child?.kill("SIGTERM");
    if (this.status.state !== "unavailable") this.status = { state: "off", origin: null };
    return this.status;
  }

  private fail(message: string): TunnelStatus {
    this.clearTimer();
    this.status = { state: "failed", origin: null, message };
    return this.status;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
