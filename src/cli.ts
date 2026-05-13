#!/usr/bin/env node
/**
 * `vines` command-line interface — the shell-callable surface of the VINES
 * library. Designed so an LLM-driven orchestrator (running inside OpenClaw,
 * Claude Code, or any agent runtime with an `exec` tool) can drive the
 * spec §3.2 protocol end-to-end without writing custom glue.
 *
 * Subcommands:
 *
 *   Setup / observability
 *     init-db                  Apply vines/schema.sql to the configured database.
 *     status                   Print recent ledger rows.
 *     recover                  JSON recovery report (spec §4.2).
 *     triage                   Activation decision (spec §3.1).
 *
 *   Orchestration lifecycle (spec §3.2)
 *     start                    Insert a new orchestration ledger row; prints
 *                              the orchestration_id on stdout.
 *     set-state                Move an orchestration through its lifecycle
 *                              (init → planning → executing → success/failed).
 *     attach-linear-parent     Backfill linear_parent_id on a row that was
 *                              created before the Linear ticket existed.
 *
 * Exit codes:
 *   0  success
 *   2  user error (bad args, missing env)
 *   3  Linear API error
 *   4  database error
 */

import { Command, InvalidArgumentError } from "commander";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createConnection } from "mariadb";

import { attachDbCredential, loadDBConfig, sslOptionFor } from "./config.js";
import { LinearClient } from "./linear-client.js";
import { triage } from "./orchestrator.js";
import { Ledger } from "./persistence.js";
import { scanRecovery, resumable, orphaned } from "./recovery.js";
import type { LedgerState } from "./types.js";

const LEDGER_STATES: ReadonlyArray<LedgerState> = [
  "init",
  "planning",
  "executing",
  "success",
  "failed",
];

function parseState(value: string): LedgerState {
  if ((LEDGER_STATES as ReadonlyArray<string>).includes(value)) return value as LedgerState;
  throw new InvalidArgumentError(`state must be one of: ${LEDGER_STATES.join(", ")}`);
}

class UserError extends Error {}

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "vines", "schema.sql");

export async function main(argv: readonly string[] = process.argv): Promise<number> {
  const program = new Command();
  program
    .name("vines")
    .description(
      "VINES (Versatile Integration for Networked Execution & State) — supervisor-pattern operator for an OpenClaw " +
        "specialist swarm. See vines/spec.md for the contract.",
    )
    .exitOverride();

  let rc = 0;

  program
    .command("init-db")
    .description("Apply vines/schema.sql to the configured database.")
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

  program
    .command("start")
    .description(
      "Create a new orchestration_ledger row (spec §3.2 step 2). " +
        "Prints the orchestration_id on stdout — capture and pass to subsequent commands.",
    )
    .requiredOption("-o, --objective <text>", "Operator-facing description of the goal")
    .option(
      "-p, --linear-parent <id>",
      "Linear parent issue identifier (e.g. ENG-42) or UUID — optional; can be attached later",
    )
    .option("-s, --state <state>", "Initial state (default: init)", parseState, "init")
    .option("-a, --last-agent <id>", "Specialist id to record as last-active (telemetry; optional)")
    .action(
      async (opts: {
        objective: string;
        linearParent?: string;
        state: LedgerState;
        lastAgent?: string;
      }) => {
        rc = await runOrReportError(() =>
          startOrchestration({
            objective: opts.objective,
            linearParentId: opts.linearParent ?? null,
            state: opts.state,
            lastAgentActive: opts.lastAgent ?? null,
          }),
        );
      },
    );

  program
    .command("set-state")
    .description(
      "Move an orchestration through its lifecycle (spec §3.2 steps 3–7 and §4.2 recovery).",
    )
    .argument("<orchestration-id>", "UUID returned by `vines start`")
    .argument("<state>", `One of: ${LEDGER_STATES.join(" | ")}`, parseState)
    .option("-a, --last-agent <id>", "Specialist id to record as last-active (telemetry; optional)")
    .action(async (id: string, state: LedgerState, opts: { lastAgent?: string }) => {
      rc = await runOrReportError(() => setStateCmd(id, state, opts.lastAgent ?? null));
    });

  program
    .command("attach-linear-parent")
    .description("Backfill linear_parent_id on an existing orchestration row.")
    .argument("<orchestration-id>", "UUID returned by `vines start`")
    .argument("<linear-parent-id>", "Linear identifier (ENG-42) or UUID")
    .action(async (id: string, linearParentId: string) => {
      rc = await runOrReportError(() => attachLinearParent(id, linearParentId));
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

  const conn = await createConnection(
    attachDbCredential(
      {
        host: config.host,
        port: config.port,
        user: config.user,
        database: config.database,
        ssl: sslOptionFor(config.sslMode),
        multipleStatements: false,
      },
      config.password,
    ),
  );
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

async function startOrchestration(args: {
  objective: string;
  linearParentId: string | null;
  state: LedgerState;
  lastAgentActive: string | null;
}): Promise<number> {
  if (!args.objective.trim()) throw new UserError("--objective must be a non-empty string");
  const ledger = Ledger.fromEnv();
  try {
    const id = await ledger.create({
      objectiveSummary: args.objective,
      linearParentId: args.linearParentId,
      state: args.state,
      lastAgentActive: args.lastAgentActive,
    });
    // Print only the id on stdout so callers can capture it cleanly:
    //   ORCH_ID=$(vines start --objective "...")
    process.stdout.write(id + "\n");
    return 0;
  } finally {
    await ledger.close();
  }
}

async function setStateCmd(
  orchestrationId: string,
  state: LedgerState,
  lastAgentActive: string | null,
): Promise<number> {
  if (!orchestrationId.trim()) throw new UserError("orchestration-id must be non-empty");
  const ledger = Ledger.fromEnv();
  try {
    const ok = await ledger.setState(orchestrationId, state, { lastAgentActive });
    if (!ok) throw new UserError(`no ledger row with orchestration_id=${orchestrationId}`);
    process.stdout.write(`ok: ${orchestrationId} → ${state}\n`);
    return 0;
  } finally {
    await ledger.close();
  }
}

async function attachLinearParent(
  orchestrationId: string,
  linearParentId: string,
): Promise<number> {
  if (!orchestrationId.trim()) throw new UserError("orchestration-id must be non-empty");
  if (!linearParentId.trim()) throw new UserError("linear-parent-id must be non-empty");
  const ledger = Ledger.fromEnv();
  try {
    const ok = await ledger.attachLinearParent(orchestrationId, linearParentId);
    if (!ok) throw new UserError(`no ledger row with orchestration_id=${orchestrationId}`);
    process.stdout.write(`ok: ${orchestrationId} linked to ${linearParentId}\n`);
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
