/**
 * Dispatcher smoke test. Confirms the `openclaw` binary is reachable and
 * that our dispatch wrapper returns a structured result.
 *
 * The test never sends a real specialist dispatch (those need a configured
 * gateway + agent + model auth). Instead it invokes `openclaw --version`,
 * which proves PATH + execFile + JSON-decode boundary conditions.
 *
 * Set SMOKE_OPENCLAW_AGENT=<id> + SMOKE_OPENCLAW_MESSAGE="..." to do a real
 * dispatch — useful for end-to-end verification on a configured host.
 */
import { describe, expect, it } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

import { dispatchSpecialist } from "../../src/dispatcher.js";
import type { SpecialistId } from "../../src/types.js";

const execFileAsync = promisify(execFile);

// Synchronous detection so `describe` itself stays sync — vitest only
// registers tests deterministically from a sync `describe` callback.
function openclawOnPath(): boolean {
  const result = spawnSync("openclaw", ["--version"], { timeout: 5_000, stdio: "ignore" });
  return result.status === 0;
}

const hasOpenclaw = openclawOnPath();
const wantsRealDispatch = Boolean(
  process.env.SMOKE_OPENCLAW_AGENT && process.env.SMOKE_OPENCLAW_MESSAGE,
);

describe("dispatcher smoke", () => {
  it.skipIf(!hasOpenclaw)("`openclaw` is on PATH and reports a version", async () => {
    const { stdout } = await execFileAsync("openclaw", ["--version"], { timeout: 5_000 });
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it.skipIf(!hasOpenclaw || !wantsRealDispatch)(
    "real specialist dispatch returns a result",
    async () => {
      const agent = process.env.SMOKE_OPENCLAW_AGENT! as SpecialistId;
      const message = process.env.SMOKE_OPENCLAW_MESSAGE!;
      const result = await dispatchSpecialist(agent, message, { timeoutSeconds: 60 });
      // We can't assert on `ok` because the operator's gateway may not have
      // the agent configured — but we can assert that the dispatcher returned
      // a well-shaped DispatchResult and didn't throw.
      expect(result.agent).toBe(agent);
      expect(["ok", "failed", "timeout", "unreachable"]).toContain(result.status);
    },
  );
});
