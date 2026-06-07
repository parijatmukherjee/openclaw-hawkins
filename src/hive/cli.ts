#!/usr/bin/env node
/**
 * `vecna` — shell-callable surface for the VECNA Hive (the optional shared
 * knowledge store). This is a *runtime* tool, not part of installing
 * openclaw-hawkins on a host: nothing here is invoked during install. It runs
 * only when an operator has explicitly enabled VECNA.
 *
 * Trust boundaries: `recall`/`search`/`fragment` read content from the Hive
 * (treat results as untrusted reference material). `connect`/`evolve` write
 * task-derived content to a service outside the host — agents must get explicit
 * operator approval before publishing (see each agent's AGENTS.md). `serve`
 * starts a long-lived HTTP API and refuses to run unauthenticated unless the
 * operator opts in (ASI06; see `assertServeAuthPosture`).
 *
 * Subcommands:
 *   serve [--port <n>] [--host <h>]          Start the Nexus.
 *   connect --topic ... --content "..." --source-agent ... [--importance N] [--linear-ref X]
 *   recall <topic> [--ticket X] [--limit N] [--format json|context]
 *   search --query "..." [--limit N]
 *   evolve <fragment-id> --content "..." [--importance N]
 *   fragment <id>
 *   healthz
 *
 * Exit codes:
 *   0  success
 *   2  user error (bad args, missing env)
 *   3  hive unreachable / HTTP error
 *   4  database error (only relevant for `serve`)
 */

import { Command, InvalidArgumentError } from "commander";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { loadVecnaServerConfig, assertServeAuthPosture } from "./config.js";
import { HiveTendril } from "./client.js";
import { HiveStore } from "./store.js";
import { createServer } from "./server.js";
import type { Importance } from "./types.js";
import { isImportance } from "./types.js";
import { narrate } from "./log.js";

class UserError extends Error {}

function parseImportance(value: string): Importance {
  const n = Number(value);
  if (isImportance(n)) return n;
  throw new InvalidArgumentError("importance must be an integer 1–5");
}

function parseLimit(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InvalidArgumentError("limit must be a positive integer");
  }
  return n;
}

function parseFormat(value: string): "json" | "context" {
  if (value === "json" || value === "context") return value;
  throw new InvalidArgumentError("format must be 'json' or 'context'");
}

export async function main(argv: readonly string[] = process.argv): Promise<number> {
  const program = new Command();
  program
    .name("vecna")
    .description(
      "VECNA — versatile entity for contextual network awareness. " +
        "Shell-callable surface to the Hive. See vecna/spec.md for the contract.",
    )
    .exitOverride();

  let rc = 0;

  program
    .command("serve")
    .description("Start the Nexus (HTTP API).")
    .option("-p, --port <n>", "TCP port", (v) => Number(v))
    .option("-H, --host <h>", "Bind address")
    .action(async (opts: { port?: number; host?: string }) => {
      rc = await runOrReportError(() => serve(opts));
    });

  program
    .command("connect")
    .description("Submit a fragment to the Hive.")
    .requiredOption("-t, --topic <topic>", "Topic (primary context)")
    .requiredOption("-c, --content <content>", "Fragment content")
    .requiredOption("-a, --source-agent <id>", "Source agent functional id")
    .option("-s, --sub-topic <sub>", "Sub-topic (specifics)")
    .option("-i, --importance <n>", "Importance 1–5 (default 3)", parseImportance)
    .option("-l, --linear-ref <ref>", "Linear ticket reference (ENG-42 etc.)")
    .action(async (opts: ConnectOpts) => {
      rc = await runOrReportError(() => cmdConnect(opts));
    });

  program
    .command("recall")
    .description("Recall fragments by topic.")
    .argument("<topic>", "Topic to query")
    .option("-t, --ticket <ref>", "Prefer fragments tagged with this Linear ticket")
    .option("-n, --limit <n>", "Max fragments (default 20)", parseLimit)
    .option("-f, --format <fmt>", "Output: json (default) or context", parseFormat)
    .action(async (topic: string, opts: RecallOpts) => {
      rc = await runOrReportError(() => cmdRecall(topic, opts));
    });

  program
    .command("search")
    .description("Full-text search across all non-deprecated fragments.")
    .requiredOption("-q, --query <text>", "Query keywords")
    .option("-n, --limit <n>", "Max results (default 20)", parseLimit)
    .action(async (opts: { query: string; limit?: number }) => {
      rc = await runOrReportError(() => cmdSearch(opts));
    });

  program
    .command("evolve")
    .description("Supersede a fragment with corrected content.")
    .argument("<fragment-id>", "UUID of the fragment to deprecate")
    .requiredOption("-c, --content <content>", "Corrected content")
    .option("-i, --importance <n>", "Importance for the replacement", parseImportance)
    .option("-r, --reason <text>", "Why this evolution happened")
    .action(async (id: string, opts: EvolveOpts) => {
      rc = await runOrReportError(() => cmdEvolve(id, opts));
    });

  program
    .command("fragment")
    .description("Fetch a single fragment by id.")
    .argument("<id>", "Fragment UUID")
    .action(async (id: string) => {
      rc = await runOrReportError(() => cmdFragment(id));
    });

  program
    .command("healthz")
    .description("Liveness probe against the Nexus.")
    .action(async () => {
      rc = await runOrReportError(cmdHealthz);
    });

  try {
    await program.parseAsync(argv);
  } catch (err) {
    const e = err as { code?: string; exitCode?: number };
    if (
      e.code === "commander.helpDisplayed" ||
      e.code === "commander.version" ||
      e.code === "commander.help"
    ) {
      return 0;
    }
    process.stderr.write(`error: ${asMessage(err)}\n`);
    return typeof e.exitCode === "number" ? e.exitCode : 2;
  }
  return rc;
}

