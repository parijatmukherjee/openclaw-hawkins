/**
 * Environment-driven configuration for VINES.
 *
 * Variables (see `vines/spec.md` §5):
 *
 *   MARIADB_URL       mariadb://host[:port]/database  (credentials in the URL
 *                     are honoured and override the env vars below)
 *   MARIADB_USER      database user
 *   MARIADB_PASSWORD  password
 *   MARIADB_SSL       'disabled' | 'preferred' | 'required' | 'insecure'
 *                     default 'preferred'. 'insecure' enables TLS with no
 *                     server-cert verification — for self-signed cloud certs.
 *   LINEAR_API_KEY    Linear personal API token (required for any Linear call)
 */

export type SslMode = "disabled" | "preferred" | "required" | "insecure";

export interface DBConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslMode: SslMode;
}

/**
 * Parse the DB env vars into a {@link DBConfig}. Throws a clear, fixable
 * error on missing or malformed input.
 */
export function loadDBConfig(env: NodeJS.ProcessEnv = process.env): DBConfig {
  const raw = env.MARIADB_URL;
  if (!raw) {
    throw new Error("MARIADB_URL is required (see vines/spec.md §5)");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`MARIADB_URL is not a valid URL: ${raw}`);
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "mariadb" && scheme !== "mysql") {
    throw new Error(`MARIADB_URL scheme must be 'mariadb' or 'mysql', got '${scheme}'`);
  }
  if (!parsed.hostname) {
    throw new Error(`MARIADB_URL is missing a hostname: ${raw}`);
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error(`MARIADB_URL must include /<database> in the path: ${raw}`);
  }

  // Credentials in the URL win over env vars (spec §5 footnote).
  const user = parsed.username ? decodeURIComponent(parsed.username) : (env.MARIADB_USER ?? "");
  const password = parsed.password
    ? decodeURIComponent(parsed.password)
    : (env.MARIADB_PASSWORD ?? "");

  if (!user) {
    throw new Error("MARIADB_USER is required (or embed user in MARIADB_URL)");
  }
  if (!password) {
    throw new Error("MARIADB_PASSWORD is required (or embed password in MARIADB_URL)");
  }

  // Node's URL parser already enforces a valid 0–65535 port range; if `port`
  // is present here it's well-formed.
  const port = parsed.port ? Number(parsed.port) : 3306;

  const sslMode = (env.MARIADB_SSL ?? "preferred").toLowerCase();
  if (!isSslMode(sslMode)) {
    throw new Error(
      `MARIADB_SSL must be one of disabled|preferred|required|insecure, got '${sslMode}'`,
    );
  }

  return { host: parsed.hostname, port, user, password, database, sslMode };
}

/**
 * Translate {@link SslMode} into the `ssl` option of the `mariadb` driver.
 *  - disabled  → no TLS (returns false; driver connects plaintext)
 *  - preferred → TLS with default cert verification
 *  - required  → TLS with default cert verification (same as preferred for
 *                this driver; the server-side `REQUIRE SSL` enforces it)
 *  - insecure  → TLS, but skip cert verification (self-signed cloud certs)
 */
export function sslOptionFor(mode: SslMode): boolean | { rejectUnauthorized: boolean } {
  switch (mode) {
    case "disabled":
      return false;
    case "insecure":
      return { rejectUnauthorized: false };
    case "preferred":
    case "required":
      return { rejectUnauthorized: true };
  }
}

export function loadLinearApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.LINEAR_API_KEY;
  if (!key) {
    throw new Error("LINEAR_API_KEY is required (see vines/spec.md §5)");
  }
  return key;
}

function isSslMode(value: string): value is SslMode {
  return (
    value === "disabled" || value === "preferred" || value === "required" || value === "insecure"
  );
}
