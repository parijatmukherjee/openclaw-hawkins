/**
 * `tools/linear-ticket` smoke test. Spawns the shell-callable CLI to confirm
 * it runs and that the live read path (`list`) actually talks to Linear.
 *
 * Two gates:
 *   - `--help` always runs (no config / key consulted).
 *   - `list` runs when the operator has both a config file and a usable key
 *     resolution path — either `LINEAR_API_KEY` set, or `op` on PATH + an
 *     `api_key_secret_ref` declared in `~/.openclaw/linear.json`.
 *
 * The test only ever issues a read (`list --limit 1`). It never creates or
 * mutates anything in Linear.
 */
import { describe, expect, it } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const LINEAR_CONFIG = join(homedir(), ".openclaw", "linear.json");
const LINEAR_TICKET = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "tools",
  "linear-ticket",
);

function opOnPath(): boolean {
  const result = spawnSync("op", ["--version"], { timeout: 3_000, stdio: "ignore" });
  return result.status === 0;
}

function configHasSecretRef(path: string): boolean {
  try {
    const cfg = JSON.parse(readFileSync(path, "utf-8")) as { api_key_secret_ref?: string };
    return typeof cfg.api_key_secret_ref === "string" && cfg.api_key_secret_ref.length > 0;
  } catch {
    return false;
  }
}

const hasConfig = existsSync(LINEAR_CONFIG);
const hasEnvKey = Boolean(process.env.LINEAR_API_KEY);
const opAvailable = opOnPath();
const opFallbackUsable = hasConfig && opAvailable && configHasSecretRef(LINEAR_CONFIG);
// `list` needs: config file present + (env key OR op-backed key)
const canRunList = hasConfig && (hasEnvKey || opFallbackUsable);

describe("linear-ticket smoke", () => {
  it("`linear-ticket --help` runs (no config / key needed)", async () => {
    const { stdout } = await execFileAsync(LINEAR_TICKET, ["--help"], { timeout: 5_000 });
    expect(stdout).toMatch(/Usage:/);
    expect(stdout).toMatch(/create/);
    expect(stdout).toMatch(/list/);
  });

  it.skipIf(!canRunList)("`linear-ticket list --limit 1` returns a JSON array", async () => {
    const { stdout } = await execFileAsync(LINEAR_TICKET, ["list", "--limit", "1"], {
      timeout: 15_000,
      env: process.env,
    });
    const parsed = JSON.parse(stdout) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });
});
