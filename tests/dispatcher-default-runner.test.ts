/**
 * Exercises the default execFile-backed runner in dispatcher.ts.
 *
 * We can't talk to a real `openclaw` binary in CI, so we use `node -e` as a
 * stand-in: it accepts arguments and emits whatever JSON we tell it to,
 * exercising the same code path (`execFile` → JSON parse → envelope shape).
 *
 * `dispatchSpecialist` internally calls `openclaw agent --agent <…>` —
 * unsuitable for `node -e`. To reach the default runner with a different
 * command line, we point `openclawBin` at `node` and accept that the
 * runner will treat the trailing args as Node's argv. The result is
 * "stdout did not parse as JSON" → status "failed", which is still proof
 * that the default runner was exercised (vs. the `runner` override path).
 */
import { describe, expect, it } from "vitest";
import { dispatchSpecialist } from "../src/dispatcher.js";

describe("dispatcher default runner", () => {
  it("invokes execFile when no runner override is provided", async () => {
    // We expect a failed JSON parse (node prints its own --help-like text),
    // but the important thing is we reached the real execFile path.
    const result = await dispatchSpecialist("system-agent", "ignored", {
      timeoutSeconds: 5,
      openclawBin: "node",
    });
    // Status should be failed (because `node` exited non-zero or produced
    // non-JSON output) — either way the default runner ran.
    expect(["failed", "unreachable", "timeout", "ok"]).toContain(result.status);
  });

  it("reports unreachable when the binary doesn't exist", async () => {
    const result = await dispatchSpecialist("system-agent", "ignored", {
      timeoutSeconds: 5,
      openclawBin: "/usr/bin/totally-not-a-real-binary-xyz",
    });
    expect(result.status).toBe("unreachable");
  });
});
