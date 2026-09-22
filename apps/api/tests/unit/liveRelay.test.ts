import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The live route must stay a blind fan-out. Parsing or decrypting frames on the
 * server would break end-to-end encryption for collaboration. This pins the source
 * contract so a future "helpful" change cannot silently add JSON.parse / WebCrypto.
 */
describe("live WebSocket relay stays opaque", () => {
  const source = stripComments(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/boards/live.ts"), "utf8"),
  );

  it("never parses, decrypts, or logs message bodies", () => {
    expect(source).not.toMatch(/\bJSON\.parse\s*\(/);
    expect(source).not.toMatch(/\bJSON\.stringify\s*\(/);
    expect(source).not.toMatch(/\bcrypto\b/);
    expect(source).not.toMatch(/\.decrypt\s*\(/);
    expect(source).not.toMatch(/\bconsole\.(log|info|debug|warn|error)\s*\(/);
  });

  it("forwards the raw text frame to peers without transforming it", () => {
    expect(source).toMatch(/data\.toString\(\)/);
    expect(source).toMatch(/peer\.send\(text\)/);
  });
});

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
