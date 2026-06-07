import { describe, expect, it } from "vitest";
import {
  isAutoRecoveryEnabled,
  resolveDBConfig,
  resolveDedupWindow,
  resolveLinearApiKey,
} from "../../src/plugin/config.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  MARIADB_URL: "mariadb://envhost:3306/envdb",
  MARIADB_USER: "envuser",
  MARIADB_PASSWORD: "envpass",
  MARIADB_SSL: "preferred",
};

describe("resolveDBConfig", () => {
  it("uses env vars when plugin config is empty", () => {
    const cfg = resolveDBConfig({}, BASE_ENV);
    expect(cfg.host).toBe("envhost");
    expect(cfg.user).toBe("envuser");
    expect(cfg.password).toBe("envpass");
    expect(cfg.sslMode).toBe("preferred");
  });

  it("plugin config overrides env vars (URL, user, ssl) — password always comes from env", () => {
    const cfg = resolveDBConfig(
      {
        mariadb: {
          url: "mariadb://overhost:3307/overdb",
          user: "overuser",
          ssl: "required",
        },
      },
      BASE_ENV,
    );
    expect(cfg.host).toBe("overhost");
    expect(cfg.port).toBe(3307);
    expect(cfg.user).toBe("overuser");
    // password comes from BASE_ENV.MARIADB_PASSWORD because the plugin config
    // type deliberately excludes the password field.
    expect(cfg.password).toBe("envpass");
    expect(cfg.database).toBe("overdb");
    expect(cfg.sslMode).toBe("required");
  });

  it("throws clear error when neither env nor plugin config supplies MARIADB_URL", () => {
    expect(() => resolveDBConfig({}, {})).toThrow(/MARIADB_URL is required/);
  });
});

describe("resolveLinearApiKey", () => {
  it("reads from env var", () => {
    expect(resolveLinearApiKey({}, { LINEAR_API_KEY: "lin_env" })).toBe("lin_env");
  });

  it("ignores plugin config (secrets never come from openclaw.json)", () => {
    expect(
      resolveLinearApiKey({ linear: { apiKey: "lin_plugin" } } as never, {
        LINEAR_API_KEY: "lin_env",
      }),
    ).toBe("lin_env");
  });

  it("returns null when no env var is set", () => {
    expect(resolveLinearApiKey({}, {})).toBeNull();
  });
});

describe("resolveDedupWindow", () => {
  it("uses plugin config when set", () => {
    expect(resolveDedupWindow({ vecna: { dedupWindowMinutes: 10 } })).toBe(10);
  });

  it("rejects negative plugin-config values and falls through", () => {
    const original = process.env.VECNA_DEDUP_WINDOW_MIN;
    delete process.env.VECNA_DEDUP_WINDOW_MIN;
    try {
      expect(resolveDedupWindow({ vecna: { dedupWindowMinutes: -3 } })).toBe(5);
    } finally {
      if (original !== undefined) process.env.VECNA_DEDUP_WINDOW_MIN = original;
    }
  });

  it("falls back to VECNA_DEDUP_WINDOW_MIN env var", () => {
    const original = process.env.VECNA_DEDUP_WINDOW_MIN;
    process.env.VECNA_DEDUP_WINDOW_MIN = "7";
    try {
      expect(resolveDedupWindow({})).toBe(7);
    } finally {
      if (original !== undefined) process.env.VECNA_DEDUP_WINDOW_MIN = original;
      else delete process.env.VECNA_DEDUP_WINDOW_MIN;
    }
  });

  it("rejects non-numeric env var and falls back to default 5", () => {
    const original = process.env.VECNA_DEDUP_WINDOW_MIN;
    process.env.VECNA_DEDUP_WINDOW_MIN = "not-a-number";
    try {
      expect(resolveDedupWindow({})).toBe(5);
    } finally {
      if (original !== undefined) process.env.VECNA_DEDUP_WINDOW_MIN = original;
      else delete process.env.VECNA_DEDUP_WINDOW_MIN;
    }
  });

  it("defaults to 5 minutes when nothing is set", () => {
    const original = process.env.VECNA_DEDUP_WINDOW_MIN;
    delete process.env.VECNA_DEDUP_WINDOW_MIN;
    try {
      expect(resolveDedupWindow({})).toBe(5);
    } finally {
      if (original !== undefined) process.env.VECNA_DEDUP_WINDOW_MIN = original;
    }
  });
});

describe("isAutoRecoveryEnabled", () => {
  it("returns false by default", () => {
    expect(isAutoRecoveryEnabled({})).toBe(false);
  });

  it("returns true when explicitly enabled", () => {
    expect(isAutoRecoveryEnabled({ autoRecovery: true })).toBe(true);
  });

  it("returns false when explicitly disabled", () => {
    expect(isAutoRecoveryEnabled({ autoRecovery: false })).toBe(false);
  });
});
