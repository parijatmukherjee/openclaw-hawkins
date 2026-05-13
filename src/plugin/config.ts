/**
 * Plugin config overlay. Plugin config (from `openclaw config set`) wins over
 * env vars; env vars provide the fallback so the standalone CLI keeps working
 * unchanged.
 */
import type { DBConfig } from "../config.js";
import { loadDBConfig } from "../config.js";

/**
 * Plugin config shape. Mirrors `openclaw.plugin.json` configSchema.
 *
 * NOTE: secret fields (`mariadb.password`, `linear.apiKey`) are intentionally
 * NOT part of this type — the configSchema rejects them so they cannot leak
 * into `openclaw.json` as plaintext. They MUST come via the gateway env
 * (`MARIADB_PASSWORD`, `LINEAR_API_KEY`) and are resolved by the fallback in
 * `resolveDBConfig` / `resolveLinearApiKey`.
 */
export interface HawkinsPluginConfig {
  mariadb?: {
    url?: string;
    user?: string;
    ssl?: "disabled" | "preferred" | "required" | "insecure";
  };
  autoRecovery?: boolean;
  vecna?: {
    dedupWindowMinutes?: number;
  };
}

/**
 * Build a synthetic env object that overlays plugin config on top of
 * `process.env`, then feed it to {@link loadDBConfig}. Plugin config wins.
 */
export function resolveDBConfig(
  pluginConfig: HawkinsPluginConfig,
  env: NodeJS.ProcessEnv = process.env,
): DBConfig {
  const overlay: NodeJS.ProcessEnv = { ...env };
  if (pluginConfig.mariadb?.url) overlay.MARIADB_URL = pluginConfig.mariadb.url;
  if (pluginConfig.mariadb?.user) overlay.MARIADB_USER = pluginConfig.mariadb.user;
  if (pluginConfig.mariadb?.ssl) overlay.MARIADB_SSL = pluginConfig.mariadb.ssl;
  // MARIADB_PASSWORD comes from `env` only — never from pluginConfig (see type doc).
  return loadDBConfig(overlay);
}

export function resolveLinearApiKey(
  _pluginConfig: HawkinsPluginConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  // Secrets never come from pluginConfig — see type doc.
  return env.LINEAR_API_KEY ?? null;
}

export function resolveDedupWindow(pluginConfig: HawkinsPluginConfig): number {
  const v = pluginConfig.vecna?.dedupWindowMinutes;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  const env = process.env.VECNA_DEDUP_WINDOW_MIN;
  if (env !== undefined) {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 5;
}

export function isAutoRecoveryEnabled(pluginConfig: HawkinsPluginConfig): boolean {
  return pluginConfig.autoRecovery === true;
}
