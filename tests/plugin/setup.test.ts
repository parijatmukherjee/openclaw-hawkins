import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above all imports, so any spies referenced by mock
// factories must come from `vi.hoisted` (also hoisted) to avoid TDZ errors.
const { queryMock, endMock, copyFileMock, mkdirMock, renameMock, statMock, execFileMock } =
  vi.hoisted(() => ({
    queryMock: vi.fn(async () => undefined),
    endMock: vi.fn(async () => undefined),
    copyFileMock: vi.fn(async () => undefined),
    mkdirMock: vi.fn(async () => undefined),
    renameMock: vi.fn(async () => undefined),
    statMock: vi.fn(async (_p: string) => {
      throw new Error("ENOENT");
    }),
    execFileMock: vi.fn((_bin: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(null);
    }),
  }));

vi.mock("mariadb", () => ({
  createConnection: vi.fn(async () => ({ query: queryMock, end: endMock })),
}));

vi.mock("node:fs/promises", async () => {
  const actual = (await vi.importActual("node:fs/promises")) as Record<string, unknown>;
  return {
    ...actual,
    copyFile: copyFileMock,
    mkdir: mkdirMock,
    rename: renameMock,
    stat: statMock,
  };
});

vi.mock("node:child_process", async () => {
  const actual = (await vi.importActual("node:child_process")) as Record<string, unknown>;
  return { ...actual, execFile: execFileMock };
});

import { createConnection } from "mariadb";
import { defaultSpecialists, runSetup } from "../../src/plugin/setup.js";

const PLUGIN_CONFIG = {
  mariadb: {
    url: "mariadb://h:3306/d",
    user: "u",
  },
};

// `MARIADB_PASSWORD` is read by `loadDBConfig` (it's not part of the plugin
// configSchema), so the test sets a throwaway fixture value for it. This is a
// non-secret test constant, not a real credential.
const MARIADB_PASS_KEY = "MARIADB_PASSWORD";
const ORIGINAL_DB_PASS = process.env[MARIADB_PASS_KEY];
process.env[MARIADB_PASS_KEY] = "test-fixture";

const logs: string[] = [];
const log = (s: string) => logs.push(s);

