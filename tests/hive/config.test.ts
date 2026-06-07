import { afterEach, describe, expect, it } from "vitest";
import {
  loadVecnaServerConfig,
  loadVecnaClientConfig,
  parseAllowInsecure,
  assertServeAuthPosture,
} from "../../src/hive/config.js";

const VARS = [
  "MARIADB_URL",
  "MARIADB_USER",
  "MARIADB_PASSWORD",
  "MARIADB_SSL",
  "VECNA_HOST",
  "VECNA_PORT",
  "VECNA_AUTH_TOKEN",
  "VECNA_ALLOW_INSECURE",
  "VECNA_DEDUP_WINDOW_MIN",
  "VECNA_URL",
  "VECNA_TIMEOUT_MS",
];

afterEach(() => {
  for (const k of VARS) delete process.env[k];
});

function withDb(): void {
  process.env.MARIADB_URL = "mariadb://h:3306/db";
  process.env.MARIADB_USER = "u";
  process.env.MARIADB_PASSWORD = "p";
}

describe("loadVecnaServerConfig", () => {
  it("populates defaults", () => {
    withDb();
    const cfg = loadVecnaServerConfig();
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(8765);
    expect(cfg.authToken).toBeNull();
    expect(cfg.dedupWindowMinutes).toBe(5);
  });

  it("respects overrides", () => {
    withDb();
    process.env.VECNA_HOST = "0.0.0.0";
    process.env.VECNA_PORT = "9000";
    process.env.VECNA_AUTH_TOKEN = "tok";
    process.env.VECNA_DEDUP_WINDOW_MIN = "0";
    const cfg = loadVecnaServerConfig();
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.port).toBe(9000);
    expect(cfg.authToken).toBe("tok");
    expect(cfg.dedupWindowMinutes).toBe(0);
  });

  it("rejects invalid port", () => {
    withDb();
    process.env.VECNA_PORT = "999999";
    expect(() => loadVecnaServerConfig()).toThrow(/VECNA_PORT/);
  });

  it("rejects negative dedup window", () => {
    withDb();
    process.env.VECNA_DEDUP_WINDOW_MIN = "-1";
    expect(() => loadVecnaServerConfig()).toThrow(/VECNA_DEDUP_WINDOW_MIN/);
  });

  it("rejects empty auth token — fail loud rather than silently disable auth", () => {
    withDb();
    process.env.VECNA_AUTH_TOKEN = "";
    expect(() => loadVecnaServerConfig()).toThrow(/VECNA_AUTH_TOKEN/);
  });
});

describe("loadVecnaClientConfig", () => {
  it("populates defaults", () => {
    const cfg = loadVecnaClientConfig();
    expect(cfg.url).toBe("http://127.0.0.1:8765");
    expect(cfg.authToken).toBeNull();
    expect(cfg.timeoutMs).toBe(10_000);
  });

  it("strips trailing slashes", () => {
    process.env.VECNA_URL = "http://hive.local:8765//";
    expect(loadVecnaClientConfig().url).toBe("http://hive.local:8765");
  });

  it("rejects bad URL", () => {
    process.env.VECNA_URL = "not a url";
    expect(() => loadVecnaClientConfig()).toThrow(/VECNA_URL/);
  });

  it("rejects bad timeout", () => {
    process.env.VECNA_TIMEOUT_MS = "0";
    expect(() => loadVecnaClientConfig()).toThrow(/VECNA_TIMEOUT_MS/);
  });
});

describe("ASI06 — auth-by-default (parseAllowInsecure / assertServeAuthPosture)", () => {
  it("parseAllowInsecure is false when unset and for arbitrary values", () => {
    expect(parseAllowInsecure({})).toBe(false);
    expect(parseAllowInsecure({ VECNA_ALLOW_INSECURE: "0" })).toBe(false);
    expect(parseAllowInsecure({ VECNA_ALLOW_INSECURE: "nope" })).toBe(false);
  });

  it("parseAllowInsecure accepts 1/true/yes case-insensitively", () => {
    expect(parseAllowInsecure({ VECNA_ALLOW_INSECURE: "1" })).toBe(true);
    expect(parseAllowInsecure({ VECNA_ALLOW_INSECURE: "TRUE" })).toBe(true);
    expect(parseAllowInsecure({ VECNA_ALLOW_INSECURE: "Yes" })).toBe(true);
  });

  it("loadVecnaServerConfig surfaces allowInsecure", () => {
    withDb();
    process.env.VECNA_ALLOW_INSECURE = "1";
    expect(loadVecnaServerConfig().allowInsecure).toBe(true);
  });

  it("refuses to serve with no token and no opt-in", () => {
    expect(() => assertServeAuthPosture({ authToken: null, allowInsecure: false })).toThrow(
      /Refusing to start VECNA without authentication/,
    );
  });

  it("allows serving when a token is configured", () => {
    expect(() =>
      assertServeAuthPosture({ authToken: "secret", allowInsecure: false }),
    ).not.toThrow();
  });

  it("allows serving without a token only when explicitly opted in", () => {
    expect(() => assertServeAuthPosture({ authToken: null, allowInsecure: true })).not.toThrow();
  });

  it("rejects a whitespace-only VECNA_AUTH_TOKEN", () => {
    withDb();
    process.env.VECNA_AUTH_TOKEN = "   ";
    expect(() => loadVecnaServerConfig()).toThrow(/must be non-empty/);
  });

  it("trims surrounding whitespace from VECNA_AUTH_TOKEN", () => {
    withDb();
    process.env.VECNA_AUTH_TOKEN = "  secret  ";
    expect(loadVecnaServerConfig().authToken).toBe("secret");
  });
});
