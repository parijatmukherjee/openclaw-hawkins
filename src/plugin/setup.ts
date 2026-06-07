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
import { copyFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createConnection } from "mariadb";

import { attachDbCredential, sslOptionFor } from "../config.js";
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

  // Install the Nexus protocol doc unconditionally — it's how the
  // orchestrator agent learns the 12-tool vocabulary + when to call each.
  // Runs even with --skip-agents so the Nexus is aware of the tools even
  // when the operator has provisioned agents some other way.
  const protocolInstalled = await installNexusProtocol(log);

  if (opts.skipAgents) {
    log("\nopenclaw-hawkins setup — skipping agent creation (--skip-agents)");
    log("");
    printPostInstallBanner(log, { agentsCreated: false, protocolInstalled });
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

    // Overlay this repo's AGENTS.md — backing up any existing file first so an
    // operator's own AGENTS.md is never destroyed without a recoverable copy.
    const srcAgents = join(PACKAGE_ROOT, "agents", agent.id, "AGENTS.md");
    if (await pathExists(srcAgents)) {
      await mkdir(workspace, { recursive: true });
      const destAgents = join(workspace, "AGENTS.md");
      await backupIfExists(destAgents, log);
      await copyFile(srcAgents, destAgents);
      log("         overlaid AGENTS.md");
    }

    // Retire the auto-generated BOOTSTRAP.md — specialists carry a pre-defined
    // identity. Preserve it as a timestamped backup rather than deleting it
    // outright, so its contents remain recoverable and auditable.
    await backupIfExists(join(workspace, "BOOTSTRAP.md"), log, { retire: true });
  }

  log("");
  printPostInstallBanner(log, {
    agentsCreated: true,
    agentsBase,
    protocolInstalled,
  });

  return { schemasApplied, agentsCreated, agentsSkipped };
}

/**
 * Copies the plugin's `HAWKINS_PROTOCOL.md` into the Nexus's workspace
 * (`~/.openclaw/workspace/HAWKINS_PROTOCOL.md`) so the orchestrator agent
 * learns the 12-tool vocabulary + orchestration sequence at next gateway
 * start. Returns:
 *   - "installed"  — copied successfully
 *   - "exists"     — file already present, left untouched
 *   - "skipped"    — source not bundled (shouldn't happen in published pkg)
 */
async function installNexusProtocol(
  log: (line: string) => void,
): Promise<"installed" | "exists" | "skipped"> {
  const src = join(PACKAGE_ROOT, "orchestrator", "HAWKINS_PROTOCOL.md");
  const workspace = join(process.env.HOME ?? "", ".openclaw", "workspace");
  const dst = join(workspace, "HAWKINS_PROTOCOL.md");

  if (!(await pathExists(src))) return "skipped";

  if (await pathExists(dst)) {
    log(`\nopenclaw-hawkins setup — Nexus protocol already at ${dst} (leaving alone)`);
    return "exists";
  }

  await mkdir(workspace, { recursive: true });
  await copyFile(src, dst);
  log(`\nopenclaw-hawkins setup — installed Nexus protocol → ${dst}`);
  return "installed";
}

/**
 * Prints a "what you got" summary + verification steps + next-step recipe.
 * The text is deliberately exhaustive so a human operator OR an AI installer
 * agent reading this stdout can act on it without prior knowledge of the
 * plugin's surface.
 */
export function printPostInstallBanner(
  log: (line: string) => void,
  opts: {
    agentsCreated: boolean;
    agentsBase?: string;
    protocolInstalled?: "installed" | "exists" | "skipped";
  },
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
  // Tell the operator what happened with the Nexus protocol doc — critical
  // for "does my orchestrator know to use the tools" awareness.
  switch (opts.protocolInstalled) {
    case "installed":
      log("Nexus protocol doc: installed at ~/.openclaw/workspace/HAWKINS_PROTOCOL.md.");
      log("  Your orchestrator agent will pick it up on the next gateway restart and learn");
      log("  the 12-tool vocabulary + when-to-call-what sequence.");
      break;
    case "exists":
      log(
        "Nexus protocol doc: ~/.openclaw/workspace/HAWKINS_PROTOCOL.md already exists — left untouched.",
      );
      log("  If your orchestrator can't find the tools, diff against this repo's copy at:");
      log(`    ${join(PACKAGE_ROOT, "orchestrator", "HAWKINS_PROTOCOL.md")}`);
      break;
    case "skipped":
    case undefined:
      log("Nexus protocol doc: NOT installed (bundled file missing). Copy it manually:");
      log(
        `    cp ${join(PACKAGE_ROOT, "orchestrator", "HAWKINS_PROTOCOL.md")} ~/.openclaw/workspace/HAWKINS_PROTOCOL.md`,
      );
      break;
  }
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

  const conn = await createConnection(
    attachDbCredential(
      {
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        database: cfg.database,
        ssl: sslOptionFor(cfg.sslMode),
        multipleStatements: false,
      },
      cfg.password,
    ),
  );
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

/**
 * Move an existing file aside to `<file>.bak.<timestamp>` before it is
 * overwritten or removed, mirroring the skill's "backup before overlay"
 * principle so setup never destroys an operator's file without a recoverable
 * copy. No-op when the file does not exist.
 *
 * - default: leaves a backup *copy* alongside the file about to be overwritten.
 * - `{ retire: true }`: moves the file to the backup (no original remains),
 *   used when retiring a file we want gone but still recoverable.
 */
async function backupIfExists(
  target: string,
  log: (s: string) => void,
  opts: { retire?: boolean } = {},
): Promise<void> {
  if (!(await pathExists(target))) return;
  const backup = `${target}.bak.${Date.now()}`;
  if (opts.retire) {
    await rename(target, backup);
  } else {
    await copyFile(target, backup);
  }
  log(`         backed up ${basename(target)} → ${basename(backup)}`);
}
