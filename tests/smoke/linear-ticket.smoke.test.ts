/**
 * `tools/linear-ticket` smoke test. Spawns the shell-callable CLI to confirm
 * it executes end-to-end against the real Linear API and the operator's
 * `~/.openclaw/linear.json`.
 *
 * Requires:
 *   LINEAR_API_KEY   (or a valid ~/.openclaw/linear.json with api_key_secret_ref)
 *   ~/.openclaw/linear.json (the script reads it for the team UUID + state IDs)
 *
 * The test only issues a read (`list --limit 1`). It never creates / mutates.
 */
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
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

const hasKey = !!process.env.LINEAR_API_KEY;
const hasConfig = existsSync(LINEAR_CONFIG);
const ready = hasKey && hasConfig;

describe("linear-ticket smoke", () => {
  it.skipIf(!ready)("`linear-ticket --help` runs (no config / key needed)", async () => {
    // help path does not consult config or LINEAR_API_KEY
    const { stdout } = await execFileAsync(LINEAR_TICKET, ["--help"], { timeout: 5_000 });
    expect(stdout).toMatch(/Usage:/);
    expect(stdout).toMatch(/create/);
    expect(stdout).toMatch(/list/);
  });

  it.skipIf(!ready)("`linear-ticket list --limit 1` returns a JSON array", async () => {
    const { stdout } = await execFileAsync(LINEAR_TICKET, ["list", "--limit", "1"], {
      timeout: 15_000,
      env: process.env,
    });
    const parsed = JSON.parse(stdout) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });
});
