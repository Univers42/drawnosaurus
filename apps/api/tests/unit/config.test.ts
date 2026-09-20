import { describe, expect, it } from "vitest";
import { assertAuthModeSupported } from "../../src/auth.ts";
import { loadConfig } from "../../src/config.ts";

const base = { MONGO_URL: "mongodb://localhost:27017" } satisfies NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("fails at startup when the connection string is missing", () => {
    expect(() => loadConfig({})).toThrowError(/MONGO_URL is required/);
  });

  it("defaults to dev auth and a sane port", () => {
    const config = loadConfig(base);
    expect(config.authMode).toBe("dev");
    expect(config.port).toBe(4000);
    expect(config.dbName).toBe("drawnosaurus");
  });

  it("rejects a nonsense port instead of listening somewhere surprising", () => {
    expect(() => loadConfig({ ...base, PORT: "0" })).toThrowError(/positive integer/);
    expect(() => loadConfig({ ...base, PORT: "http" })).toThrowError(/positive integer/);
  });
});

describe("assertAuthModeSupported", () => {
  it("refuses to boot in bearer mode while no verifier exists", () => {
    // Booting here would serve every board to every caller — louder is safer.
    const config = loadConfig({ ...base, AUTH_MODE: "bearer" });
    expect(() => assertAuthModeSupported(config)).toThrowError(/not implemented/);
  });

  it("allows dev mode", () => {
    expect(() => assertAuthModeSupported(loadConfig(base))).not.toThrow();
  });
});
