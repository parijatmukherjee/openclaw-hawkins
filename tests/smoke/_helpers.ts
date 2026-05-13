/**
 * Shared helpers for the smoke suite.
 *
 * Each smoke test exercises a real service. We want missing credentials to
 * produce a clean *skip* rather than a failure, so contributors who run
 * `npm test` without secrets aren't penalised. Use vitest's `skipIf`:
 *
 * @example
 *   import { it } from "vitest";
 *   import { missingEnv } from "./_helpers.js";
 *
 *   const required = ["MARIADB_URL", "MARIADB_USER", "MARIADB_PASSWORD"];
 *   it.skipIf(missingEnv(required))("ledger roundtrip", async () => { ... });
 */

export function missingEnv(vars: readonly string[]): boolean {
  return vars.some((v) => !process.env[v]);
}

export function describeMissing(vars: readonly string[]): string {
  const missing = vars.filter((v) => !process.env[v]);
  return missing.length > 0 ? `missing env: ${missing.join(", ")}` : "";
}
