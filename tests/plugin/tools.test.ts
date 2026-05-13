import { describe, expect, it, vi } from "vitest";
import type { LinearClient } from "../../src/linear-client.js";
import type { Ledger } from "../../src/persistence.js";
import type { HiveStore } from "../../src/hive/store.js";
import type { Fragment } from "../../src/hive/types.js";
import type { HawkinsServices } from "../../src/plugin/services.js";
import {
  createAllTools,
  makeVecnaConnectTool,
  makeVecnaEvolveTool,
  makeVecnaFragmentTool,
  makeVecnaHealthzTool,
  makeVecnaRecallTool,
  makeVecnaSearchTool,
  makeVinesAttachLinearParentTool,
  makeVinesRecoverTool,
  makeVinesSetStateTool,
  makeVinesStartTool,
  makeVinesStatusTool,
  makeVinesTriageTool,
} from "../../src/plugin/tools.js";

function readJson<T>(result: { content: { type: string; text: string }[] }): T {
  return JSON.parse(result.content[0]!.text) as T;
}

interface FakeServicesOverrides {
  ledger?: Partial<Ledger>;
  hive?: Partial<HiveStore>;
  linear?: LinearClient | null;
}

function fakeServices(overrides: FakeServicesOverrides = {}): HawkinsServices {
  const ledger = {
    create: vi.fn(async () => "oid-1"),
    get: vi.fn(async () => ({
      orchestrationId: "oid-1",
      linearParentId: null,
      objectiveSummary: "x",
      state: "init" as const,
      lastAgentActive: null,
      updatedAt: new Date(),
    })),
    setState: vi.fn(async () => true),
    attachLinearParent: vi.fn(async () => true),
    listUnfinished: vi.fn(async () => []),
    close: vi.fn(async () => undefined),
    ...overrides.ledger,
  } as unknown as Ledger;

  const fragment: Fragment = {
    fragmentId: "frag-1",
    topic: "t",
    subTopic: null,
    content: "c",
    sourceAgent: "system-agent",
    importance: 3,
    linearTicketRef: null,
    isDeprecated: false,
    createdAt: new Date(),
  };
  const hive = {
    connect: vi.fn(async () => ({ fragment, deduplicated: false })),
    recall: vi.fn(async () => [fragment]),
    search: vi.fn(async () => [fragment]),
    getFragment: vi.fn(async () => fragment),
    evolve: vi.fn(async () => ({
      deprecated: { ...fragment, isDeprecated: true },
      replacement: { ...fragment, fragmentId: "frag-2", content: "new" },
    })),
    ping: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
    ...overrides.hive,
  } as unknown as HiveStore;

  const linearOverride = overrides.linear;
  return {
    get ledger() {
      return ledger;
    },
    get hive() {
      return hive;
    },
    getLinear: () => linearOverride ?? null,
    close: async () => undefined,
  };
}

