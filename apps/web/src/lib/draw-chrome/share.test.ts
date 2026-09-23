import { describe, expect, it } from "vitest";
import { shareLinks } from "./share.ts";

const board = (origin: string) => ({
  origin,
  pathname: "/boards/abc123",
  search: "",
  hash: "#room=KEY",
});

describe("shareLinks", () => {
  it("never offers localhost to someone else", () => {
    // The bug: the dialog offered the page's own address, and on the computer running
    // the stack that is localhost — a link to the colleague's own machine.
    const links = shareLinks(board("http://localhost:5273"), {
      lan: ["http://10.12.19.1:5273"],
      public: null,
    });
    expect(links).toEqual([
      { kind: "network", url: "http://10.12.19.1:5273/boards/abc123#room=KEY" },
    ]);
  });

  it("carries the room key, which is what lets the other side read the live link", () => {
    const [link] = shareLinks(board("http://localhost:5273"), {
      lan: ["http://10.12.19.1:5273"],
      public: null,
    });
    expect(new URL(link!.url).hash).toBe("#room=KEY");
  });

  it("offers the internet link when a tunnel is running, after the network one", () => {
    const links = shareLinks(board("http://localhost:5273"), {
      lan: ["http://10.12.19.1:5273"],
      public: "https://keen-lamp-rise.trycloudflare.com",
    });
    expect(links.map((link) => link.kind)).toEqual(["network", "internet"]);
    expect(links[1]!.url).toBe("https://keen-lamp-rise.trycloudflare.com/boards/abc123#room=KEY");
  });

  it("offers a colleague the address they are on", () => {
    // Someone who opened the board over the network, or through the tunnel, passes it on
    // at the address that worked for them.
    expect(shareLinks(board("http://10.12.19.1:5273"), { lan: [], public: null })).toEqual([
      { kind: "network", url: "http://10.12.19.1:5273/boards/abc123#room=KEY" },
    ]);
    expect(
      shareLinks(board("https://keen-lamp-rise.trycloudflare.com"), {
        lan: [],
        public: "https://keen-lamp-rise.trycloudflare.com",
      }),
    ).toEqual([
      { kind: "internet", url: "https://keen-lamp-rise.trycloudflare.com/boards/abc123#room=KEY" },
    ]);
  });

  it("says so when the only link it has works on this computer alone", () => {
    expect(shareLinks(board("http://localhost:5273"), { lan: [], public: null })).toEqual([
      { kind: "this-computer", url: "http://localhost:5273/boards/abc123#room=KEY" },
    ]);
    expect(shareLinks(board("http://localhost:5273"), null)[0]!.kind).toBe("this-computer");
  });

  it("does not offer the same address twice", () => {
    const links = shareLinks(board("http://10.12.19.1:5273"), {
      lan: ["http://10.12.19.1:5273"],
      public: null,
    });
    expect(links).toHaveLength(1);
  });
});
