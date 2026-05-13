import { afterEach, describe, expect, it } from "vitest";
import { loadDBConfig, loadLinearApiKey, sslOptionFor } from "../src/config.js";

const VARS = ["MARIADB_URL", "MARIADB_USER", "MARIADB_PASSWORD", "MARIADB_SSL", "LINEAR_API_KEY"];

function withEnv(values: Record<string, string | undefined>) {
  return Object.fromEntries(VARS.map((k) => [k, values[k]]));
}

describe("loadDBConfig", () => {
  it("parses all env vars from explicit env", () => {
    const cfg = loadDBConfig(
      withEnv({
        MARIADB_URL: "mariadb://db.example.com:3306/orchestra",
        MARIADB_USER: "orch",
        MARIADB_PASSWORD: "s3cret",
        MARIADB_SSL: "preferred",
      }),
    );
    expect(cfg).toEqual({
      host: "db.example.com",
      port: 3306,
      user: "orch",
      password: "s3cret",
      database: "orchestra",
      sslMode: "preferred",
    });
  });

  it("URL credentials win over env vars", () => {
    const cfg = loadDBConfig(
      withEnv({
        MARIADB_URL: "mariadb://urluser:urlpass@h:3307/db",
        MARIADB_USER: "env-user",
        MARIADB_PASSWORD: "env-pass",
      }),
    );
    expect(cfg.user).toBe("urluser");
    expect(cfg.password).toBe("urlpass");
    expect(cfg.port).toBe(3307);
  });

  it("URL credentials are percent-decoded", () => {
    const cfg = loadDBConfig(withEnv({ MARIADB_URL: "mariadb://u%40v:p%21ss@h/db" }));
    expect(cfg.user).toBe("u@v");
    expect(cfg.password).toBe("p!ss");
  });

  it("defaults port to 3306", () => {
    const cfg = loadDBConfig(
      withEnv({ MARIADB_URL: "mariadb://h/db", MARIADB_USER: "u", MARIADB_PASSWORD: "p" }),
    );
    expect(cfg.port).toBe(3306);
  });

  it("accepts mysql:// scheme", () => {
    const cfg = loadDBConfig(
      withEnv({ MARIADB_URL: "mysql://h/db", MARIADB_USER: "u", MARIADB_PASSWORD: "p" }),
    );
    expect(cfg.host).toBe("h");
  });

  it("defaults sslMode to preferred", () => {
    const cfg = loadDBConfig(
      withEnv({ MARIADB_URL: "mariadb://h/db", MARIADB_USER: "u", MARIADB_PASSWORD: "p" }),
    );
    expect(cfg.sslMode).toBe("preferred");
  });

  it("rejects missing MARIADB_URL", () => {
    expect(() => loadDBConfig(withEnv({}))).toThrow(/MARIADB_URL is required/);
  });

  it("rejects malformed URL", () => {
    expect(() => loadDBConfig(withEnv({ MARIADB_URL: "not a url" }))).toThrow(/not a valid URL/);
  });

  it("rejects wrong scheme", () => {
    expect(() =>
      loadDBConfig(
        withEnv({ MARIADB_URL: "postgresql://h/db", MARIADB_USER: "u", MARIADB_PASSWORD: "p" }),
      ),
    ).toThrow(/scheme must be/);
  });

  it("rejects missing database path", () => {
    expect(() =>
      loadDBConfig(
        withEnv({ MARIADB_URL: "mariadb://h", MARIADB_USER: "u", MARIADB_PASSWORD: "p" }),
      ),
    ).toThrow(/include \/<database>/);
  });

  it("rejects missing user when URL has no credentials", () => {
    expect(() =>
      loadDBConfig(withEnv({ MARIADB_URL: "mariadb://h/db", MARIADB_PASSWORD: "p" })),
    ).toThrow(/MARIADB_USER/);
  });

  it("rejects missing password", () => {
    expect(() =>
      loadDBConfig(withEnv({ MARIADB_URL: "mariadb://h/db", MARIADB_USER: "u" })),
    ).toThrow(/MARIADB_PASSWORD/);
  });

  it("rejects bad SSL mode", () => {
    expect(() =>
      loadDBConfig(
        withEnv({
          MARIADB_URL: "mariadb://h/db",
          MARIADB_USER: "u",
          MARIADB_PASSWORD: "p",
          MARIADB_SSL: "weird",
        }),
      ),
    ).toThrow(/MARIADB_SSL/);
  });

  it("rejects port out of range (URL parser does the work)", () => {
    expect(() =>
      loadDBConfig(
        withEnv({ MARIADB_URL: "mariadb://h:99999/db", MARIADB_USER: "u", MARIADB_PASSWORD: "p" }),
      ),
    ).toThrow(/not a valid URL/);
  });
});

describe("sslOptionFor", () => {
  it("disabled → false", () => {
    expect(sslOptionFor("disabled")).toBe(false);
  });
  it("insecure SSL mode skips cert verification", () => {
    expect(sslOptionFor("insecure")).toEqual({ rejectUnauthorized: false });
  });
  it("preferred → rejectUnauthorized:true", () => {
    expect(sslOptionFor("preferred")).toEqual({ rejectUnauthorized: true });
  });
  it("required → rejectUnauthorized:true", () => {
    expect(sslOptionFor("required")).toEqual({ rejectUnauthorized: true });
  });
});

describe("loadLinearApiKey", () => {
  afterEach(() => {
    delete process.env.LINEAR_API_KEY;
  });

  it("returns the key when set", () => {
    expect(loadLinearApiKey({ LINEAR_API_KEY: "abc" })).toBe("abc");
  });

  it("throws when missing", () => {
    expect(() => loadLinearApiKey({})).toThrow(/LINEAR_API_KEY is required/);
  });
});
