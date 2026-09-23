import { describe, expect, it } from "vitest";
import { isLoopbackHost, isPrivateHost, shareInfoSchema } from "../src/share.ts";

describe("isLoopbackHost", () => {
  it("is this computer, with or without a port", () => {
    for (const host of [
      "localhost",
      "localhost:5273",
      "127.0.0.1",
      "127.0.0.1:5273",
      "[::1]:5273",
      "::1",
      "app.localhost",
    ]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("is not another computer", () => {
    for (const host of [
      "10.12.19.1:5273",
      "192.168.1.20",
      "abc.trycloudflare.com",
      "localhost.evil.test",
    ]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe("isPrivateHost", () => {
  it("is this computer or the local network", () => {
    for (const host of [
      "localhost:5273",
      "10.12.19.1:5273",
      "172.16.0.4",
      "172.31.255.1",
      "192.168.1.20:5273",
      "169.254.3.3",
      "[fd12::1]:5273",
      "[fe80::1]",
      "mylaptop.local:5273",
    ]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
  });

  it("is not the internet", () => {
    for (const host of [
      "abc-def.trycloudflare.com",
      "8.8.8.8",
      "172.32.0.1",
      "172.15.0.1",
      "11.0.0.1",
      "[2606:4700::1]",
      "example.com",
    ]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });
});

describe("shareInfoSchema", () => {
  it("takes origins, and a public one or none", () => {
    expect(
      shareInfoSchema.parse({ lan: ["http://10.12.19.1:5273"], public: null }).lan,
    ).toHaveLength(1);
    expect(shareInfoSchema.parse({ lan: [], public: "https://abc.trycloudflare.com" }).public).toBe(
      "https://abc.trycloudflare.com",
    );
    expect(() => shareInfoSchema.parse({ lan: ["not a url"], public: null })).toThrow();
  });
});
