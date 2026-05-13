import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above all imports, so any spies referenced by mock
// factories must come from `vi.hoisted` (also hoisted) to avoid TDZ errors.
const { queryMock, endMock, copyFileMock, mkdirMock, rmMock, statMock, execFileMock } = vi.hoisted(
  () => ({
    queryMock: vi.fn(async () => undefined),
    endMock: vi.fn(async () => undefined),
    copyFileMock: vi.fn(async () => undefined),
    mkdirMock: vi.fn(async () => undefined),
    rmMock: vi.fn(async () => undefined),
    statMock: vi.fn(async (_p: string) => {
      throw new Error("ENOENT");
    }),
    execFileMock: vi.fn((_bin: string, _args: string[], cb: (err: Error | null) => void) => {
      cb(null);
    }),
  }),
);

vi.mock("mariadb", () => ({
  createConnection: vi.fn(async () => ({ query: queryMock, end: endMock })),
}));

vi.mock("node:fs/promises", async () => {
  const actual = (await vi.importActual("node:fs/promises")) as Record<string, unknown>;
  return {
    ...actual,
    copyFile: copyFileMock,
    mkdir: mkdirMock,
    rm: rmMock,
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

// `MARIADB_PASSWORD` is read from env (plugin config no longer allows it).
const ORIGINAL_PASSWORD = process.env.MARIADB_PASSWORD;
process.env.MARIADB_PASSWORD = "test-password-from-env";

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

// Restore the original env var after the whole suite, so we don't pollute
// sibling tests.
import { afterAll } from "vitest";
afterAll(() => {
  if (ORIGINAL_PASSWORD === undefined) delete process.env.MARIADB_PASSWORD;
  else process.env.MARIADB_PASSWORD = ORIGINAL_PASSWORD;
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
      workspaceQueries += 1;
      if (workspaceQueries <= 2) return { isFile: () => false } as never;
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

  it("overlays AGENTS.md when the template exists in the package", async () => {
    statMock.mockImplementation(async (p: string) => {
      if (p.endsWith("AGENTS.md")) return { isFile: () => true } as never;
      throw new Error("ENOENT");
    });
    await runSetup({
      pluginConfig: PLUGIN_CONFIG,
      agentsBaseDir: "/tmp/agents-test",
      log,
    });
    // copyFile called once per specialist (6 total)
    expect(copyFileMock).toHaveBeenCalledTimes(6);
    // BOOTSTRAP.md is removed for every specialist
    expect(rmMock).toHaveBeenCalledTimes(6);
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
