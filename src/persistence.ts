/**
 * Ledger persistence — implements `aso/spec.md` §4.1.
 *
 * One row per orchestration in `orchestration_ledger`. Linear stores the
 * canonical sub-task state; this ledger only records *which orchestrations
 * exist* and their coarse lifecycle state. Recovery (§4.2) cross-references
 * Linear to find the resume point.
 *
 * Connection management uses the official `mariadb` driver's pool so that
 * idle connections don't leak when the orchestrator runs as a long-lived
 * agent.
 */

import { createPool, type Pool, type PoolConnection } from "mariadb";
import { randomUUID } from "node:crypto";

import { loadDBConfig, sslOptionFor, type DBConfig } from "./config.js";
import { UNFINISHED_STATES, type LedgerState, type OrchestrationRow } from "./types.js";

/**
 * Persistence layer for the orchestration ledger.
 *
 * @example
 * ```ts
 * const ledger = Ledger.fromEnv();
 * const id = await ledger.create({ objectiveSummary: "Stand up monitoring stack" });
 * await ledger.setState(id, "executing", { lastAgentActive: "system-agent" });
 * await ledger.close();
 * ```
 */
export class Ledger {
  private readonly pool: Pool;
  private closed = false;

  constructor(public readonly config: DBConfig) {
    this.pool = createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: sslOptionFor(config.sslMode),
      connectionLimit: 5,
      acquireTimeout: 10_000,
      // Cap query latency so the orchestrator never wedges on a stalled DB.
      socketTimeout: 30_000,
      // Don't run multi-statements through us — schema migrations have their
      // own path (`scripts/bootstrap-aso-db.sh`).
      multipleStatements: false,
    });
  }

  /** Build a {@link Ledger} from the spec §5 env vars. */
  static fromEnv(): Ledger {
    return new Ledger(loadDBConfig());
  }

  /** Release all pool resources. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  /**
   * Insert a ledger row. Returns the orchestration id (a UUID v4 by default;
   * callers can pass an explicit one for deterministic tests / external
   * correlation).
   */
  async create(args: {
    objectiveSummary: string;
    linearParentId?: string | null;
    state?: LedgerState;
    lastAgentActive?: string | null;
    orchestrationId?: string;
  }): Promise<string> {
    const id = args.orchestrationId ?? randomUUID();
    await this.run(async (conn) => {
      await conn.query(
        "INSERT INTO orchestration_ledger " +
          "(orchestration_id, linear_parent_id, objective_summary, state, last_agent_active) " +
          "VALUES (?, ?, ?, ?, ?)",
        [
          id,
          args.linearParentId ?? null,
          args.objectiveSummary,
          args.state ?? "init",
          args.lastAgentActive ?? null,
        ],
      );
    });
    return id;
  }

  /** Fetch one row by id. Returns null if absent. */
  async get(orchestrationId: string): Promise<OrchestrationRow | null> {
    return this.run(async (conn) => {
      const rows = await typedQuery<RawRow[]>(
        conn,
        "SELECT orchestration_id, linear_parent_id, objective_summary, state, " +
          "last_agent_active, updated_at FROM orchestration_ledger " +
          "WHERE orchestration_id = ?",
        [orchestrationId],
      );
      return rows[0] ? toRow(rows[0]) : null;
    });
  }

  /** Update state. When `lastAgentActive` is provided it's persisted too. */
  async setState(
    orchestrationId: string,
    state: LedgerState,
    opts: { lastAgentActive?: string | null } = {},
  ): Promise<boolean> {
    return this.run(async (conn) => {
      const result =
        opts.lastAgentActive !== undefined
          ? await typedQuery<MutationResult>(
              conn,
              "UPDATE orchestration_ledger SET state = ?, last_agent_active = ? " +
                "WHERE orchestration_id = ?",
              [state, opts.lastAgentActive, orchestrationId],
            )
          : await typedQuery<MutationResult>(
              conn,
              "UPDATE orchestration_ledger SET state = ? WHERE orchestration_id = ?",
              [state, orchestrationId],
            );
      return result.affectedRows > 0;
    });
  }

  /** Attach (or update) the Linear parent id after creation. */
  async attachLinearParent(orchestrationId: string, linearParentId: string): Promise<boolean> {
    return this.run(async (conn) => {
      const result = await typedQuery<MutationResult>(
        conn,
        "UPDATE orchestration_ledger SET linear_parent_id = ? WHERE orchestration_id = ?",
        [linearParentId, orchestrationId],
      );
      return result.affectedRows > 0;
    });
  }

  /**
   * All rows in an unfinished state (init | planning | executing), ordered by
   * `updated_at` ascending. Recovery (§4.2) iterates this list.
   */
  async listUnfinished(): Promise<OrchestrationRow[]> {
    return this.run(async (conn) => {
      const placeholders = UNFINISHED_STATES.map(() => "?").join(", ");
      const rows = await typedQuery<RawRow[]>(
        conn,
        `SELECT orchestration_id, linear_parent_id, objective_summary, state,
                last_agent_active, updated_at
         FROM orchestration_ledger
         WHERE state IN (${placeholders})
         ORDER BY updated_at ASC`,
        [...UNFINISHED_STATES],
      );
      return rows.map(toRow);
    });
  }

  /** Recent rows for the `aso status` CLI / dashboards. */
  async listRecent(limit = 20): Promise<OrchestrationRow[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("limit must be a positive integer");
    }
    return this.run(async (conn) => {
      const rows = await typedQuery<RawRow[]>(
        conn,
        "SELECT orchestration_id, linear_parent_id, objective_summary, state, " +
          "last_agent_active, updated_at FROM orchestration_ledger " +
          "ORDER BY updated_at DESC LIMIT ?",
        [limit],
      );
      return rows.map(toRow);
    });
  }

  /** Hand a connection to `fn`, releasing it back to the pool on exit. */
  private async run<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("ledger has been closed");
    const conn = await this.pool.getConnection();
    try {
      return await fn(conn);
    } finally {
      await conn.release();
    }
  }
}

interface MutationResult {
  affectedRows: number;
}

/**
 * Type-safe wrapper around `conn.query`. The mariadb driver returns `any`;
 * we narrow at the call site so the rest of the codebase stays in strict mode.
 */
async function typedQuery<T>(
  conn: PoolConnection,
  sql: string,
  params: ReadonlyArray<unknown>,
): Promise<T> {
  const result: unknown = await conn.query(sql, params);
  return result as T;
}

interface RawRow {
  orchestration_id: string;
  linear_parent_id: string | null;
  objective_summary: string;
  state: LedgerState;
  last_agent_active: string | null;
  updated_at: Date | string;
}

function toRow(raw: RawRow): OrchestrationRow {
  return {
    orchestrationId: raw.orchestration_id,
    linearParentId: raw.linear_parent_id,
    objectiveSummary: raw.objective_summary,
    state: raw.state,
    lastAgentActive: raw.last_agent_active,
    updatedAt: raw.updated_at instanceof Date ? raw.updated_at : new Date(raw.updated_at),
  };
}
