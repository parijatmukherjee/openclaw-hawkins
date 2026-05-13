#!/usr/bin/env node
/**
 * `aso` command-line interface.
 *
 * Subcommands:
 *   aso init-db    Apply aso/schema.sql to the configured database.
 *   aso status     Print recent ledger rows.
 *   aso recover    JSON recovery report (spec §4.2).
 *   aso triage     Print whether the protocol activates for given inputs.
 *
 * Interesting workflows (creating orchestrations, dispatching specialists)
 * belong to the orchestrator *agent* which embeds the library. The CLI is
 * for setup, observability, and debugging.
 *
 * Exit codes:
 *   0  success
 *   2  user error (bad args, missing env)
 *   3  Linear API error
 *   4  database error
 */

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createConnection } from "mariadb";

import { loadDBConfig, sslOptionFor } from "./config.js";
import { LinearClient } from "./linear-client.js";
import { triage } from "./orchestrator.js";
import { Ledger } from "./persistence.js";
import { scanRecovery, resumable, orphaned } from "./recovery.js";

class UserError extends Error {}

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "aso", "schema.sql");

export async function main(argv: readonly string[] = process.argv): Promise<number> {
  const program = new Command();
  program
    .name("aso")
    .description(
      "Agentic Swarm Orchestrator — supervisor-pattern operator for an OpenClaw " +
        "specialist swarm. See aso/spec.md for the contract.",
    )
    .exitOverride();

  let rc = 0;

  program
    .command("init-db")
    .description("Apply aso/schema.sql to the configured database.")
    .action(async () => {
      rc = await runOrReportError(initDb);
    });

  program
    .command("status")
    .description("Print recent ledger rows.")
    .option("-n, --limit <n>", "How many rows to show", "20")
    .action(async (opts: { limit: string }) => {
      rc = await runOrReportError(() => status(Number(opts.limit)));
    });

  program
    .command("recover")
    .description("Cross-reference unfinished ledger rows with Linear (spec §4.2).")
    .action(async () => {
      rc = await runOrReportError(recover);
    });

  program
    .command("triage")
    .description("Print whether the protocol would activate for given inputs (spec §3.1).")
    .requiredOption("-s, --seconds <n>", "Estimated execution seconds")
    .option("-d, --domain <id...>", "Specialist domain involved (repeatable)", [])
    .action((opts: { seconds: string; domain: string[] }) => {
      const decision = triage(Number(opts.seconds), opts.domain);
      process.stdout.write(JSON.stringify(decision, null, 2) + "\n");
      rc = 0;
    });

  try {
    await program.parseAsync(argv);
  } catch (err: unknown) {
    // commander throws on --help, --version, and bad input.
    const e = err as { code?: string; exitCode?: number };
    if (e.code === "commander.helpDisplayed" || e.code === "commander.version") return 0;
    if (e.code === "commander.help") return 0;
    process.stderr.write(`error: ${asMessage(err)}\n`);
    return typeof e.exitCode === "number" ? e.exitCode : 2;
  }
  return rc;
}

async function runOrReportError(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof UserError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 2;
    }
    const msg = asMessage(err);
    if (msg.startsWith("Linear ")) {
      process.stderr.write(`linear: ${msg}\n`);
      return 3;
    }
    process.stderr.write(`db: ${msg}\n`);
    return 4;
  }
}

// ---------------------------------------------------------------------------
// Subcommand implementations
// ---------------------------------------------------------------------------

async function initDb(): Promise<number> {
  const config = loadDBConfig();
  let schema: string;
  try {
    schema = await readFile(SCHEMA_PATH, "utf-8");
  } catch (err: unknown) {
    throw new UserError(`schema not found at ${SCHEMA_PATH}: ${asMessage(err)}`);
  }
  const statements = schema
    .split(";")
    .map(stripSqlComments)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const conn = await createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: sslOptionFor(config.sslMode),
    multipleStatements: false,
  });
  try {
    for (const stmt of statements) {
      await conn.query(stmt);
    }
  } finally {
    await conn.end();
  }
  process.stdout.write(
    `ok: schema applied to ${config.user}@${config.host}:${config.port}/${config.database}\n`,
  );
  return 0;
}

async function status(limit: number): Promise<number> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new UserError("--limit must be a positive integer");
  }
  const ledger = Ledger.fromEnv();
  try {
    const rows = await ledger.listRecent(limit);
    if (rows.length === 0) {
      process.stdout.write("(ledger empty)\n");
      return 0;
    }
    const width = Math.max(...rows.map((r) => r.orchestrationId.length));
    process.stdout.write(
      `${pad("orchestration_id", width)}  state       parent       last_agent       updated_at\n`,
    );
    for (const r of rows) {
      process.stdout.write(
        `${pad(r.orchestrationId, width)}  ${pad(r.state, 10)}  ${pad(
          r.linearParentId ?? "-",
          11,
        )}  ${pad(r.lastAgentActive ?? "-", 15)}  ${r.updatedAt.toISOString()}\n`,
      );
    }
    return 0;
  } finally {
    await ledger.close();
  }
}

async function recover(): Promise<number> {
  const ledger = Ledger.fromEnv();
  try {
    const linear = new LinearClient();
    const report = await scanRecovery(ledger, linear);
    const payload = {
      unfinishedTotal: report.items.length,
      resumableTotal: resumable(report).length,
      orphanedTotal: orphaned(report).length,
      items: report.items.map((item) => ({
        orchestrationId: item.ledgerRow.orchestrationId,
        objective: item.ledgerRow.objectiveSummary,
        ledgerState: item.ledgerRow.state,
        linearParentId: item.ledgerRow.linearParentId,
        linearParentKnown: item.parentIssue !== null,
        childrenTotal: item.children.length,
        lastCompletedChild: item.lastCompletedChild?.identifier ?? null,
        nextPendingChild: item.nextPendingChild?.identifier ?? null,
        resumable: item.nextPendingChild !== null,
        orphaned: item.ledgerRow.linearParentId !== null && item.parentIssue === null,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return 0;
  } finally {
    await ledger.close();
  }
}

/** Strip MariaDB single-line `-- …` comments so the remaining body is pure SQL. */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Entry point for `node dist/cli.js` (the `bin` script in package.json).
const isDirectInvocation =
  typeof import.meta.url === "string" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectInvocation) {
  void main().then((code) => process.exit(code));
}
