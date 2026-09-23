import { describe, expect, it } from "vitest";
import { isAddressHost, isLoopbackHost, shareInfoSchema } from "../src/share.ts";

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
      "c2r19s1.42madrid.com:5273",
      "abc.trycloudflare.com",
      "localhost.evil.test",
    ]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe("isAddressHost", () => {
  it("tells an address from a name", () => {
    expect(isAddressHost("10.12.19.1:5273")).toBe(true);
    expect(isAddressHost("[fd12::1]:5273")).toBe(true);
    expect(isAddressHost("c2r19s1.42madrid.com:5273")).toBe(false);
    expect(isAddressHost("c2r19s1.local")).toBe(false);
  });
});

describe("shareInfoSchema", () => {
  it("takes network origins, the internet link or none, and the tunnel's state", () => {
    const info = shareInfoSchema.parse({
      lan: ["http://c2r19s1.42madrid.com:5273", "http://10.12.19.1:5273"],
      public: "https://keen-lamp-rise.trycloudflare.com",
      tunnel: { state: "on" },
      canManage: true,
    });
    expect(info.lan).toHaveLength(2);
    expect(() =>
      shareInfoSchema.parse({
        lan: ["not a url"],
        public: null,
        tunnel: { state: "off" },
        canManage: false,
      }),
    ).toThrow();
    expect(() =>
      shareInfoSchema.parse({
        lan: [],
        public: null,
        tunnel: { state: "sideways" },
        canManage: false,
      }),
    ).toThrow();
  });
});
