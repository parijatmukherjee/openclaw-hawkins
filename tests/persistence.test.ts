import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the mariadb driver before importing the module under test.
const queryFn = vi.fn();
const releaseFn = vi.fn();
const getConnectionFn = vi.fn();
const endFn = vi.fn();
const createPoolFn = vi.fn();

vi.mock("mariadb", () => ({
  createPool: (...args: unknown[]) => createPoolFn(...args),
}));

beforeEach(() => {
  queryFn.mockReset();
  releaseFn.mockReset();
  getConnectionFn.mockReset();
  endFn.mockReset();
  createPoolFn.mockReset();

  getConnectionFn.mockResolvedValue({ query: queryFn, release: releaseFn });
  createPoolFn.mockReturnValue({ getConnection: getConnectionFn, end: endFn });

  process.env.MARIADB_URL = "mariadb://h:3306/db";
  process.env.MARIADB_USER = "u";
  process.env.MARIADB_PASSWORD = "p";
  delete process.env.MARIADB_SSL;
});

afterEach(() => {
  delete process.env.MARIADB_URL;
  delete process.env.MARIADB_USER;
  delete process.env.MARIADB_PASSWORD;
});

const importLedger = async () => (await import("../src/persistence.js")).Ledger;

describe("Ledger.fromEnv", () => {
  it("creates a pool with the parsed config", async () => {
    const Ledger = await importLedger();
    Ledger.fromEnv();
    expect(createPoolFn).toHaveBeenCalledOnce();
    const opts = createPoolFn.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.host).toBe("h");
    expect(opts.user).toBe("u");
    expect(opts.database).toBe("db");
    expect(opts.multipleStatements).toBe(false);
  });

  it("close releases the pool and is idempotent", async () => {
    const Ledger = await importLedger();
    const ledger = Ledger.fromEnv();
    await ledger.close();
    await ledger.close();
    expect(endFn).toHaveBeenCalledOnce();
  });

  it("rejects use after close", async () => {
    const Ledger = await importLedger();
    const ledger = Ledger.fromEnv();
    await ledger.close();
    await expect(ledger.get("x")).rejects.toThrow(/closed/);
  });
});

describe("Ledger CRUD", () => {
  it("create generates UUID and inserts", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const ledger = Ledger.fromEnv();
    const id = await ledger.create({
      objectiveSummary: "x",
      linearParentId: "ENG-1",
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const [sql, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO orchestration_ledger");
    expect(params[0]).toBe(id);
    expect(params[1]).toBe("ENG-1");
    expect(params[3]).toBe("init");
    expect(releaseFn).toHaveBeenCalled();
  });

  it("create honours explicit orchestrationId", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const ledger = Ledger.fromEnv();
    const fixed = "11111111-2222-3333-4444-555555555555";
    expect(await ledger.create({ objectiveSummary: "x", orchestrationId: fixed })).toBe(fixed);
  });

  it("create releases connection even on query error", async () => {
    const Ledger = await importLedger();
    queryFn.mockRejectedValueOnce(new Error("constraint"));
    const ledger = Ledger.fromEnv();
    await expect(ledger.create({ objectiveSummary: "x" })).rejects.toThrow(/constraint/);
    expect(releaseFn).toHaveBeenCalled();
  });

  it("get returns null when absent", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce([]);
    const ledger = Ledger.fromEnv();
    expect(await ledger.get("nope")).toBeNull();
  });

  it("get parses row when present", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce([
      {
        orchestration_id: "oid",
        linear_parent_id: "ENG-1",
        objective_summary: "g",
        state: "planning",
        last_agent_active: null,
        updated_at: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    const ledger = Ledger.fromEnv();
    const row = await ledger.get("oid");
    expect(row).toMatchObject({ orchestrationId: "oid", state: "planning" });
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("get parses string updated_at", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce([
      {
        orchestration_id: "oid",
        linear_parent_id: null,
        objective_summary: "g",
        state: "init",
        last_agent_active: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const ledger = Ledger.fromEnv();
    const row = await ledger.get("oid");
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("setState without lastAgent only updates state", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const ledger = Ledger.fromEnv();
    expect(await ledger.setState("oid", "executing")).toBe(true);
    const [sql, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("SET state = ?");
    expect(sql).not.toContain("last_agent_active");
    expect(params).toEqual(["executing", "oid"]);
  });

  it("setState with lastAgent updates both columns", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const ledger = Ledger.fromEnv();
    await ledger.setState("oid", "executing", { lastAgentActive: "code-agent" });
    const [sql, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("last_agent_active");
    expect(params).toEqual(["executing", "code-agent", "oid"]);
  });

  it("setState returns false when no row matches", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce({ affectedRows: 0 });
    const ledger = Ledger.fromEnv();
    expect(await ledger.setState("missing", "failed")).toBe(false);
  });

  it("attachLinearParent sets the column", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const ledger = Ledger.fromEnv();
    expect(await ledger.attachLinearParent("oid", "ENG-7")).toBe(true);
    expect((queryFn.mock.calls[0] as unknown[])[1]).toEqual(["ENG-7", "oid"]);
  });

  it("listUnfinished queries the three unfinished states", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce([]);
    const ledger = Ledger.fromEnv();
    const rows = await ledger.listUnfinished();
    const [sql, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE state IN (?, ?, ?)");
    expect(params).toEqual(["init", "planning", "executing"]);
    expect(rows).toEqual([]);
  });

  it("listRecent applies the limit", async () => {
    const Ledger = await importLedger();
    queryFn.mockResolvedValueOnce([]);
    const ledger = Ledger.fromEnv();
    await ledger.listRecent(5);
    const [sql, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("LIMIT ?");
    expect(params).toEqual([5]);
  });

  it("listRecent rejects non-positive limit", async () => {
    const Ledger = await importLedger();
    const ledger = Ledger.fromEnv();
    await expect(ledger.listRecent(0)).rejects.toThrow(/positive integer/);
  });
});
