/**
 * openclaw-hawkins — public API surface.
 *
 * Two subsystems live in this package:
 *
 *   - VINES — durable orchestration state. See `vines/spec.md`.
 *   - VECNA — Hive knowledge service. See `vecna/spec.md`.
 *
 * The CLIs (`vines`, `vecna`) are wired via the `bin` field in
 * `package.json`. Node embedders import the classes below.
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

// VECNA Hive — knowledge service.
export { HiveStore } from "./hive/store.js";
export { HiveTendril } from "./hive/client.js";
export { createServer as createHiveServer } from "./hive/server.js";
export { loadVecnaServerConfig, loadVecnaClientConfig } from "./hive/config.js";
export {
  isImportance,
  type ConnectInput,
  type ConnectResult,
  type EvolveInput,
  type EvolveResult,
  type Fragment,
  type Importance,
  type RecallOptions,
} from "./hive/types.js";
