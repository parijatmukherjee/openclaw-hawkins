/**
 * Lazy DI container for plugin services. Holds singletons of `Ledger`,
 * `HiveStore`, and `LinearClient`, instantiated on first access so that the
 * plugin doesn't open a MariaDB pool just by being loaded.
 *
 * Each accessor throws a clear, fixable error if the underlying config is
 * missing. This keeps the failure mode user-friendly: a misconfigured plugin
 * fails on the first tool call, not at gateway startup.
 */
import { Ledger } from "../persistence.js";
import { HiveStore } from "../hive/store.js";
import { LinearClient } from "../linear-client.js";
import {
  type HawkinsPluginConfig,
  resolveDBConfig,
  resolveDedupWindow,
  resolveLinearApiKey,
} from "./config.js";

export interface HawkinsServices {
  readonly ledger: Ledger;
  readonly hive: HiveStore;
  /**
   * Returns the LinearClient if a Linear API key is configured; null otherwise.
   * VINES recovery works without Linear (degrading to ledger-only state), so we
   * don't force the dep.
   */
  getLinear(): LinearClient | null;
  /** Releases all underlying connections. Called on plugin deactivate. */
  close(): Promise<void>;
}

export function createServices(pluginConfig: HawkinsPluginConfig): HawkinsServices {
  let ledger: Ledger | null = null;
  let hive: HiveStore | null = null;
  let linear: LinearClient | null = null;
  let linearChecked = false;

  function ensureLedger(): Ledger {
    if (!ledger) {
      ledger = new Ledger(resolveDBConfig(pluginConfig));
    }
    return ledger;
  }

  function ensureHive(): HiveStore {
    if (!hive) {
      hive = new HiveStore({
        db: resolveDBConfig(pluginConfig),
        dedupWindowMinutes: resolveDedupWindow(pluginConfig),
      });
    }
    return hive;
  }

  return {
    get ledger() {
      return ensureLedger();
    },
    get hive() {
      return ensureHive();
    },
    getLinear() {
      if (linearChecked) return linear;
      linearChecked = true;
      const key = resolveLinearApiKey(pluginConfig);
      if (!key) return null;
      linear = new LinearClient({ apiKey: key });
      return linear;
    },
    async close() {
      const tasks: Promise<unknown>[] = [];
      if (ledger) tasks.push(ledger.close());
      if (hive) tasks.push(hive.close());
      await Promise.allSettled(tasks);
      ledger = null;
      hive = null;
      linear = null;
      linearChecked = false;
    },
  };
}
