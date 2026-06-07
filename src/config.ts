/**
 * Environment-driven configuration for VINES.
 *
 * Variables (see `vines/spec.md` §5):
 *
 *   MARIADB_URL       mariadb://host[:port]/database. Do NOT embed a password
 *                     here — the URL is stored in plaintext config, so a
 *                     password in it would leak. Set MARIADB_USER below and
 *                     supply MARIADB_PASSWORD via the gateway environment.
 *   MARIADB_USER      database user
 *   MARIADB_PASSWORD  password (from the gateway env / a 0600 EnvironmentFile)
 *   MARIADB_SSL       'disabled' | 'preferred' | 'required'
 *                     default 'preferred'. TLS modes always verify the server
 *                     certificate; use a CA-trusted cert or an SSH tunnel for
 *                     databases that present a self-signed cert.
 *   LINEAR_API_KEY    Linear personal API token (required for any Linear call)
 */

export type SslMode = "disabled" | "preferred" | "required";

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

  // A username may appear in the URL (it is not secret); the password must
  // not — it would be persisted in plaintext config. The password always
  // comes from the gateway environment.
  const user = parsed.username ? decodeURIComponent(parsed.username) : (env.MARIADB_USER ?? "");
  const password = env.MARIADB_PASSWORD ?? "";

  // Reject any password delimiter in the URL userinfo — even an empty password
  // (`user:@host`), where the WHATWG parser collapses `parsed.password` to "".
  // We inspect the raw authority so an empty-but-present password is still
  // caught, matching the bootstrap scripts.
  const authority = raw.replace(/^[^:]+:\/\//, "").split(/[/?#]/, 1)[0] ?? "";
  const atIndex = authority.lastIndexOf("@");
  const rawUserinfo = atIndex >= 0 ? authority.slice(0, atIndex) : "";
  if (rawUserinfo.includes(":")) {
    throw new Error(
      "MARIADB_URL must not contain a password (it would be stored in plaintext " +
        "config). Remove it from the URL and set MARIADB_PASSWORD in the gateway environment.",
    );
  }
  if (!user) {
    throw new Error("MARIADB_USER is required (or embed the user in MARIADB_URL)");
  }
  if (!password) {
    throw new Error("MARIADB_PASSWORD is required (set it in the gateway environment)");
  }

  // Node's URL parser already enforces a valid 0–65535 port range; if `port`
  // is present here it's well-formed.
  const port = parsed.port ? Number(parsed.port) : 3306;

  const sslMode = (env.MARIADB_SSL ?? "preferred").toLowerCase();
  if (!isSslMode(sslMode)) {
    throw new Error(`MARIADB_SSL must be one of disabled|preferred|required, got '${sslMode}'`);
  }

  return { host: parsed.hostname, port, user, password, database, sslMode };
}

/**
 * Translate {@link SslMode} into the `ssl` option of the `mariadb` driver.
 *  - disabled  → no TLS (returns false; driver connects plaintext)
 *  - preferred → TLS with server-certificate verification
 *  - required  → TLS with server-certificate verification (same as preferred
 *                for this driver; the server-side `REQUIRE SSL` enforces it)
 *
 * Every TLS mode verifies the server certificate (`rejectUnauthorized: true`).
 * There is intentionally no mode that disables verification: for a database
 * that presents a self-signed certificate, use a CA-trusted cert or tunnel the
 * connection over SSH instead (see SECURITY.md).
 */
export function sslOptionFor(mode: SslMode): boolean | { rejectUnauthorized: boolean } {
  switch (mode) {
    case "disabled":
      return false;
    case "preferred":
    case "required":
      return { rejectUnauthorized: true };
  }
}

/**
 * Attach the MariaDB `password` field onto an existing connection / pool
 * config object. The mariadb driver reads this field at connect / createPool
 * time. The value is an env-sourced credential, never a literal.
 */
export function attachDbCredential<T extends object>(target: T, password: string): T {
  (target as T & { password: string }).password = password;
  return target;
}

export function loadLinearApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.LINEAR_API_KEY;
  if (!key) {
    throw new Error("LINEAR_API_KEY is required (see vines/spec.md §5)");
  }
  return key;
}

function isSslMode(value: string): value is SslMode {
  return value === "disabled" || value === "preferred" || value === "required";
}
