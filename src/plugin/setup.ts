/**
 * `openclaw hawkins setup` — one-command provisioning of the entire
 * openclaw-hawkins surface on a fresh host. Does the work that the existing
 * `make bootstrap-db` + `scripts/setup.sh` cover, but as a single CLI call
 * registered through the plugin.
 *
 * Steps:
 *   1. Apply vines/schema.sql against the configured MariaDB.
 *   2. Apply vecna/schema.sql against the same MariaDB.
 *   3. For each of the 6 specialist Tendrils, run `openclaw agents add` and
 *      overlay this repo's AGENTS.md into the agent's workspace.
 *   4. Print follow-up instructions for IDENTITY personalisation + the
 *      orchestrator workspace files.
 */
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createConnection } from "mariadb";

import { sslOptionFor } from "../config.js";
import { resolveDBConfig, type HawkinsPluginConfig } from "./config.js";

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
/** Resolves to the repo root when running from `dist/plugin/setup.js`. */
const PACKAGE_ROOT = resolve(HERE, "..", "..");

interface SpecialistAgent {
  id: string;
  model: string;
}

const DEFAULT_TEXT_MODEL = process.env.OPENCLAW_HAWKINS_TEXT_MODEL ?? "ollama/kimi-k2.6:cloud";
const DEFAULT_VISION_MODEL = process.env.OPENCLAW_HAWKINS_VISION_MODEL ?? "ollama/kimi-k2.5:cloud";

export function defaultSpecialists(): SpecialistAgent[] {
  return [
    { id: "system-agent", model: DEFAULT_TEXT_MODEL },
    { id: "code-agent", model: DEFAULT_TEXT_MODEL },
    { id: "research-agent", model: DEFAULT_TEXT_MODEL },
    { id: "data-agent", model: DEFAULT_TEXT_MODEL },
    { id: "comm-agent", model: DEFAULT_TEXT_MODEL },
    { id: "vision-agent", model: DEFAULT_VISION_MODEL },
  ];
}

export interface SetupOptions {
  pluginConfig: HawkinsPluginConfig;
  /** Override the agents base dir (default `$HOME/.openclaw/agents`). */
  agentsBaseDir?: string;
  /** Override the `openclaw` CLI binary (default: resolved from PATH). */
  openclawBin?: string;
  /** Skip the agent-creation step (schema-only setup). */
  skipAgents?: boolean;
  /** Override stdout writer for tests. */
  log?: (line: string) => void;
}

export async function runSetup(opts: SetupOptions): Promise<{
  schemasApplied: string[];
  agentsCreated: string[];
  agentsSkipped: string[];
}> {
  const log = opts.log ?? ((s: string) => process.stdout.write(s + "\n"));
  const schemasApplied: string[] = [];
  const agentsCreated: string[] = [];
  const agentsSkipped: string[] = [];

  log("openclaw-hawkins setup — applying schemas");
  await applySchemaFile(join(PACKAGE_ROOT, "vines", "schema.sql"), opts.pluginConfig);
  schemasApplied.push("vines");
  log("  ok: vines_ledger schema applied");
  await applySchemaFile(join(PACKAGE_ROOT, "vecna", "schema.sql"), opts.pluginConfig);
  schemasApplied.push("vecna");
  log("  ok: vecna_hive schema applied");

  if (opts.skipAgents) {
    log("\nopenclaw-hawkins setup — skipping agent creation (--skip-agents)");
    log("");
    printPostInstallBanner(log, { agentsCreated: false });
    return { schemasApplied, agentsCreated, agentsSkipped };
  }

  const agentsBase = opts.agentsBaseDir ?? join(process.env.HOME ?? "", ".openclaw", "agents");
  const openclawBin = opts.openclawBin ?? "openclaw";

  log("\nopenclaw-hawkins setup — creating 6 specialist agents");
  for (const agent of defaultSpecialists()) {
    const workspace = join(agentsBase, agent.id, "workspace");
    if (await pathExists(workspace)) {
      log(`  skip   ${agent.id} (workspace exists at ${workspace})`);
      agentsSkipped.push(agent.id);
    } else {
      log(`  create ${agent.id} (model: ${agent.model})`);
      await execFileP(openclawBin, [
        "agents",
        "add",
        agent.id,
        "--non-interactive",
        "--model",
        agent.model,
        "--workspace",
        workspace,
      ]);
      agentsCreated.push(agent.id);
    }

    // Overlay this repo's AGENTS.md.
    const srcAgents = join(PACKAGE_ROOT, "agents", agent.id, "AGENTS.md");
    if (await pathExists(srcAgents)) {
      await mkdir(workspace, { recursive: true });
      await copyFile(srcAgents, join(workspace, "AGENTS.md"));
      log("         overlaid AGENTS.md");
    }

    // Remove the auto-generated BOOTSTRAP.md — specialists carry a pre-defined identity.
    await rm(join(workspace, "BOOTSTRAP.md"), { force: true });
  }

  log("");
  printPostInstallBanner(log, { agentsCreated: true, agentsBase });

  return { schemasApplied, agentsCreated, agentsSkipped };
}

