/**
 * HiveStore — MariaDB CRUD for `vecna_hive`.
 *
 * Implements `vecna/spec.md` §4. Connection uses the same `mariadb`
 * pool conventions as VINES's Ledger so contributors don't context-switch.
 */

import { createPool, type Pool, type PoolConnection } from "mariadb";
import { randomUUID } from "node:crypto";

import { attachDbCredential, sslOptionFor, type DBConfig } from "../config.js";

/** Build a mariadb pool config from a `DBConfig`. */
function buildPoolConfig(db: DBConfig) {
  return attachDbCredential(
    {
      host: db.host,
      port: db.port,
      user: db.user,
      database: db.database,
      ssl: sslOptionFor(db.sslMode),
      connectionLimit: 8,
      acquireTimeout: 10_000,
      socketTimeout: 30_000,
      multipleStatements: false,
    },
    db.password,
  );
}
import type {
  ConnectInput,
  ConnectResult,
  EvolveInput,
  EvolveResult,
  Fragment,
  Importance,
  RecallOptions,
} from "./types.js";
import { isImportance } from "./types.js";

export interface HiveStoreOptions {
  db: DBConfig;
  /** Dedup window in minutes; see vecna/spec.md §4.1. */
  dedupWindowMinutes: number;
}

export class HiveStore {
  private readonly pool: Pool;
  private readonly dedupWindowMinutes: number;
  private closed = false;

  constructor(opts: HiveStoreOptions) {
    this.dedupWindowMinutes = opts.dedupWindowMinutes;
    this.pool = createPool(buildPoolConfig(opts.db));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  /** Lightweight liveness check used by `/v1/healthz`. */
  async ping(): Promise<boolean> {
    if (this.closed) return false;
    try {
      await this.run(async (conn) => {
        await conn.query("SELECT 1");
      });
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Connect (§4.1)
  // ------------------------------------------------------------------

  async connect(input: ConnectInput): Promise<ConnectResult> {
    validateConnect(input);

    const importance: Importance = input.importance ?? 3;

    // Deduplication — only fires for importance ≥ 4 within the window.
    if (importance >= 4 && this.dedupWindowMinutes > 0) {
      const existing = await this.findRecentDuplicate({
        topic: input.topic,
        sourceAgent: input.sourceAgent,
        content: input.content,
        importance,
      });
      if (existing) return { fragment: existing, deduplicated: true };
    }

    const fragmentId = randomUUID();
    await this.run(async (conn) => {
      await conn.query(
        "INSERT INTO vecna_hive " +
          "(fragment_id, topic, sub_topic, content, source_agent, importance, linear_ticket_ref) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          fragmentId,
          input.topic,
          input.subTopic ?? null,
          input.content,
          input.sourceAgent,
          importance,
          input.linearRef ?? null,
        ],
      );
    });
    const fragment = await this.requireFragment(fragmentId);
    return { fragment, deduplicated: false };
  }

  private async findRecentDuplicate(args: {
    topic: string;
    sourceAgent: string;
    content: string;
    importance: Importance;
  }): Promise<Fragment | null> {
    return this.run(async (conn) => {
      const rows = await typedQuery<RawRow[]>(
        conn,
        `SELECT * FROM vecna_hive
           WHERE topic = ?
             AND source_agent = ?
             AND content = ?
             AND importance = ?
             AND is_deprecated = FALSE
             AND created_at >= NOW() - INTERVAL ? MINUTE
           ORDER BY created_at DESC
           LIMIT 1`,
        [args.topic, args.sourceAgent, args.content, args.importance, this.dedupWindowMinutes],
      );
      return rows[0] ? toFragment(rows[0]) : null;
    });
  }

  // ------------------------------------------------------------------
  // Recall (§4.2)
  // ------------------------------------------------------------------

  /**
   * Topic-scoped recall. Ranks by:
   *   1. ticket-tagged fragments first (when `opts.ticket` is given);
   *   2. importance = 5 always before others;
   *   3. fragments newer than 6 months above older ones (decay penalty);
   *   4. importance descending;
   *   5. created_at descending.
   *
   * Non-deprecated fragments only.
   */
  async recall(topic: string, opts: RecallOptions = {}): Promise<Fragment[]> {
    const limit = clampLimit(opts.limit);
    const ticket = opts.ticket ?? null;
    return this.run(async (conn) => {
      const rows = await typedQuery<RawRow[]>(
        conn,
        `SELECT * FROM vecna_hive
           WHERE topic = ? AND is_deprecated = FALSE
           ORDER BY
             (linear_ticket_ref IS NOT NULL AND linear_ticket_ref = ?) DESC,
             (importance = 5) DESC,
             (created_at >= NOW() - INTERVAL 6 MONTH) DESC,
             importance DESC,
             created_at DESC
           LIMIT ?`,
        [topic, ticket ?? "", limit],
      );
      return rows.map(toFragment);
    });
  }

  // ------------------------------------------------------------------
  // Search (§4.3)
  // ------------------------------------------------------------------

  async search(query: string, limit?: number): Promise<Fragment[]> {
    if (typeof query !== "string" || query.trim().length === 0) {
      throw new Error("search query must be a non-empty string");
    }
    const lim = clampLimit(limit);
    return this.run(async (conn) => {
      const rows = await typedQuery<RawRow[]>(
        conn,
        `SELECT * FROM vecna_hive
           WHERE MATCH(content) AGAINST (? IN NATURAL LANGUAGE MODE)
             AND is_deprecated = FALSE
           ORDER BY (importance = 5) DESC, importance DESC, created_at DESC
           LIMIT ?`,
        [query, lim],
      );
      return rows.map(toFragment);
    });
  }

  // ------------------------------------------------------------------
  // Fragment fetch + evolve (§4.4)
  // ------------------------------------------------------------------

  async getFragment(id: string): Promise<Fragment | null> {
    return this.run(async (conn) => {
      const rows = await typedQuery<RawRow[]>(
        conn,
        "SELECT * FROM vecna_hive WHERE fragment_id = ?",
        [id],
      );
      return rows[0] ? toFragment(rows[0]) : null;
    });
  }

  async evolve(id: string, input: EvolveInput): Promise<EvolveResult> {
    if (typeof input.content !== "string" || input.content.trim().length === 0) {
      throw new Error("evolve content must be a non-empty string");
    }
    if (input.importance !== undefined && !isImportance(input.importance)) {
      throw new Error("evolve importance must be 1–5");
    }

    // Transactional: deprecate old + insert new + return both rows.
    const newId = randomUUID();
    const result = await this.runTransaction(async (conn) => {
      const oldRows = await typedQuery<RawRow[]>(
        conn,
        "SELECT * FROM vecna_hive WHERE fragment_id = ?",
        [id],
      );
      if (!oldRows[0]) return null;
      const old = oldRows[0];

      await conn.query("UPDATE vecna_hive SET is_deprecated = TRUE WHERE fragment_id = ?", [id]);
      await conn.query(
        "INSERT INTO vecna_hive " +
          "(fragment_id, topic, sub_topic, content, source_agent, importance, linear_ticket_ref) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          newId,
          old.topic,
          old.sub_topic,
          input.content,
          old.source_agent,
          input.importance ?? old.importance,
          old.linear_ticket_ref,
        ],
      );
      return old;
    });

    if (result === null) throw new Error(`fragment not found: ${id}`);
    const [deprecated, replacement] = await Promise.all([
      this.requireFragment(id),
      this.requireFragment(newId),
    ]);
    return { deprecated, replacement };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async requireFragment(id: string): Promise<Fragment> {
    const f = await this.getFragment(id);
    if (!f) throw new Error(`fragment vanished after write: ${id}`);
    return f;
  }

  private async run<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("hive store has been closed");
    const conn = await this.pool.getConnection();
    try {
      return await fn(conn);
    } finally {
      await conn.release();
    }
  }

  private async runTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("hive store has been closed");
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      try {
        const result = await fn(conn);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    } finally {
      await conn.release();
    }
  }
}

