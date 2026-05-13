import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryFn = vi.fn();
const beginFn = vi.fn();
const commitFn = vi.fn();
const rollbackFn = vi.fn();
const releaseFn = vi.fn();
const getConnectionFn = vi.fn();
const endFn = vi.fn();
const createPoolFn = vi.fn();

vi.mock("mariadb", () => ({
  createPool: (...args: unknown[]) => createPoolFn(...args),
}));

const DB = {
  host: "h",
  port: 3306,
  user: "u",
  password: "p",
  database: "db",
  sslMode: "preferred" as const,
};

beforeEach(() => {
  [queryFn, beginFn, commitFn, rollbackFn, releaseFn, getConnectionFn, endFn, createPoolFn].forEach(
    (m) => m.mockReset(),
  );
  getConnectionFn.mockResolvedValue({
    query: queryFn,
    release: releaseFn,
    beginTransaction: beginFn,
    commit: commitFn,
    rollback: rollbackFn,
  });
  createPoolFn.mockReturnValue({ getConnection: getConnectionFn, end: endFn });
});

afterEach(() => vi.restoreAllMocks());

const importStore = async () => (await import("../../src/hive/store.js")).HiveStore;

const row = (overrides: Record<string, unknown> = {}) => ({
  fragment_id: "11111111-2222-3333-4444-555555555555",
  topic: "deployment",
  sub_topic: null,
  content: "use nginx 1.27 for now",
  source_agent: "system-agent",
  importance: 3,
  linear_ticket_ref: null,
  is_deprecated: 0,
  created_at: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("HiveStore connect", () => {
  it("inserts a new fragment and returns it", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce({ affectedRows: 1 }); // insert
    queryFn.mockResolvedValueOnce([row()]); // fetch back
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    const result = await store.connect({
      topic: "deployment",
      content: "use nginx 1.27 for now",
      sourceAgent: "system-agent",
    });
    expect(result.deduplicated).toBe(false);
    expect(result.fragment.topic).toBe("deployment");
  });

  it("dedups within window when importance ≥ 4", async () => {
    const HiveStore = await importStore();
    const existing = row({ importance: 5, fragment_id: "abc" });
    queryFn.mockResolvedValueOnce([existing]); // dedup hit
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    const result = await store.connect({
      topic: "deployment",
      content: "use nginx 1.27 for now",
      sourceAgent: "system-agent",
      importance: 5,
    });
    expect(result.deduplicated).toBe(true);
    expect(result.fragment.fragmentId).toBe("abc");
  });

  it("skips dedup when window is 0", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    queryFn.mockResolvedValueOnce([row({ importance: 5 })]);
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 0 });
    const result = await store.connect({
      topic: "t",
      content: "c",
      sourceAgent: "a",
      importance: 5,
    });
    expect(result.deduplicated).toBe(false);
    // Only INSERT and post-fetch — no dedup SELECT.
    expect(queryFn.mock.calls[0][0]).toContain("INSERT INTO vecna_hive");
  });

  it("rejects empty content", async () => {
    const HiveStore = await importStore();
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(store.connect({ topic: "t", content: "", sourceAgent: "a" })).rejects.toThrow(
      /content/,
    );
  });

  it("rejects bad importance", async () => {
    const HiveStore = await importStore();
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(
      store.connect({
        topic: "t",
        content: "c",
        sourceAgent: "a",
        importance: 9 as unknown as 1,
      }),
    ).rejects.toThrow(/importance/);
  });
});

