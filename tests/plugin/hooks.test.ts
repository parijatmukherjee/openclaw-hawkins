import { describe, expect, it, vi } from "vitest";
import type { LinearClient } from "../../src/linear-client.js";
import type { Ledger } from "../../src/persistence.js";
import { buildAutoRecoveryHandler } from "../../src/plugin/hooks.js";
import type { HawkinsServices } from "../../src/plugin/services.js";

function fakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function row(orchestrationId: string, linearParentId: string | null = "ENG-1") {
  return {
    orchestrationId,
    linearParentId,
    objectiveSummary: "x",
    state: "executing" as const,
    lastAgentActive: null,
    updatedAt: new Date(),
  };
}

function buildServices(overrides: {
  unfinished?: ReturnType<typeof row>[];
  linear?: LinearClient | null;
}): HawkinsServices {
  const ledger = {
    listUnfinished: vi.fn(async () => overrides.unfinished ?? []),
    setState: vi.fn(async () => true),
  } as unknown as Ledger;
  return {
    get ledger() {
      return ledger;
    },
    get hive() {
      throw new Error("hive should not be accessed in this test");
    },
    getLinear: () => overrides.linear ?? null,
    close: async () => undefined,
  };
}

describe("buildAutoRecoveryHandler", () => {
  it("returns a no-op handler when disabled", async () => {
    const services = buildServices({});
    const logger = fakeLogger();
    const handler = buildAutoRecoveryHandler({ enabled: false, services, logger });
    await handler();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs a hint when Linear is not configured", async () => {
    const services = buildServices({
      unfinished: [row("oid-1")],
      linear: null,
    });
    const logger = fakeLogger();
    const handler = buildAutoRecoveryHandler({ enabled: true, services, logger });
    await handler();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("linear api key not configured"),
    );
  });

  it("logs 'no unfinished' when ledger is empty", async () => {
    const services = buildServices({
      unfinished: [],
      linear: {
        getIssue: vi.fn().mockResolvedValue(null),
        listChildren: vi.fn().mockResolvedValue([]),
      } as unknown as LinearClient,
    });
    const logger = fakeLogger();
    const handler = buildAutoRecoveryHandler({ enabled: true, services, logger });
    await handler();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("no unfinished orchestrations"),
    );
  });

  it("warns about unfinished orchestrations with a summary", async () => {
    const services = buildServices({
      unfinished: [row("oid-1", "ENG-1"), row("oid-2", "ENG-2")],
      linear: {
        getIssue: vi.fn().mockResolvedValue(null),
        listChildren: vi.fn().mockResolvedValue([]),
      } as unknown as LinearClient,
    });
    const logger = fakeLogger();
    const handler = buildAutoRecoveryHandler({ enabled: true, services, logger });
    await handler();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/2 unfinished orchestration.+orphaned=2.+vines_recover/s),
    );
  });

  it("never throws even if the scan blows up — logs error instead", async () => {
    const ledger = {
      listUnfinished: vi.fn(async () => {
        throw new Error("db down");
      }),
      setState: vi.fn(async () => true),
    } as unknown as Ledger;
    const services: HawkinsServices = {
      get ledger() {
        return ledger;
      },
      get hive() {
        throw new Error("not used");
      },
      getLinear: () =>
        ({
          getIssue: vi.fn(),
          listChildren: vi.fn(),
        }) as unknown as LinearClient,
      close: async () => undefined,
    };
    const logger = fakeLogger();
    const handler = buildAutoRecoveryHandler({ enabled: true, services, logger });
    await handler();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("db down"));
  });
});
