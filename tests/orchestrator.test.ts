import { describe, expect, it, vi } from "vitest";
import type { DispatchFn } from "../src/orchestrator.js";
import { Orchestrator, subTask, triage } from "../src/orchestrator.js";
import type { Ledger } from "../src/persistence.js";
import type { LinearClient } from "../src/linear-client.js";
import type { DispatchResult, LinearIssue, SpecialistId, SubTask } from "../src/types.js";

// ---------------------------------------------------------------------------
// Triage (spec §3.1)
// ---------------------------------------------------------------------------

describe("triage", () => {
  it("activates when estimatedSeconds > 30", () => {
    const d = triage(45, ["system-agent"]);
    expect(d.activate).toBe(true);
    expect(d.reason).toContain("estimatedSeconds");
  });

  it("activates when distinct domains > 2", () => {
    const d = triage(10, ["a", "b", "c"]);
    expect(d.activate).toBe(true);
    expect(d.reason).toContain("distinctDomains");
  });

  it("does not activate for short + two domains", () => {
    expect(triage(5, ["a", "b"]).activate).toBe(false);
  });

  it("uses strict > on seconds boundary", () => {
    expect(triage(30, []).activate).toBe(false);
    expect(triage(31, []).activate).toBe(true);
  });

  it("uses strict > on domain count boundary", () => {
    expect(triage(0, ["a", "b"]).activate).toBe(false);
    expect(triage(0, ["a", "b", "c"]).activate).toBe(true);
  });

  it("deduplicates domain ids", () => {
    expect(triage(0, ["a", "a", "b"]).activate).toBe(false);
  });

  it("drops falsy domains", () => {
    expect(triage(0, ["", "a"]).activate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// subTask
// ---------------------------------------------------------------------------

describe("subTask", () => {
  it("defaults timeoutSeconds to 300", () => {
    const st = subTask({ title: "t", agent: "code-agent", message: "m" });
    expect(st.timeoutSeconds).toBe(300);
  });

  it("rejects unknown specialist", () => {
    expect(() => subTask({ title: "t", agent: "nope" as SpecialistId, message: "m" })).toThrow(
      /unknown specialist/,
    );
  });
});

// ---------------------------------------------------------------------------
// Orchestrator.run
// ---------------------------------------------------------------------------

function issue(idx: number, parentId: string | null = null): LinearIssue {
  return {
    id: `uuid-${idx}`,
    identifier: `ENG-${idx}`,
    title: `t-${idx}`,
    stateName: "Todo",
    url: `https://linear.app/i/${idx}`,
    parentId,
  };
}

function dispatchResult(text = "result", status: DispatchResult["status"] = "ok"): DispatchResult {
  return { agent: "system-agent", status, text, durationMs: 10, raw: {} };
}

function fakeLedger() {
  const ledger = {
    create: vi.fn().mockResolvedValue("oid-1"),
    setState: vi.fn().mockResolvedValue(true),
    get: vi.fn(),
    attachLinearParent: vi.fn(),
    listUnfinished: vi.fn(),
    listRecent: vi.fn(),
    close: vi.fn(),
  };
  return ledger as unknown as Ledger & typeof ledger;
}

function fakeLinear() {
  const linear = {
    createIssue: vi.fn().mockImplementation((args: { parentId?: string }) => {
      return Promise.resolve(args.parentId ? issue(2, "uuid-1") : issue(1));
    }),
    comment: vi.fn().mockResolvedValue(undefined),
    setState: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn(),
    listChildren: vi.fn(),
    query: vi.fn(),
  };
  return linear as unknown as LinearClient & typeof linear;
}

function buildOrchestrator(
  opts: {
    dispatchOutcomes?: DispatchResult[];
    doneStateId?: string;
  } = {},
) {
  const ledger = fakeLedger();
  const linear = fakeLinear();
  const outcomes = [...(opts.dispatchOutcomes ?? [dispatchResult()])];
  const dispatch: DispatchFn = vi
    .fn()
    .mockImplementation(() => Promise.resolve(outcomes.shift() ?? dispatchResult()));
  const orch = new Orchestrator({
    ledger,
    linear,
    linearTeamId: "team-uuid",
    linearDoneStateId: opts.doneStateId ?? "done-uuid",
    dispatch,
  });
  return { orch, ledger, linear, dispatch };
}

const planner = () =>
  [
    {
      title: "do x",
      agent: "system-agent",
      message: "execute x",
      timeoutSeconds: 300,
    },
  ] satisfies SubTask[];

describe("Orchestrator happy paths", () => {
  it("success transitions: planning → executing → success", async () => {
    const { orch, ledger } = buildOrchestrator();
    const result = await orch.run({
      objective: "Install thing",
      planner,
      researchBrief: "brief",
    });
    expect(result.finalState).toBe("success");
    expect(result.orchestrationId).toBe("oid-1");
    expect(result.linearParentId).toBe("ENG-1");
    const states = ledger.setState.mock.calls.map((c) => c[1] as string);
    expect(states[0]).toBe("executing");
    expect(states.at(-1)).toBe("success");
  });

  it("summary lists every sub-task with marker", async () => {
    const { orch } = buildOrchestrator();
    const result = await orch.run({ objective: "goal", planner, researchBrief: "b" });
    expect(result.summary).toContain("goal");
    expect(result.summary).toContain("[system-agent]");
    expect(result.summary).toContain("✓");
  });

  it("transitions both parent and child to done", async () => {
    const { orch, linear } = buildOrchestrator();
    await orch.run({ objective: "goal", planner, researchBrief: "b" });
    expect(linear.setState).toHaveBeenCalledTimes(2);
  });

  it("skips state transitions when doneStateId omitted", async () => {
    const ledger = fakeLedger();
    const linear = fakeLinear();
    const dispatch: DispatchFn = vi.fn().mockResolvedValue(dispatchResult());
    const orch = new Orchestrator({
      ledger,
      linear,
      linearTeamId: "T",
      dispatch,
    });
    await orch.run({ objective: "g", planner, researchBrief: "b" });
    expect(linear.setState).not.toHaveBeenCalled();
  });
});

describe("Orchestrator research gate", () => {
  it("skips dispatch when 'no research' marker present", async () => {
    const { orch, dispatch } = buildOrchestrator();
    await orch.run({ objective: "quick — no research needed", planner });
    const agents = (dispatch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(agents).not.toContain("research-agent");
  });

  it("skips dispatch when explicit brief supplied", async () => {
    const { orch, dispatch } = buildOrchestrator();
    await orch.run({ objective: "goal", planner, researchBrief: "pre-brief" });
    const agents = (dispatch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(agents).not.toContain("research-agent");
  });

  it("dispatches research-agent and posts brief to parent", async () => {
    const { orch, linear } = buildOrchestrator({
      dispatchOutcomes: [dispatchResult("research output"), dispatchResult("ok")],
    });
    await orch.run({ objective: "research this", planner });
    const commentBodies = linear.comment.mock.calls.map((c) => c[1] as string);
    expect(commentBodies.some((b) => b.startsWith("Research brief:"))).toBe(true);
  });

  it("research failure does not block the run", async () => {
    const { orch } = buildOrchestrator({
      dispatchOutcomes: [dispatchResult("", "failed"), dispatchResult("ok")],
    });
    const result = await orch.run({ objective: "needs research", planner });
    expect(result.finalState).toBe("success");
  });
});

describe("Orchestrator failure paths", () => {
  it("empty plan marks orchestration failed", async () => {
    const { orch } = buildOrchestrator();
    const result = await orch.run({
      objective: "g",
      planner: () => [],
      researchBrief: "b",
    });
    expect(result.finalState).toBe("failed");
    expect(result.summary).toContain("no sub-tasks");
  });

  it("subtask failure halts execution at the first failure", async () => {
    const { orch } = buildOrchestrator({
      dispatchOutcomes: [dispatchResult("", "failed")],
    });
    const result = await orch.run({
      objective: "goal",
      planner: () => [
        subTask({ title: "first", agent: "system-agent", message: "a" }),
        subTask({ title: "second", agent: "code-agent", message: "b" }),
      ],
      researchBrief: "b",
    });
    expect(result.finalState).toBe("failed");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].verified).toBe(false);
  });

  it("ok status with empty text counts as unverified", async () => {
    const { orch } = buildOrchestrator({
      dispatchOutcomes: [dispatchResult("   ")],
    });
    const result = await orch.run({ objective: "g", planner, researchBrief: "b" });
    expect(result.finalState).toBe("failed");
  });

  it("posts unverified comment on the child ticket", async () => {
    const { orch, linear } = buildOrchestrator({
      dispatchOutcomes: [dispatchResult("partial garbage", "failed")],
    });
    await orch.run({ objective: "g", planner, researchBrief: "b" });
    const bodies = linear.comment.mock.calls.map((c) => c[1] as string);
    expect(bodies.some((b) => b.includes("did not verify"))).toBe(true);
  });
});