describe("HiveStore recall", () => {
  it("queries by topic and ranks by ticket, importance, recency", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([row(), row({ fragment_id: "b" })]);
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    const fragments = await store.recall("deployment", { ticket: "ENG-42", limit: 10 });
    expect(fragments).toHaveLength(2);
    const [sql, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE topic = ? AND is_deprecated = FALSE");
    expect(sql).toContain("ORDER BY");
    expect(params).toEqual(["deployment", "ENG-42", 10]);
  });

  it("falls back to defaults when options omitted", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([]);
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await store.recall("deployment");
    const [, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe(""); // no ticket
    expect(params[2]).toBe(20); // default limit
  });

  it("rejects non-positive limit", async () => {
    const HiveStore = await importStore();
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(store.recall("t", { limit: 0 })).rejects.toThrow(/positive/);
  });
});

describe("HiveStore search", () => {
  it("uses MATCH … AGAINST", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([row()]);
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    const results = await store.search("nginx");
    expect(results).toHaveLength(1);
    const [sql] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("MATCH(content) AGAINST");
  });

  it("rejects empty query", async () => {
    const HiveStore = await importStore();
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(store.search("")).rejects.toThrow(/non-empty/);
  });
});

describe("HiveStore evolve", () => {
  it("deprecates old + inserts new in a transaction", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([row()]); // fetch existing inside tx
    queryFn.mockResolvedValueOnce({ affectedRows: 1 }); // UPDATE deprecated
    queryFn.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT new
    queryFn.mockResolvedValueOnce([row({ is_deprecated: 1 })]); // fetch old (post-commit)
    queryFn.mockResolvedValueOnce([row({ fragment_id: "new-id", content: "corrected" })]); // fetch new
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    const result = await store.evolve("11111111-2222-3333-4444-555555555555", {
      content: "corrected",
      importance: 5,
    });
    expect(result.deprecated.isDeprecated).toBe(true);
    expect(result.replacement.content).toBe("corrected");
    expect(beginFn).toHaveBeenCalled();
    expect(commitFn).toHaveBeenCalled();
  });

  it("rolls back on error", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([row()]);
    queryFn.mockRejectedValueOnce(new Error("boom"));
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(store.evolve("id", { content: "x" })).rejects.toThrow(/boom/);
    expect(rollbackFn).toHaveBeenCalled();
  });

  it("rejects missing fragment", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([]); // no row
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(store.evolve("missing", { content: "x" })).rejects.toThrow(/not found/);
    expect(commitFn).toHaveBeenCalled(); // tx commits (empty work), then we throw
  });

  it("rejects empty content", async () => {
    const HiveStore = await importStore();
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(store.evolve("id", { content: "" })).rejects.toThrow(/non-empty/);
  });

  it("rejects bad importance", async () => {
    const HiveStore = await importStore();
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(
      store.evolve("id", { content: "x", importance: 9 as unknown as 1 }),
    ).rejects.toThrow(/importance/);
  });
});

describe("HiveStore lifecycle", () => {
  it("ping returns true on healthy DB", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([{ "1": 1 }]);
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    expect(await store.ping()).toBe(true);
  });

  it("ping returns false on DB error", async () => {
    const HiveStore = await importStore();
    queryFn.mockRejectedValueOnce(new Error("nope"));
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    expect(await store.ping()).toBe(false);
  });

  it("close is idempotent and prevents further use", async () => {
    const HiveStore = await importStore();
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await store.close();
    await store.close(); // idempotent
    expect(await store.ping()).toBe(false);
    await expect(store.getFragment("id")).rejects.toThrow(/closed/);
  });

  it("getFragment returns null when absent", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([]);
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    expect(await store.getFragment("nope")).toBeNull();
  });

  it("getFragment hydrates created_at strings", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([row({ created_at: "2026-01-01T00:00:00Z" })]);
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    const f = await store.getFragment("id");
    expect(f?.createdAt).toBeInstanceOf(Date);
  });

  it("rejects unknown importance from the DB", async () => {
    const HiveStore = await importStore();
    queryFn.mockResolvedValueOnce([row({ importance: 9 })]);
    const store = new HiveStore({ db: DB, dedupWindowMinutes: 5 });
    await expect(store.getFragment("id")).rejects.toThrow(/invalid importance/);
  });
});
