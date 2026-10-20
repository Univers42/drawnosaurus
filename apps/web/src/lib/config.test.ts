import { beforeEach, describe, expect, it, vi } from "vitest";

// `$env/dynamic/public` is a SvelteKit virtual module; vitest has no resolver for it.
// BROWSER_MODE is folded by Vite's `define`, so it is always false here: only the
// server branch is testable at runtime. The browser branch is proven by `make build-public`.
const env: Record<string, string | undefined> = {};
vi.mock("$env/dynamic/public", () => ({ env }));

const { apiBase, relayToken, relayWsUrl } = await import("./config.ts");

describe("config (server build)", () => {
  beforeEach(() => {
    for (const key of Object.keys(env)) delete env[key];
  });

  it("apiBase is empty when PUBLIC_API_URL is unset", () => {
    expect(apiBase()).toBe("");
  });

  it("apiBase returns PUBLIC_API_URL without a trailing slash", () => {
    env.PUBLIC_API_URL = "https://api.example.com/";
    expect(apiBase()).toBe("https://api.example.com");
  });

  it("relayWsUrl returns PUBLIC_REALTIME_WS_URL, or empty", () => {
    expect(relayWsUrl()).toBe("");
    env.PUBLIC_REALTIME_WS_URL = "ws://localhost:4402/ws";
    expect(relayWsUrl()).toBe("ws://localhost:4402/ws");
  });

  it("relayToken returns PUBLIC_REALTIME_TOKEN, or empty", () => {
    expect(relayToken()).toBe("");
    env.PUBLIC_REALTIME_TOKEN = "secret";
    expect(relayToken()).toBe("secret");
  });
});
