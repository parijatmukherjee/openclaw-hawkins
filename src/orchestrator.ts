/**
 * Protocol engine — `aso/spec.md` §3.
 *
 *  - §3.1 Triage — decide whether an objective qualifies for the protocol.
 *  - §3.2 Workflow — drive the 7-step sequence end-to-end, recording
 *    transitions in both Linear (ground truth for sub-task state) and the
 *    ledger (recovery anchor).
 *
 * Collaborators are injected so the protocol can be unit-tested with fakes.
 */

import type { Ledger } from "./persistence.js";
import type { LinearClient } from "./linear-client.js";
import { VALID_SPECIALISTS } from "./types.js";
import type {
  DispatchResult,
  LinearIssue,
  OrchestrationResult,
  SpecialistId,
  SubTask,
  SubTaskOutcome,
} from "./types.js";

/** Signature for the dispatch primitive the orchestrator depends on. */
export type DispatchFn = (
  agent: SpecialistId,
  message: string,
  timeoutSeconds: number,
) => Promise<DispatchResult>;

// ---------------------------------------------------------------------------
// Triage (spec §3.1)
// ---------------------------------------------------------------------------

export interface TriageDecision {
  activate: boolean;
  reason: string;
}

/**
 * Activate the protocol when **estimated > 30 seconds** *or* **distinct agent
 * domains > 2**. Both conditions are strict inequalities, per the spec text
 * "*more than* 30 seconds" / "*more than* two".
 */
export function triage(estimatedSeconds: number, agentDomains: readonly string[]): TriageDecision {
  const distinct = new Set(agentDomains.filter((d): d is string => Boolean(d))).size;
  if (estimatedSeconds > 30) {
    return { activate: true, reason: `estimatedSeconds=${estimatedSeconds} > 30` };
  }
  if (distinct > 2) {
    return { activate: true, reason: `distinctDomains=${distinct} > 2` };
  }
  return { activate: false, reason: "below activation threshold" };
}

// ---------------------------------------------------------------------------
// Sub-task helpers
// ---------------------------------------------------------------------------

/**
 * Construct a {@link SubTask}, validating the specialist id at the call site
 * so we surface programmer errors early.
 */