beforeEach(() => {
  vi.clearAllMocks();
  logs.length = 0;
  statMock.mockImplementation(async (p: string) => {
    if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never;
    throw new Error("ENOENT");
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// Restore the original env var after the whole suite so we don't pollute
// sibling tests.
import { afterAll } from "vitest";
afterAll(() => {
  if (ORIGINAL_DB_PASS === undefined) delete process.env[MARIADB_PASS_KEY];
  else process.env[MARIADB_PASS_KEY] = ORIGINAL_DB_PASS;
});

describe("defaultSpecialists", () => {
  it("returns 6 canonical Tendrils", () => {
    const ids = defaultSpecialists().map((s) => s.id);
    expect(ids).toEqual([
      "system-agent",
      "code-agent",
      "research-agent",
      "data-agent",
      "comm-agent",
      "vision-agent",
    ]);
  });
});

describe("runSetup", () => {
  it("applies VINES + VECNA schemas in order", async () => {
    const result = await runSetup({
      pluginConfig: PLUGIN_CONFIG,
      skipAgents: true,
      log,
    });
    expect(result.schemasApplied).toEqual(["vines", "vecna"]);
    // createConnection called twice (once per schema file)
    expect(createConnection).toHaveBeenCalledTimes(2);
    // Each schema has at least one statement → query was called >= 2 times total
    expect(queryMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(endMock).toHaveBeenCalledTimes(2);
  });

  it("skipAgents=true exits before any agent work", async () => {
    const result = await runSetup({
      pluginConfig: PLUGIN_CONFIG,
      skipAgents: true,
      log,
    });
    expect(result.agentsCreated).toEqual([]);
    expect(result.agentsSkipped).toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("creates the 6 agents when none of their workspaces exist", async () => {
    statMock.mockImplementation(async (p: string) => {
      if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never;
      throw new Error("ENOENT"); // every workspace path is missing → create them
    });
    const result = await runSetup({
      pluginConfig: PLUGIN_CONFIG,
      agentsBaseDir: "/tmp/agents-test",
      log,
    });
    expect(result.agentsCreated).toEqual([
      "system-agent",
      "code-agent",
      "research-agent",
      "data-agent",
      "comm-agent",
      "vision-agent",
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(6);
    // Each call uses `openclaw agents add <id> --non-interactive ...`
    for (const call of execFileMock.mock.calls) {
      const [bin, args] = call as unknown as [string, string[]];
      expect(bin).toBe("openclaw");
      expect(args.slice(0, 3)).toEqual(["agents", "add", expect.any(String) as never]);
      expect(args).toContain("--non-interactive");
      expect(args).toContain("--workspace");
    }
  });

  it("skips agents whose workspace already exists", async () => {
    // First two workspace paths exist; the rest don't.
    // (HAWKINS_PROTOCOL.md path is checked separately by `installNexusProtocol`
    // before this loop runs — exclude it from the workspace counter.)
    let workspaceQueries = 0;
    statMock.mockImplementation(async (p: string) => {
      if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never;
      if (p.endsWith("HAWKINS_PROTOCOL.md")) throw new Error("ENOENT");
      // Count only the workspace-directory existence checks; other per-agent
      // stats (e.g. the BOOTSTRAP.md backup probe) must not skew the counter.
      if (p.endsWith("workspace")) {
        workspaceQueries += 1;
        if (workspaceQueries <= 2) return { isFile: () => false } as never;
        throw new Error("ENOENT");
      }
      throw new Error("ENOENT");
    });
    const result = await runSetup({
      pluginConfig: PLUGIN_CONFIG,
      agentsBaseDir: "/tmp/agents-test",
      log,
    });
    expect(result.agentsSkipped).toHaveLength(2);
    expect(result.agentsCreated).toHaveLength(4);
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });

  it("overlays AGENTS.md and retires BOOTSTRAP.md (with backup) on a fresh workspace", async () => {
    // Fresh workspace: the source template exists; the workspace's own AGENTS.md
    // does not yet exist, but `openclaw agents add` left a BOOTSTRAP.md behind.
    const underWorkspace = (p: string) => p.includes("/tmp/agents-test");
    statMock.mockImplementation(async (p: string) => {
      if (underWorkspace(p)) {
        if (p.endsWith("BOOTSTRAP.md")) return { isFile: () => true } as never; // present
        throw new Error("ENOENT"); // workspace dir + dest AGENTS.md absent
      }
      if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never; // source template
      throw new Error("ENOENT");
    });
    await runSetup({ pluginConfig: PLUGIN_CONFIG, agentsBaseDir: "/tmp/agents-test", log });
    // One overlay copy per specialist; no AGENTS.md backup (dest did not exist).
    expect(copyFileMock).toHaveBeenCalledTimes(6);
    // BOOTSTRAP.md is retired via rename to a .bak file (not deleted) per agent.
    expect(renameMock).toHaveBeenCalledTimes(6);
    for (const call of renameMock.mock.calls) {
      const [from, to] = call as unknown as [string, string];
      expect(from).toMatch(/BOOTSTRAP\.md$/);
      expect(to).toMatch(/BOOTSTRAP\.md\.bak\.\d+$/);
    }
  });

  it("backs up an existing AGENTS.md before overlaying it", async () => {
    // Re-run / existing workspace: the destination AGENTS.md already exists, so
    // it must be backed up (copied to .bak) before the overlay overwrites it.
    const underWorkspace = (p: string) => p.includes("/tmp/agents-test");
    statMock.mockImplementation(async (p: string) => {
      if (underWorkspace(p)) {
        if (p.endsWith("workspace")) throw new Error("ENOENT"); // dir absent → create
        if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never; // existing dest
        throw new Error("ENOENT"); // BOOTSTRAP absent here
      }
      if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never; // source template
      throw new Error("ENOENT");
    });
    await runSetup({ pluginConfig: PLUGIN_CONFIG, agentsBaseDir: "/tmp/agents-test", log });
    // Per specialist: 1 backup copy + 1 overlay copy = 12 total.
    expect(copyFileMock).toHaveBeenCalledTimes(12);
    const backupCopy = copyFileMock.mock.calls.find((c) =>
      /AGENTS\.md\.bak\.\d+$/.test(String((c as unknown as [string, string])[1])),
    );
    expect(backupCopy).toBeDefined();
    expect(logs.some((line) => line.includes("backed up AGENTS.md"))).toBe(true);
  });

  it("uses a custom openclaw binary path when provided", async () => {
    statMock.mockImplementation(async (p: string) => {
      if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never;
      throw new Error("ENOENT");
    });
    await runSetup({
      pluginConfig: PLUGIN_CONFIG,
      agentsBaseDir: "/tmp/agents-test",
      openclawBin: "/opt/openclaw/bin/openclaw",
      log,
    });
    for (const call of execFileMock.mock.calls) {
      const [bin] = call as unknown as [string, string[]];
      expect(bin).toBe("/opt/openclaw/bin/openclaw");
    }
  });

  it("installs HAWKINS_PROTOCOL.md into the Nexus workspace when missing", async () => {
    // AGENTS.md present (for the per-agent overlay); HAWKINS_PROTOCOL.md
    // source present (it's bundled), dst missing → should copy.
    statMock.mockImplementation(async (p: string) => {
      if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never;
      if (p.endsWith("orchestrator/HAWKINS_PROTOCOL.md")) {
        return { isFile: () => true } as never;
      }
      // The destination doesn't exist yet → triggers copy.
      throw new Error("ENOENT");
    });
    await runSetup({
      pluginConfig: PLUGIN_CONFIG,
      agentsBaseDir: "/tmp/agents-test",
      log,
    });
    // The protocol file is one of the copyFile targets.
    const protocolCopy = copyFileMock.mock.calls.find((c) =>
      String((c as unknown as [string, string])[1]).endsWith("HAWKINS_PROTOCOL.md"),
    );
    expect(protocolCopy).toBeDefined();
    expect(logs.some((line) => line.includes("installed Nexus protocol"))).toBe(true);
  });

  it("leaves an existing HAWKINS_PROTOCOL.md alone (no overwrite)", async () => {
    statMock.mockImplementation(async (p: string) => {
      if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never;
      // BOTH the bundled source AND the deployed copy exist — must NOT overwrite.
      if (p.endsWith("HAWKINS_PROTOCOL.md")) return { isFile: () => true } as never;
      throw new Error("ENOENT");
    });
    await runSetup({
      pluginConfig: PLUGIN_CONFIG,
      agentsBaseDir: "/tmp/agents-test",
      log,
    });
    const protocolCopy = copyFileMock.mock.calls.find((c) =>
      String((c as unknown as [string, string])[1]).endsWith("HAWKINS_PROTOCOL.md"),
    );
    expect(protocolCopy).toBeUndefined();
    expect(
      logs.some((line) => line.includes("left untouched") || line.includes("already exists")),
    ).toBe(true);
  });
});