// ---------------------------------------------------------------------------
// Validation + row mapping
// ---------------------------------------------------------------------------

function validateConnect(input: ConnectInput): void {
  requireNonEmptyString(input.topic, "topic", 128);
  requireNonEmptyString(input.content, "content");
  requireNonEmptyString(input.sourceAgent, "source_agent", 64);
  if (input.subTopic !== undefined && input.subTopic !== null) {
    requireNonEmptyString(input.subTopic, "sub_topic", 128);
  }
  if (input.linearRef !== undefined && input.linearRef !== null) {
    requireNonEmptyString(input.linearRef, "linear_ref", 64);
  }
  if (input.importance !== undefined && !isImportance(input.importance)) {
    throw new Error("importance must be 1–5");
  }
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  maxLen?: number,
): asserts value is string {
  // Reject whitespace-only values too — otherwise a fragment with
  // `topic="   "` slips through and produces useless rows.
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (maxLen !== undefined && value.length > maxLen) {
    throw new Error(`${field} exceeds max length ${maxLen}`);
  }
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return Math.min(value, 100);
}

interface RawRow {
  fragment_id: string;
  topic: string;
  sub_topic: string | null;
  content: string;
  source_agent: string;
  importance: number;
  linear_ticket_ref: string | null;
  is_deprecated: number | boolean;
  created_at: Date | string;
}

function toFragment(raw: RawRow): Fragment {
  if (!isImportance(raw.importance)) {
    throw new Error(`invalid importance in row ${raw.fragment_id}: ${raw.importance}`);
  }
  return {
    fragmentId: raw.fragment_id,
    topic: raw.topic,
    subTopic: raw.sub_topic,
    content: raw.content,
    sourceAgent: raw.source_agent,
    importance: raw.importance,
    linearTicketRef: raw.linear_ticket_ref,
    isDeprecated: Boolean(raw.is_deprecated),
    createdAt: raw.created_at instanceof Date ? raw.created_at : new Date(raw.created_at),
  };
}

async function typedQuery<T>(
  conn: PoolConnection,
  sql: string,
  params: ReadonlyArray<unknown>,
): Promise<T> {
  const result: unknown = await conn.query(sql, params);
  return result as T;
}