describe("VINES tools", () => {
  it("vines_triage creates a ledger row and returns its id + state", async () => {
    const svc = fakeServices();
    const tool = makeVinesTriageTool(svc);
    const result = await tool.execute("t-1", { objectiveSummary: "ship feature" });
    const parsed = readJson<{ orchestrationId: string; state: string }>(result);
    expect(parsed.orchestrationId).toBe("oid-1");
    expect(parsed.state).toBe("init");
    expect(svc.ledger.create).toHaveBeenCalledWith(
      expect.objectContaining({ objectiveSummary: "ship feature" }),
    );
  });

  it("vines_triage passes explicit orchestrationId through", async () => {
    const svc = fakeServices();
    const tool = makeVinesTriageTool(svc);
    await tool.execute("t-1", { objectiveSummary: "x", orchestrationId: "custom-id" });
    expect(svc.ledger.create).toHaveBeenCalledWith(
      expect.objectContaining({ orchestrationId: "custom-id" }),
    );
  });

  it("vines_start transitions to executing", async () => {
    const svc = fakeServices();
    const tool = makeVinesStartTool(svc);
    const result = await tool.execute("t-1", { orchestrationId: "oid-1" });
    const parsed = readJson<{ ok: boolean; state: string }>(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.state).toBe("executing");
    expect(svc.ledger.setState).toHaveBeenCalledWith("oid-1", "executing", {
      lastAgentActive: null,
    });
  });

  it("vines_set_state writes the requested state", async () => {
    const svc = fakeServices();
    const tool = makeVinesSetStateTool(svc);
    await tool.execute("t-1", {
      orchestrationId: "oid-1",
      state: "success",
      lastAgentActive: "code-agent",
    });
    expect(svc.ledger.setState).toHaveBeenCalledWith("oid-1", "success", {
      lastAgentActive: "code-agent",
    });
  });

  it("vines_attach_linear_parent updates the linear id", async () => {
    const svc = fakeServices();
    const tool = makeVinesAttachLinearParentTool(svc);
    const result = await tool.execute("t-1", {
      orchestrationId: "oid-1",
      linearParentId: "ENG-42",
    });
    const parsed = readJson<{ ok: boolean; linearParentId: string }>(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.linearParentId).toBe("ENG-42");
    expect(svc.ledger.attachLinearParent).toHaveBeenCalledWith("oid-1", "ENG-42");
  });

  it("vines_status returns the ledger row", async () => {
    const svc = fakeServices();
    const tool = makeVinesStatusTool(svc);
    const result = await tool.execute("t-1", { orchestrationId: "oid-1" });
    const parsed = readJson<{ row: { orchestrationId: string } }>(result);
    expect(parsed.row.orchestrationId).toBe("oid-1");
  });

  it("vines_recover reports linearAvailable=false when no Linear client", async () => {
    const svc = fakeServices({ linear: null });
    const tool = makeVinesRecoverTool(svc);
    const result = await tool.execute("t-1", {});
    const parsed = readJson<{ summary: { linearAvailable: boolean; scanned: number } }>(result);
    expect(parsed.summary.linearAvailable).toBe(false);
    expect(parsed.summary.scanned).toBe(0);
  });

  it("vines_recover scans with Linear when available", async () => {
    const linear = {
      getIssue: vi.fn().mockResolvedValue(null),
      listChildren: vi.fn().mockResolvedValue([]),
    } as unknown as LinearClient;
    const svc = fakeServices({
      ledger: {
        listUnfinished: vi.fn(async () => [
          {
            orchestrationId: "oid-1",
            linearParentId: "ENG-1",
            objectiveSummary: "x",
            state: "executing" as const,
            lastAgentActive: null,
            updatedAt: new Date(),
          },
        ]),
      },
      linear,
    });
    const tool = makeVinesRecoverTool(svc);
    const result = await tool.execute("t-1", {});
    const parsed = readJson<{ summary: { scanned: number; orphaned: number } }>(result);
    expect(parsed.summary.scanned).toBe(1);
    expect(parsed.summary.orphaned).toBe(1); // getIssue null → orphaned
  });

  it("vines_recover with markOrphanedAsFailed promotes orphans to failed", async () => {
    const linear = {
      getIssue: vi.fn().mockResolvedValue(null),
      listChildren: vi.fn().mockResolvedValue([]),
    } as unknown as LinearClient;
    const setState = vi.fn(async () => true);
    const svc = fakeServices({
      ledger: {
        setState,
        listUnfinished: vi.fn(async () => [
          {
            orchestrationId: "oid-1",
            linearParentId: "ENG-1",
            objectiveSummary: "x",
            state: "executing" as const,
            lastAgentActive: null,
            updatedAt: new Date(),
          },
        ]),
      },
      linear,
    });
    const tool = makeVinesRecoverTool(svc);
    const result = await tool.execute("t-1", { markOrphanedAsFailed: true });
    const parsed = readJson<{ summary: { markedFailed: number } }>(result);
    expect(parsed.summary.markedFailed).toBe(1);
    expect(setState).toHaveBeenCalledWith("oid-1", "failed");
  });
});

