import type { ShareInfo } from "@drawnosaurus/contract";
import { describe, expect, it } from "vitest";
import { describeLink, internetPrompt, shareLinks } from "./share.ts";

const board = (origin: string) => ({
  origin,
  pathname: "/boards/abc123",
  search: "",
  hash: "#room=KEY",
});

const info = (over: Partial<ShareInfo> = {}): ShareInfo => ({
  lan: [
    { origin: "http://c2r19s1.42madrid.com:5273", over: "wired" },
    { origin: "http://10.12.19.1:5273", over: "wired" },
  ],
  public: null,
  tunnel: { state: "off" },
  canManage: true,
  ...over,
});

const PUBLIC = "https://keen-lamp-rise.trycloudflare.com";

describe("shareLinks", () => {
  it("never offers localhost to someone else", () => {
    // The bug: the dialog offered the page's own address, and on the computer running
    // the stack that is localhost — a link to the colleague's own machine.
    const links = shareLinks(board("http://localhost:5273"), info());
    expect(
      links.every((link) => !link.url.includes("localhost")),
      JSON.stringify(links),
    ).toBe(true);
  });

  it("offers the computer's name first, then its address, each with its network", () => {
    const [first, second] = shareLinks(board("http://localhost:5273"), info());
    expect(first).toEqual({
      kind: "network",
      via: "name",
      over: "wired",
      url: "http://c2r19s1.42madrid.com:5273/boards/abc123#room=KEY",
    });
    expect(second).toEqual({
      kind: "network",
      via: "address",
      over: "wired",
      url: "http://10.12.19.1:5273/boards/abc123#room=KEY",
    });
  });

  it("carries the room key, which is what lets the other side read the live link", () => {
    const [link] = shareLinks(board("http://localhost:5273"), info());
    expect(new URL(link!.url).hash).toBe("#room=KEY");
  });

  it("offers the internet link while it is on, after the network ones", () => {
    const links = shareLinks(board("http://localhost:5273"), info({ public: PUBLIC }));
    expect(links.map((link) => link.kind)).toEqual(["network", "network", "internet"]);
    expect(links[2]!.url).toBe(`${PUBLIC}/boards/abc123#room=KEY`);
  });

  it("offers a colleague first the address they are on", () => {
    // It is known to work for them — and the name is still offered after it.
    const links = shareLinks(board("http://10.12.19.1:5273"), info({ canManage: false }));
    expect(links[0]).toEqual({
      kind: "network",
      via: "address",
      over: "wired",
      url: "http://10.12.19.1:5273/boards/abc123#room=KEY",
    });
    expect(links).toHaveLength(2);

    const online = shareLinks(board(PUBLIC), info({ lan: [], public: PUBLIC, canManage: false }));
    expect(online).toEqual([{ kind: "internet", url: `${PUBLIC}/boards/abc123#room=KEY` }]);
  });

  it("says so when the only link it has works on this computer alone", () => {
    expect(shareLinks(board("http://localhost:5273"), info({ lan: [] }))).toEqual([
      { kind: "this-computer", url: "http://localhost:5273/boards/abc123#room=KEY" },
    ]);
    expect(shareLinks(board("http://localhost:5273"), null)[0]!.kind).toBe("this-computer");
  });
});

describe("describeLink", () => {
  it("says who a link is for from the network it goes over, and names the computer", () => {
    // The bug: a computer on the wired network only offered its name as the link for the
    // wired network *and the Wi-Fi*. At school the two are kept apart, and a colleague
    // on the Wi-Fi got a link that failed without a word.
    const [name, address] = shareLinks(board("http://localhost:5273"), info());
    expect(describeLink(name!).title).toBe("People on the wired network");
    expect(describeLink(name!).title).not.toMatch(/Wi-Fi/);
    expect(describeLink(name!).hint).toContain("c2r19s1.42madrid.com");
    expect(describeLink(name!).hint).toMatch(/Wi-Fi/);
    expect(describeLink(address!).hint).toContain("10.12.19.1");

    const wifi = shareLinks(
      board("http://localhost:5273"),
      info({ lan: [{ origin: "http://192.168.1.20:5274", over: "wifi" }] }),
    );
    expect(describeLink(wifi[0]!).title).toBe("People on this Wi-Fi");
    const unknown = shareLinks(
      board("http://localhost:5273"),
      info({ lan: [{ origin: "http://192.168.1.20:5274", over: "unknown" }] }),
    );
    expect(describeLink(unknown[0]!).title).toBe("People on your network");
  });

  it("says the internet link works anywhere", () => {
    const links = shareLinks(board("http://localhost:5273"), info({ public: PUBLIC }));
    expect(describeLink(links.at(-1)!).hint).toMatch(/any network/);
  });
});

describe("internetPrompt", () => {
  it("names the Wi-Fi when this computer is on the wired network only", () => {
    expect(internetPrompt(shareLinks(board("http://localhost:5273"), info()))).toMatch(
      /Wi-Fi.*wired network only/,
    );
    const both = info({
      lan: [
        { origin: "http://10.12.19.1:5274", over: "wired" },
        { origin: "http://192.168.1.20:5274", over: "wifi" },
      ],
    });
    expect(internetPrompt(shareLinks(board("http://localhost:5273"), both))).not.toMatch(
      /wired network only/,
    );
  });
});