/**
 * Prints a "what you got" summary + verification steps + next-step recipe.
 * The text is deliberately exhaustive so a human operator OR an AI installer
 * agent reading this stdout can act on it without prior knowledge of the
 * plugin's surface.
 */
export function printPostInstallBanner(
  log: (line: string) => void,
  opts: { agentsCreated: boolean; agentsBase?: string },
): void {
  const bar = "─".repeat(72);
  log(bar);
  log("openclaw-hawkins is installed. Here is what your gateway now has:");
  log(bar);
  log("");
  log("Tools registered (any OpenClaw agent can call these by name):");
  log("  VINES (durable orchestration state):");
  log("    vines_triage                 vines_start              vines_set_state");
  log("    vines_attach_linear_parent   vines_recover            vines_status");
  log("  VECNA (shared agent memory):");
  log("    vecna_connect    vecna_recall    vecna_evolve");
  log("    vecna_search     vecna_fragment  vecna_healthz");
  log("");
  log("CLI: `openclaw hawkins setup` (you just ran this).");
  log("");
  log("Verify everything is wired up:");
  log("  openclaw plugins inspect openclaw-hawkins --runtime --json");
  log("  openclaw agent --agent system-agent --message 'Call vecna_healthz and report the JSON.'");
  log("");
  log("Next steps to finish your Nexus + Tendrils swarm:");
  if (!opts.agentsCreated) {
    log("  0. (skipped agent creation — re-run without --skip-agents to provision the 6 Tendrils)");
  }
  log("  1. Personalise each specialist's IDENTITY.md from the template:");
  const agentsBase = opts.agentsBase ?? join(process.env.HOME ?? "", ".openclaw", "agents");
  for (const agent of defaultSpecialists()) {
    log(
      `       cp ${join(PACKAGE_ROOT, "agents", agent.id, "IDENTITY.md.template")} ` +
        `${join(agentsBase, agent.id, "workspace", "IDENTITY.md")}`,
    );
  }
  log("     Then edit each to fill in your name + host.");
  log("");
  log("  2. Install the orchestrator workspace files:");
  log(
    `       cp ${join(PACKAGE_ROOT, "orchestrator", "AGENTS.md")} ~/.openclaw/workspace/AGENTS.md`,
  );
  log(
    `       cp ${join(PACKAGE_ROOT, "orchestrator", "TOOLS.md.template")} ~/.openclaw/workspace/TOOLS.md`,
  );
  log(
    `       cp ${join(PACKAGE_ROOT, "orchestrator", "IDENTITY.md.template")} ~/.openclaw/workspace/IDENTITY.md`,
  );
  log("");
  log("  3. Make sure the gateway has MARIADB_PASSWORD in its environment.");
  log("     Recommended: 0600 EnvironmentFile referenced from the gateway systemd unit:");
  log(
    "       echo MARIADB_PASSWORD=... > ~/.openclaw/secrets/hawkins.env && chmod 600 ~/.openclaw/secrets/hawkins.env",
  );
  log("       systemctl --user edit openclaw-gateway.service");
  log("       # then add:  EnvironmentFile=%h/.openclaw/secrets/hawkins.env");
  log("     Ephemeral alternative:  systemctl --user set-environment MARIADB_PASSWORD=...");
  log("");
  log("  4. Restart the gateway: openclaw gateway restart");
  log("");
  log('  5. Smoke-test: openclaw agent --agent system-agent --message "Call vecna_healthz."');
  log(bar);
}

async function applySchemaFile(path: string, pluginConfig: HawkinsPluginConfig): Promise<void> {
  const cfg = resolveDBConfig(pluginConfig);
  const raw = await readFile(path, "utf-8");
  const statements = raw
    .split(";")
    .map(stripSqlComments)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const conn = await createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: sslOptionFor(cfg.sslMode),
    multipleStatements: false,
  });
  try {
    for (const stmt of statements) {
      await conn.query(stmt);
    }
  } finally {
    await conn.end();
  }
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
