import { describe, expect, it } from "vitest";
import { parseRoomKeyFromHash } from "../realtime/roomCrypto.ts";
import { createShareSession } from "./shareSession.ts";

const SLUG = "sharedsharedsharedshared12";
const ORIGIN = "https://hydrawn.test";

/** Every step a share takes, in the order it took them, with the secret it was given. */
function harness(options: { failFirstWrites?: number } = {}) {
  const steps: string[] = [];
  const secrets: Uint8Array[] = [];
  let failures = options.failFirstWrites ?? 0;
  let minted = 0;
  const session = createShareSession({
    slug: SLUG,
    origin: ORIGIN,
    mint: () => {
      minted += 1;
      return crypto.getRandomValues(new Uint8Array(32));
    },
    writeFirstCopy: async (secret) => {
      steps.push("write");
      secrets.push(secret);
      if (failures > 0) {
        failures -= 1;
        throw new Error("store unavailable");
      }
    },
    keepSecret: async (secret) => {
      steps.push("keep");
      secrets.push(secret);
    },
    goLive: (secret) => {
      steps.push("live");
      secrets.push(secret);
    },
    replaceState: (url) => steps.push(`address ${url}`),
  });
  return { session, steps, secrets, minted: () => minted };
}

describe("createShareSession", () => {
  it("writes the first copy before it connects, then keeps the secret, then shows the link", async () => {
    // The first write claims the drawing's write proof: it must land before the drawing's
    // id reaches the relay, where anyone watching could try to claim it first.
    const { session, steps, secrets } = harness();

    const link = await session.start();

    expect(steps).toEqual(["write", "keep", "live", `address ${link}`]);
    const secret = parseRoomKeyFromHash(new URL(link).hash)!;
    expect(link.startsWith(`${ORIGIN}/boards/${SLUG}#room=`)).toBe(true);
    for (const given of secrets) expect(given).toEqual(secret);
  });

  it("connects nothing and keeps nothing when the first copy fails, and tries the same secret again", async () => {
    // A write can land with its answer lost: a new secret would then be refused (403) for
    // good, since the proof stored is the first one's.
    const { session, steps, secrets, minted } = harness({ failFirstWrites: 1 });

    await expect(session.start()).rejects.toThrow("store unavailable");
    expect(steps).toEqual(["write"]);

    const link = await session.start();
    expect(steps.slice(1, 3)).toEqual(["write", "keep"]);
    expect(minted()).toBe(1);
    expect(secrets[1]).toEqual(secrets[0]);
    expect(parseRoomKeyFromHash(new URL(link).hash)).toEqual(secrets[0]);
  });

  it("gives the same link when started again, or twice at once, and writes nothing more", async () => {
    const { session, steps } = harness();

    const [first, twice] = await Promise.all([session.start(), session.start()]);
    const again = await session.start();

    expect(twice).toBe(first);
    expect(again).toBe(first);
    expect(steps.filter((step) => step === "write")).toHaveLength(1);
  });
});