export function subTask(args: {
  title: string;
  agent: SpecialistId;
  message: string;
  timeoutSeconds?: number;
}): SubTask {
  if (!VALID_SPECIALISTS.has(args.agent)) {
    throw new Error(`unknown specialist: ${args.agent}`);
  }
  return {
    title: args.title,
    agent: args.agent,
    message: args.message,
    timeoutSeconds: args.timeoutSeconds ?? 300,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  ledger: Ledger;
  linear: LinearClient;
  /** Linear team UUID — `linear.team.id` from the API. */
  linearTeamId: string;
  /** Linear workflow-state UUID for "done" (e.g. the team's `Done` state). */
  linearDoneStateId?: string;
  /** Override the default dispatch (used by tests). */
  dispatch: DispatchFn;
}

/** Returns the planned sub-task list for the §3.2 step 4 "Strategic Planning". */
export type Planner = (
  objective: string,
  researchBrief: string | null,
) => SubTask[] | Promise<SubTask[]>;

export interface RunOptions {
  objective: string;
  planner: Planner;
  /**
   * If provided, the orchestrator skips the §3.2 step 3 research gate and
   * uses this string as the research brief.
   */
  researchBrief?: string;
}

/**
 * The orchestrator. Construct once per long-lived process; call {@link run}
 * for each operator request.
 */
export class Orchestrator {
  private readonly ledger: Ledger;
  private readonly linear: LinearClient;
  private readonly teamId: string;
  private readonly doneStateId: string | undefined;
  private readonly dispatch: DispatchFn;

  constructor(opts: OrchestratorOptions) {
    this.ledger = opts.ledger;
    this.linear = opts.linear;
    this.teamId = opts.linearTeamId;
    this.doneStateId = opts.linearDoneStateId;
    this.dispatch = opts.dispatch;
  }

  /** Execute the §3.2 workflow end-to-end for one operator request. */
  async run(opts: RunOptions): Promise<OrchestrationResult> {
    // Step 1 + 2: create the parent ticket and the ledger row.
    const parent = await this.linear.createIssue({
      teamId: this.teamId,
      title: opts.objective.slice(0, 255),
      description: opts.objective,
    });
    const orchestrationId = await this.ledger.create({
      objectiveSummary: opts.objective,
      linearParentId: parent.identifier,
      state: "planning",
    });

    const result: OrchestrationResult = {
      orchestrationId,
      linearParentId: parent.identifier,
      objective: opts.objective,
      outcomes: [],
      finalState: "planning",
      summary: "",
    };

    // Step 3: research gate.
    const brief = opts.researchBrief ?? (await this.researchGate(parent, opts.objective));

    // Step 4: plan.
    const subTasks = await opts.planner(opts.objective, brief);
    if (subTasks.length === 0) {
      await this.ledger.setState(orchestrationId, "failed");
      result.finalState = "failed";
      result.summary = "planner returned no sub-tasks";
      return result;
    }

    // Step 5 + 6: dispatch + sync each sub-task.
    await this.ledger.setState(orchestrationId, "executing");
    let allOk = true;
    for (const st of subTasks) {
      const outcome = await this.runSubTask(parent, st, orchestrationId);
      result.outcomes.push(outcome);
      if (!outcome.verified) {
        allOk = false;
        break; // halt on first failure; recovery can resume
      }
    }

    // Step 7: final report.
    const summary = summarise(result);
    if (allOk) {
      await this.linear.comment(parent.id, summary);
      if (this.doneStateId) await this.linear.setState(parent.id, this.doneStateId);
      await this.ledger.setState(orchestrationId, "success");
      result.finalState = "success";
    } else {
      await this.ledger.setState(orchestrationId, "failed");
      result.finalState = "failed";
    }
    result.summary = summary;
    return result;
  }

  // ----- step helpers -------------------------------------------------------

  private async researchGate(parent: LinearIssue, objective: string): Promise<string | null> {
    const lower = objective.toLowerCase();
    if (lower.includes("no research") || lower.includes("skip research")) {
      return null;
    }
    const out = await this.dispatch("research-agent", `Research brief for: ${objective}`, 300);
    if (out.status === "ok" && out.text.trim()) {
      await this.linear.comment(parent.id, `Research brief:\n\n${out.text}`);
      return out.text;
    }
    return null;
  }

  private async runSubTask(
    parent: LinearIssue,
    st: SubTask,
    orchestrationId: string,
  ): Promise<SubTaskOutcome> {
    const child = await this.linear.createIssue({
      teamId: this.teamId,
      title: `[${st.agent}] ${st.title}`.slice(0, 255),
      description: st.message,
      parentId: parent.id,
    });
    await this.ledger.setState(orchestrationId, "executing", { lastAgentActive: st.agent });

    const dispatchResult = await this.dispatch(st.agent, st.message, st.timeoutSeconds);
    const verified = dispatchResult.status === "ok" && dispatchResult.text.trim().length > 0;

    if (verified) {
      await this.linear.comment(child.id, dispatchResult.text.slice(0, 4000));
      if (this.doneStateId) await this.linear.setState(child.id, this.doneStateId);
    } else {
      await this.linear.comment(
        child.id,
        `Dispatch did not verify (status=${dispatchResult.status}). ` +
          `Truncated reply: ${dispatchResult.text.slice(0, 1000)}`,
      );
    }
    return { subTask: st, linearIssue: child, dispatch: dispatchResult, verified };
  }
}

function summarise(result: OrchestrationResult): string {
  const lines = [`Objective: ${result.objective}`];
  for (const outcome of result.outcomes) {
    const mark = outcome.verified ? "✓" : "✗";
    const ident = outcome.linearIssue?.identifier ?? "?";
    lines.push(`  ${mark} ${ident} [${outcome.subTask.agent}] ${outcome.subTask.title}`);
  }
  return lines.join("\n");
}
