import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to mock the mariadb driver so `init-db` doesn't actually open a
// socket, and the Linear API so `recover` doesn't hit the network.

const queryFn = vi.fn();
const releaseFn = vi.fn();
const getConnectionFn = vi.fn();
const poolEndFn = vi.fn();
const createPoolFn = vi.fn();

const standaloneQueryFn = vi.fn();
const standaloneEndFn = vi.fn();
const createConnectionFn = vi.fn();

vi.mock("mariadb", () => ({
  createPool: (...args: unknown[]) => createPoolFn(...args),
  createConnection: (...args: unknown[]) => createConnectionFn(...args),
}));

beforeEach(() => {
  for (const m of [
    queryFn,
    releaseFn,
    getConnectionFn,
    poolEndFn,
    createPoolFn,
    standaloneQueryFn,
    standaloneEndFn,
    createConnectionFn,
  ]) {
    m.mockReset();
  }
  getConnectionFn.mockResolvedValue({ query: queryFn, release: releaseFn });
  createPoolFn.mockReturnValue({ getConnection: getConnectionFn, end: poolEndFn });
  createConnectionFn.mockResolvedValue({ query: standaloneQueryFn, end: standaloneEndFn });
  process.env.MARIADB_URL = "mariadb://h:3306/db";
  process.env.MARIADB_USER = "u";
  process.env.MARIADB_PASSWORD = "p";
});

afterEach(() => {
  delete process.env.MARIADB_URL;
  delete process.env.MARIADB_USER;
  delete process.env.MARIADB_PASSWORD;
  delete process.env.LINEAR_API_KEY;
  vi.restoreAllMocks();
  // `restoreAllMocks` does NOT undo `vi.stubGlobal` — call this explicitly
  // so a fake `fetch` from the recover test doesn't bleed into later suites.
  vi.unstubAllGlobals();
});

const importMain = async () => (await import("../src/cli.js")).main;

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  return {
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
    restore: () => {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    },
  };
}

describe("vines triage", () => {
  it("activates for long task", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "triage", "--seconds", "60"]);
    out.restore();
    expect(rc).toBe(0);
    const payload = JSON.parse(out.stdout()) as { activate: boolean };
    expect(payload.activate).toBe(true);
  });

  it("does not activate for short task", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "triage", "--seconds", "5"]);
    out.restore();
    expect(rc).toBe(0);
    expect(JSON.parse(out.stdout()).activate).toBe(false);
  });

  it("counts repeated --domain flags", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "triage", "--seconds", "5", "--domain", "a", "b", "c"]);
    out.restore();
    expect(rc).toBe(0);
    expect(JSON.parse(out.stdout()).activate).toBe(true);
  });
});

describe("vines status", () => {
  it("prints empty message when ledger has no rows", async () => {
    queryFn.mockResolvedValueOnce([]);
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "status"]);
    out.restore();
    expect(rc).toBe(0);
    expect(out.stdout()).toContain("ledger empty");
  });

  it("prints rows in a table-ish layout", async () => {
    queryFn.mockResolvedValueOnce([
      {
        orchestration_id: "11111111-2222-3333-4444-555555555555",
        linear_parent_id: "ENG-1",
        objective_summary: "g",
        state: "success",
        last_agent_active: "code-agent",
        updated_at: new Date("2026-01-01T12:00:00Z"),
      },
    ]);
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "status", "--limit", "5"]);
    out.restore();
    expect(rc).toBe(0);
    expect(out.stdout()).toContain("success");
    expect(out.stdout()).toContain("ENG-1");
    expect(out.stdout()).toContain("code-agent");
  });

  it("returns 2 on bad --limit", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "status", "--limit", "-1"]);
    out.restore();
    expect(rc).toBe(2);
    expect(out.stderr()).toContain("--limit");
  });

  it("returns 4 on DB runtime error", async () => {
    queryFn.mockRejectedValueOnce(new Error("connection refused"));
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "status"]);
    out.restore();
    expect(rc).toBe(4);
    expect(out.stderr()).toMatch(/^db:/m);
  });

  it("returns 3 when error message starts with 'Linear '", async () => {
    queryFn.mockRejectedValueOnce(new Error("Linear API HTTP 401"));
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "status"]);
    out.restore();
    expect(rc).toBe(3);
    expect(out.stderr()).toMatch(/^linear:/m);
  });
});

describe("vines init-db", () => {
  it("applies schema and exits 0", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "init-db"]);
    out.restore();
    expect(rc).toBe(0);
    expect(createConnectionFn).toHaveBeenCalledOnce();
    expect(standaloneQueryFn).toHaveBeenCalled();
    const sql = standaloneQueryFn.mock.calls[0][0] as string;
    expect(sql).toContain("orchestration_ledger");
    expect(standaloneEndFn).toHaveBeenCalled();
    expect(out.stdout()).toContain("ok");
  });
});

