import { describe, expect, it } from "vitest";
import { compress, decompress } from "./compress.ts";

const encoder = new TextEncoder();

describe("compress", () => {
  it("gives back the bytes it was given", async () => {
    const bytes = encoder.encode(JSON.stringify({ elements: [{ id: "a", text: "héllo" }] }));
    expect(Buffer.from(await decompress(await compress(bytes)))).toEqual(Buffer.from(bytes));
  });

  it("makes a scene smaller: shapes repeat most of what they say", async () => {
    const shape = { type: "rectangle", strokeColor: "#1e1e1e", roughness: 1, opacity: 100 };
    const scene = encoder.encode(
      JSON.stringify({
        elements: Array.from({ length: 500 }, (_, i) => ({ ...shape, id: `e${i}` })),
      }),
    );
    const small = await compress(scene);
    expect(small.byteLength).toBeLessThan(scene.byteLength / 5);
  });

  it("gives back nothing at all, and refuses what it did not compress", async () => {
    expect((await decompress(await compress(new Uint8Array(0)))).byteLength).toBe(0);
    await expect(decompress(encoder.encode("not compressed"))).rejects.toThrow();
  });
});
