import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/persistence.js", () => {
  return {
    Ledger: vi.fn().mockImplementation(() => ({
      close: vi.fn(async () => undefined),
    })),
  };
});

vi.mock("../../src/hive/store.js", () => {
  return {
    HiveStore: vi.fn().mockImplementation(() => ({
      close: vi.fn(async () => undefined),
    })),
  };
});

vi.mock("../../src/linear-client.js", () => {
  return { LinearClient: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

import { HiveStore } from "../../src/hive/store.js";
import { Ledger } from "../../src/persistence.js";
import { LinearClient } from "../../src/linear-client.js";
import { createServices } from "../../src/plugin/services.js";

const ENV: NodeJS.ProcessEnv = {
  MARIADB_URL: "mariadb://h:3306/d",
  MARIADB_USER: "u",
  MARIADB_PASSWORD: "p",
};

describe("createServices", () => {
  it("constructs ledger + hive lazily, only on first access", () => {
    const original = { ...process.env };
    Object.assign(process.env, ENV);
    try {
      const svc = createServices({});
      expect(Ledger).not.toHaveBeenCalled();
      expect(HiveStore).not.toHaveBeenCalled();
      void svc.ledger;
      expect(Ledger).toHaveBeenCalledTimes(1);
      void svc.hive;
      expect(HiveStore).toHaveBeenCalledTimes(1);
      // Re-access returns the same instance — constructor stays at 1
      void svc.ledger;
      void svc.hive;
      expect(Ledger).toHaveBeenCalledTimes(1);
      expect(HiveStore).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(process.env, original);
    }
  });

  it("getLinear returns null when no api key is configured (and caches the decision)", () => {
    const original = { ...process.env };
    delete process.env.LINEAR_API_KEY;
    Object.assign(process.env, ENV);
    try {
      const svc = createServices({});
      expect(svc.getLinear()).toBeNull();
      expect(svc.getLinear()).toBeNull();
      expect(LinearClient).not.toHaveBeenCalled();
    } finally {
      Object.assign(process.env, original);
    }
  });

  it("getLinear instantiates LinearClient when an api key is present", () => {
    const original = { ...process.env };
    Object.assign(process.env, { ...ENV, LINEAR_API_KEY: "lin_abc" });
    try {
      const svc = createServices({});
      const client = svc.getLinear();
      expect(client).not.toBeNull();
      expect(LinearClient).toHaveBeenCalledWith({ apiKey: "lin_abc" });
      // Subsequent calls return the cached client (no second construction)
      svc.getLinear();
      expect(LinearClient).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(process.env, original);
    }
  });

  it("close releases ledger + hive pools when they were materialised", async () => {
    const original = { ...process.env };
    Object.assign(process.env, ENV);
    try {
      const svc = createServices({});
      void svc.ledger;
      void svc.hive;
      await svc.close();
      // After close, accessing again creates new instances (state was reset)
      void svc.ledger;
      void svc.hive;
      expect(Ledger).toHaveBeenCalledTimes(2);
      expect(HiveStore).toHaveBeenCalledTimes(2);
    } finally {
      Object.assign(process.env, original);
    }
  });

  it("close is a no-op when nothing has been materialised", async () => {
    const original = { ...process.env };
    Object.assign(process.env, ENV);
    try {
      const svc = createServices({});
      await expect(svc.close()).resolves.toBeUndefined();
    } finally {
      Object.assign(process.env, original);
    }
  });
});
