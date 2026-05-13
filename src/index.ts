/**
 * openclaw-hawkins — VINES.
 *
 * The default entry point exposes the library API. The CLI lives at
 * `./cli.js` and is wired through the `bin` field in `package.json`.
 *
 * See `vines/spec.md` for the contract this package implements.
 */

export {
  loadDBConfig,
  loadLinearApiKey,
  sslOptionFor,
  type DBConfig,
  type SslMode,
} from "./config.js";

export { Ledger } from "./persistence.js";
export { LinearClient, LINEAR_GRAPHQL_ENDPOINT } from "./linear-client.js";
export { dispatchSpecialist, parseEnvelope } from "./dispatcher.js";
export {
  Orchestrator,
  triage,
  subTask,
  type DispatchFn,
  type OrchestratorOptions,
  type Planner,
  type RunOptions,
  type TriageDecision,
} from "./orchestrator.js";
export {
  scanRecovery,
  resumable,
  orphaned,
  isResumable,
  isLinearOrphaned,
  markFailedIfOrphaned,
  DEFAULT_DONE_STATE_NAMES,
  type RecoveryItem,
  type RecoveryReport,
} from "./recovery.js";
export {
  UNFINISHED_STATES,
  VALID_SPECIALISTS,
  type DispatchResult,
  type LedgerState,
  type LinearIssue,
  type OrchestrationResult,
  type OrchestrationRow,
  type SpecialistId,
  type SubTask,
  type SubTaskOutcome,
} from "./types.js";