describe("vines recover", () => {
  it("emits JSON envelope with totals", async () => {
    // listUnfinished returns one row, then listChildren responds via fetch.
    queryFn.mockResolvedValueOnce([
      {
        orchestration_id: "oid-1",
        linear_parent_id: "ENG-1",
        objective_summary: "g",
        state: "executing",
        last_agent_active: null,
        updated_at: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            issue: {
              id: "u-1",
              identifier: "ENG-1",
              title: "p",
              url: "u",
              state: { name: "In Progress" },
              parent: null,
            },
          },
        }),
      ),
    );
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            issue: {
              children: {
                nodes: [
                  {
                    id: "c1",
                    identifier: "ENG-2",
                    title: "a",
                    url: "u",
                    state: { name: "Done" },
                    parent: { id: "p" },
                  },
                  {
                    id: "c2",
                    identifier: "ENG-3",
                    title: "b",
                    url: "u",
                    state: { name: "Todo" },
                    parent: { id: "p" },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    process.env.LINEAR_API_KEY = "tok";
    // Inject the fetch shim through globalThis since the CLI constructs
    // LinearClient internally.
    vi.stubGlobal("fetch", fetchImpl);

    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "recover"]);
    out.restore();
    expect(rc).toBe(0);
    const payload = JSON.parse(out.stdout()) as {
      unfinishedTotal: number;
      resumableTotal: number;
      items: Array<{ lastCompletedChild: string | null; nextPendingChild: string | null }>;
    };
    expect(payload.unfinishedTotal).toBe(1);
    expect(payload.resumableTotal).toBe(1);
    expect(payload.items[0].lastCompletedChild).toBe("ENG-2");
    expect(payload.items[0].nextPendingChild).toBe("ENG-3");
  });
});

describe("vines start", () => {
  it("inserts a ledger row and prints the orchestration id", async () => {
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main([
      "node",
      "vines",
      "start",
      "--objective",
      "Stand up monitoring stack",
      "--linear-parent",
      "ENG-42",
      "--state",
      "planning",
      "--last-agent",
      "system-agent",
    ]);
    out.restore();
    expect(rc).toBe(0);
    const id = out.stdout().trim();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const insertCall = queryFn.mock.calls[0] as [string, unknown[]];
    expect(insertCall[0]).toContain("INSERT INTO orchestration_ledger");
    expect(insertCall[1][1]).toBe("ENG-42");
    expect(insertCall[1][2]).toBe("Stand up monitoring stack");
    expect(insertCall[1][3]).toBe("planning");
    expect(insertCall[1][4]).toBe("system-agent");
  });

  it("rejects blank --objective", async () => {
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "start", "--objective", "   "]);
    out.restore();
    expect(rc).toBe(2);
    expect(out.stderr()).toContain("--objective");
  });

  it("rejects invalid --state", async () => {
    const main = await importMain();
    const writeErr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const writeOut = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rc = await main(["node", "vines", "start", "--objective", "x", "--state", "nonsense"]);
    writeErr.mockRestore();
    writeOut.mockRestore();
    expect(rc).not.toBe(0);
  });

  it("defaults state to 'init' when --state is omitted", async () => {
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "start", "--objective", "x"]);
    out.restore();
    expect(rc).toBe(0);
    const insertCall = queryFn.mock.calls[0] as [string, unknown[]];
    expect(insertCall[1][3]).toBe("init");
  });
});

describe("vines set-state", () => {
  it("issues a state update and prints ok", async () => {
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main([
      "node",
      "vines",
      "set-state",
      "11111111-2222-3333-4444-555555555555",
      "executing",
      "--last-agent",
      "code-agent",
    ]);
    out.restore();
    expect(rc).toBe(0);
    expect(out.stdout()).toContain("→ executing");
    const updateCall = queryFn.mock.calls[0] as [string, unknown[]];
    expect(updateCall[0]).toMatch(/UPDATE orchestration_ledger/);
    expect(updateCall[1]).toEqual([
      "executing",
      "code-agent",
      "11111111-2222-3333-4444-555555555555",
    ]);
  });

  it("returns 2 if the orchestration id doesn't exist", async () => {
    queryFn.mockResolvedValueOnce({ affectedRows: 0 });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "set-state", "missing-id", "success"]);
    out.restore();
    expect(rc).toBe(2);
    expect(out.stderr()).toContain("missing-id");
  });

  it("rejects invalid <state> positional", async () => {
    const main = await importMain();
    const writeErr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const writeOut = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rc = await main(["node", "vines", "set-state", "id", "bogus"]);
    writeErr.mockRestore();
    writeOut.mockRestore();
    expect(rc).not.toBe(0);
  });
});

describe("vines attach-linear-parent", () => {
  it("updates the row and prints ok", async () => {
    queryFn.mockResolvedValueOnce({ affectedRows: 1 });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "attach-linear-parent", "oid-1", "ENG-9"]);
    out.restore();
    expect(rc).toBe(0);
    expect(out.stdout()).toMatch(/oid-1.*ENG-9/);
    const updateCall = queryFn.mock.calls[0] as [string, unknown[]];
    expect(updateCall[1]).toEqual(["ENG-9", "oid-1"]);
  });

  it("returns 2 if the orchestration id doesn't exist", async () => {
    queryFn.mockResolvedValueOnce({ affectedRows: 0 });
    const main = await importMain();
    const out = captureOutput();
    const rc = await main(["node", "vines", "attach-linear-parent", "missing", "ENG-9"]);
    out.restore();
    expect(rc).toBe(2);
  });
});

describe("vines help / unknown", () => {
  it("--help returns 0", async () => {
    const main = await importMain();
    const out = captureOutput();
    // commander writes help to stdout via exitOverride; suppress.
    const writeOut = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rc = await main(["node", "vines", "--help"]);
    writeOut.mockRestore();
    out.restore();
    expect(rc).toBe(0);
  });

  it("unknown command returns non-zero", async () => {
    const main = await importMain();
    const out = captureOutput();
    const writeErr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const rc = await main(["node", "vines", "totally-made-up"]);
    writeErr.mockRestore();
    out.restore();
    expect(rc).not.toBe(0);
  });
});