describe("VECNA tools", () => {
  it("vecna_connect writes a fragment", async () => {
    const svc = fakeServices();
    const tool = makeVecnaConnectTool(svc);
    await tool.execute("t-1", {
      topic: "mariadb",
      content: "tuning fix",
      sourceAgent: "system-agent",
      importance: 4,
    });
    expect(svc.hive.connect).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "mariadb", importance: 4 }),
    );
  });

  it("vecna_recall returns json by default", async () => {
    const svc = fakeServices();
    const tool = makeVecnaRecallTool(svc);
    const result = await tool.execute("t-1", { topic: "mariadb" });
    const parsed = readJson<{ fragments: Fragment[] }>(result);
    expect(parsed.fragments).toHaveLength(1);
  });

  it("vecna_recall with format=context returns a pre-summarised string", async () => {
    const svc = fakeServices();
    const tool = makeVecnaRecallTool(svc);
    const result = await tool.execute("t-1", { topic: "mariadb", format: "context" });
    expect(result.content[0]!.text).toContain("[vecna]");
    expect(result.content[0]!.text).toContain("fragment(s) for");
  });

  it("vecna_recall context format reports empty results", async () => {
    const svc = fakeServices({ hive: { recall: vi.fn(async () => []) } });
    const tool = makeVecnaRecallTool(svc);
    const result = await tool.execute("t-1", { topic: "unknown", format: "context" });
    expect(result.content[0]!.text).toContain("no fragments for topic");
  });

  it("vecna_recall passes ticket + limit through when set", async () => {
    const svc = fakeServices();
    const tool = makeVecnaRecallTool(svc);
    await tool.execute("t-1", { topic: "x", ticket: "ENG-1", limit: 10 });
    expect(svc.hive.recall).toHaveBeenCalledWith("x", { ticket: "ENG-1", limit: 10 });
  });

  it("vecna_evolve calls HiveStore.evolve with content", async () => {
    const svc = fakeServices();
    const tool = makeVecnaEvolveTool(svc);
    const result = await tool.execute("t-1", { fragmentId: "frag-1", content: "new" });
    const parsed = readJson<{ replacement: Fragment }>(result);
    expect(parsed.replacement.content).toBe("new");
  });

  it("vecna_search delegates to HiveStore.search", async () => {
    const svc = fakeServices();
    const tool = makeVecnaSearchTool(svc);
    await tool.execute("t-1", { query: "tuning" });
    expect(svc.hive.search).toHaveBeenCalledWith("tuning", undefined);
  });

  it("vecna_fragment fetches one by id", async () => {
    const svc = fakeServices();
    const tool = makeVecnaFragmentTool(svc);
    const result = await tool.execute("t-1", { fragmentId: "frag-1" });
    const parsed = readJson<{ fragment: Fragment | null }>(result);
    expect(parsed.fragment?.fragmentId).toBe("frag-1");
  });

  it("vecna_healthz reports db=up when ping succeeds", async () => {
    const svc = fakeServices();
    const tool = makeVecnaHealthzTool(svc);
    const result = await tool.execute("t-1", {});
    const parsed = readJson<{ ok: boolean; db: string }>(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.db).toBe("up");
  });

  it("vecna_healthz reports db=down when ping fails", async () => {
    const svc = fakeServices({ hive: { ping: vi.fn(async () => false) } });
    const tool = makeVecnaHealthzTool(svc);
    const result = await tool.execute("t-1", {});
    const parsed = readJson<{ ok: boolean; db: string }>(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.db).toBe("down");
  });
});

describe("createAllTools", () => {
  it("returns exactly 12 tools in the canonical order", () => {
    const tools = createAllTools(fakeServices());
    expect(tools.map((t) => t.name)).toEqual([
      "vines_triage",
      "vines_start",
      "vines_set_state",
      "vines_attach_linear_parent",
      "vines_recover",
      "vines_status",
      "vecna_connect",
      "vecna_recall",
      "vecna_evolve",
      "vecna_search",
      "vecna_fragment",
      "vecna_healthz",
    ]);
  });

  it("every tool carries a TypeBox parameter schema", () => {
    for (const tool of createAllTools(fakeServices())) {
      expect(tool.parameters).toBeDefined();
      expect((tool.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("every tool sets a non-empty label + description", () => {
    for (const tool of createAllTools(fakeServices())) {
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});
