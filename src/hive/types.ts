/**
 * Shared types for the VECNA Hive subsystem.
 *
 * The SQL ENUM-like constraints (importance 1–5, agent ids) are enforced
 * in code; the column types are deliberately liberal so the schema stays
 * portable. See `vecna/spec.md` §3 for the contract.
 */

/** Importance is the spec's 1 (transient) → 5 (vital) scale. */
export type Importance = 1 | 2 | 3 | 4 | 5;

export function isImportance(value: unknown): value is Importance {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/** One row in the `vecna_hive` table. */
export interface Fragment {
  fragmentId: string;
  topic: string;
  subTopic: string | null;
  content: string;
  sourceAgent: string;
  importance: Importance;
  linearTicketRef: string | null;
  isDeprecated: boolean;
  createdAt: Date;
}

/** Body shape for `POST /v1/connect`. */
export interface ConnectInput {
  topic: string;
  content: string;
  sourceAgent: string;
  subTopic?: string | null;
  importance?: Importance;
  linearRef?: string | null;
}

/** Result of `connect` — `deduplicated: true` means the existing row was returned. */
export interface ConnectResult {
  fragment: Fragment;
  deduplicated: boolean;
}

/** Query options for `recall`. */
export interface RecallOptions {
  ticket?: string;
  limit?: number;
}

/** Body shape for `PATCH /v1/evolve/:id`. */
export interface EvolveInput {
  content: string;
  importance?: Importance;
  reason?: string;
}

export interface EvolveResult {
  deprecated: Fragment;
  replacement: Fragment;
}
