/**
 * VECNA-specific configuration (env vars).
 *
 * DB connection reuses VINES's loader (`src/config.ts`). VECNA-only knobs
 * live here.
 */

import { loadDBConfig as loadVinesDBConfig } from "../config.js";
import type { DBConfig } from "../config.js";

export interface VecnaConfig {
  host: string;
  port: number;
  authToken: string | null;
  dedupWindowMinutes: number;
  db: DBConfig;
}

export interface ClientConfig {
  url: string;
  authToken: string | null;
  timeoutMs: number;
}

export function loadVecnaServerConfig(env: NodeJS.ProcessEnv = process.env): VecnaConfig {
  const host = env.VECNA_HOST ?? "127.0.0.1";
  const port = Number(env.VECNA_PORT ?? 8765);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`VECNA_PORT must be a valid TCP port; got '${env.VECNA_PORT}'`);
  }
  const window = Number(env.VECNA_DEDUP_WINDOW_MIN ?? 5);
  if (!Number.isFinite(window) || window < 0) {
    throw new Error(
      `VECNA_DEDUP_WINDOW_MIN must be a non-negative number; got '${env.VECNA_DEDUP_WINDOW_MIN}'`,
    );
  }
  const authToken = env.VECNA_AUTH_TOKEN ?? null;
  if (authToken !== null && authToken.length === 0) {
    throw new Error("VECNA_AUTH_TOKEN, when set, must be non-empty");
  }
  return {
    host,
    port,
    authToken,
    dedupWindowMinutes: window,
    db: loadVinesDBConfig(env),
  };
}

export function loadVecnaClientConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const url = (env.VECNA_URL ?? "http://127.0.0.1:8765").replace(/\/+$/, "");
  try {
    new URL(url);
  } catch {
    throw new Error(`VECNA_URL is not a valid URL: ${url}`);
  }
  const timeoutMs = Number(env.VECNA_TIMEOUT_MS ?? 10_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`VECNA_TIMEOUT_MS must be a positive number; got '${env.VECNA_TIMEOUT_MS}'`);
  }
  // Match the server-side validation: an empty `VECNA_AUTH_TOKEN` is
  // suspicious — fail loud rather than silently authenticating with `""`.
  const authToken = env.VECNA_AUTH_TOKEN ?? null;
  if (authToken !== null && authToken.length === 0) {
    throw new Error("VECNA_AUTH_TOKEN, when set, must be non-empty");
  }
  return { url, authToken, timeoutMs };
}