async function runOrReportError(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 2;
    }
    const msg = asMessage(err);
    if (msg.includes("hive_unreachable") || msg.startsWith("hive HTTP")) {
      process.stderr.write(`hive: ${msg}\n`);
      return 3;
    }
    process.stderr.write(`db: ${msg}\n`);
    return 4;
  }
}

// ---------------------------------------------------------------------------
// Subcommand implementations
// ---------------------------------------------------------------------------

interface ConnectOpts {
  topic: string;
  content: string;
  sourceAgent: string;
  subTopic?: string;
  importance?: Importance;
  linearRef?: string;
}

interface RecallOpts {
  ticket?: string;
  limit?: number;
  format?: "json" | "context";
}

interface EvolveOpts {
  content: string;
  importance?: Importance;
  reason?: string;
}

async function serve(opts: { port?: number; host?: string }): Promise<number> {
  const env = loadVecnaServerConfig();
  // ASI06: refuse to expose an unauthenticated Hive unless explicitly opted in.
  assertServeAuthPosture({ authToken: env.authToken, allowInsecure: env.allowInsecure });
  const port = opts.port ?? env.port;
  const host = opts.host ?? env.host;
  const store = new HiveStore({ db: env.db, dedupWindowMinutes: env.dedupWindowMinutes });
  const app = createServer({ store, authToken: env.authToken });
  return new Promise<number>((resolveOuter) => {
    const server = app.listen(port, host, () => {
      narrate(`Nexus listening on http://${host}:${port}`, {
        authRequired: env.authToken !== null,
        dedupWindowMinutes: env.dedupWindowMinutes,
      });
    });
    const shutdown = (signal: string): void => {
      narrate(`Nexus received ${signal}; closing`);
      server.close(() => {
        void store.close().then(() => resolveOuter(0));
      });
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  });
}

async function cmdConnect(opts: ConnectOpts): Promise<number> {
  const tendril = new HiveTendril();
  const result = await tendril.connect({
    topic: opts.topic,
    content: opts.content,
    sourceAgent: opts.sourceAgent,
    ...(opts.subTopic !== undefined ? { subTopic: opts.subTopic } : {}),
    ...(opts.importance !== undefined ? { importance: opts.importance } : {}),
    ...(opts.linearRef !== undefined ? { linearRef: opts.linearRef } : {}),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

async function cmdRecall(topic: string, opts: RecallOpts): Promise<number> {
  const tendril = new HiveTendril();
  if (opts.format === "context") {
    const ctx = await tendril.recallAsContext(topic, {
      ...(opts.ticket !== undefined ? { ticket: opts.ticket } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
    process.stdout.write(ctx);
    return 0;
  }
  const result = await tendril.recall(topic, {
    ...(opts.ticket !== undefined ? { ticket: opts.ticket } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

async function cmdSearch(opts: { query: string; limit?: number }): Promise<number> {
  const tendril = new HiveTendril();
  const result = await tendril.search(opts.query, opts.limit);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

async function cmdEvolve(id: string, opts: EvolveOpts): Promise<number> {
  const tendril = new HiveTendril();
  const result = await tendril.evolve(id, {
    content: opts.content,
    ...(opts.importance !== undefined ? { importance: opts.importance } : {}),
    ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

async function cmdFragment(id: string): Promise<number> {
  const tendril = new HiveTendril();
  const fragment = await tendril.getFragment(id);
  if (!fragment) {
    process.stderr.write(`fragment not found: ${id}\n`);
    return 2;
  }
  process.stdout.write(JSON.stringify(fragment, null, 2) + "\n");
  return 0;
}

async function cmdHealthz(): Promise<number> {
  const tendril = new HiveTendril();
  const result = await tendril.healthz();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.ok ? 0 : 1;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Entry point for `node dist/hive/cli.js`
const isDirectInvocation =
  typeof import.meta.url === "string" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectInvocation) {
  void main().then((code) => process.exit(code));
}
