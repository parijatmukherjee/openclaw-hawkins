/**
 * Optional auto-recovery hook. When `hawkins.autoRecovery=true`, fires once
 * on `gateway_start` and logs any unfinished VINES orchestrations the host
 * came up holding. The hook never mutates state — operators still run
 * `vines_recover` explicitly to mark orphans as failed.
 *
 * Default: disabled. Most hosts don't need this; it's a convenience for
 * always-on production deployments.
 */
import type { PluginLogger } from "openclaw/plugin-sdk/core";

import { type RecoveryItem, scanRecovery } from "../recovery.js";
import type { HawkinsServices } from "./services.js";

export interface AutoRecoveryHookOptions {
  enabled: boolean;
  services: HawkinsServices;
  logger: PluginLogger;
}

/**
 * Returns a `gateway_start` handler suitable for `api.registerHook`. When
 * `enabled=false` returns a no-op so the registration call stays declarative.
 */
export function buildAutoRecoveryHandler(opts: AutoRecoveryHookOptions): () => Promise<void> {
  if (!opts.enabled) {
    return async () => {
      /* no-op */
    };
  }

  return async () => {
    const linear = opts.services.getLinear();
    if (!linear) {
      opts.logger.info(
        "[hawkins/auto-recovery] linear api key not configured; skipping cross-reference. Set LINEAR_API_KEY or hawkins.linear.apiKey to enable.",
      );
      return;
    }

    try {
      const report = await scanRecovery(opts.services.ledger, linear);
      const resumable = report.items.filter((i: RecoveryItem) => i.lookupStatus === "ok");
      const orphaned = report.items.filter((i: RecoveryItem) => i.lookupStatus === "missing");
      const flaky = report.items.filter((i: RecoveryItem) => i.lookupStatus === "lookup_failed");

      if (report.items.length === 0) {
        opts.logger.info("[hawkins/auto-recovery] no unfinished orchestrations.");
        return;
      }

      opts.logger.warn(
        `[hawkins/auto-recovery] ${report.items.length} unfinished orchestration(s) found ` +
          `(resumable=${resumable.length} orphaned=${orphaned.length} lookup_failed=${flaky.length}). ` +
          `Run vines_recover to act on them.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.logger.error(`[hawkins/auto-recovery] scan failed: ${msg}`);
    }
  };
}
