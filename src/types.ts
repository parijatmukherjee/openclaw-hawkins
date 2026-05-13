/**
 * Shared types for the VINES (Versatile Integration for Networked Execution & State).
 *
 * The wire-equivalent SQL ENUM for {@link LedgerState} is defined in
 * `vines/schema.sql`; if you add a value here, add it there too (and vice versa).
 */

/** Lifecycle state for an orchestration. See `vines/spec.md` §3.2 / §4.1. */
export type LedgerState = "init" | "planning" | "executing" | "success" | "failed";

/** Convenience: the three states that recovery considers "in flight". */
export const UNFINISHED_STATES: ReadonlyArray<LedgerState> = ["init", "planning", "executing"];

/** Specialist agent identifiers — must match the directory names under `agents/`. */
export type SpecialistId =
  | "research-agent"
  | "system-agent"
  | "code-agent"
  | "data-agent"
  | "comm-agent"
  | "vision-agent";

export const VALID_SPECIALISTS: ReadonlySet<SpecialistId> = new Set<SpecialistId>([
  "research-agent",
  "system-agent",
  "code-agent",
  "data-agent",
  "comm-agent",
  "vision-agent",
]);

/** One row in the `orchestration_ledger` table. */
export interface OrchestrationRow {
  orchestrationId: string;
  linearParentId: string | null;
  objectiveSummary: string;
  state: LedgerState;
  lastAgentActive: string | null;
  updatedAt: Date;
}

/** A minimal projection of a Linear issue used inside VINES. */
export interface LinearIssue {
  id: string; // UUID
  identifier: string; // ENG-42 style
  title: string;
  stateName: string;
  url: string;
  parentId: string | null;
}

/** A planned sub-task that the orchestrator will dispatch to a specialist. */
export interface SubTask {
  title: string;
  agent: SpecialistId;
  message: string;
  timeoutSeconds: number; // default 300, applied by the planner if omitted
}

/** Result of a single specialist dispatch. */
export interface DispatchResult {
  agent: SpecialistId;
  status: "ok" | "failed" | "timeout" | "unreachable";
  text: string; // empty on failure
  durationMs: number | null;
  raw: Record<string, unknown>; // full JSON envelope (empty on transport failure)
}

/** Per-sub-task outcome inside an {@link OrchestrationResult}. */
export interface SubTaskOutcome {
  subTask: SubTask;
  linearIssue: LinearIssue | null;
  dispatch: DispatchResult | null;
  verified: boolean;
}

/** End-of-run report from {@link Orchestrator.run}. */
export interface OrchestrationResult {
  orchestrationId: string;
  linearParentId: string | null;
  objective: string;
  outcomes: SubTaskOutcome[];
  finalState: LedgerState;
  summary: string;
}
