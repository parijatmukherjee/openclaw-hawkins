import { defineConfig } from "vitest/config";

/**
 * Smoke-test config. Talks to real services (MariaDB, Linear, OpenClaw CLI).
 *
 * Each test starts with a `skipUnless(...)` check on the env vars it needs,
 * so missing credentials produce a clean skip rather than a failure. That
 * lets contributors and CI run `npm test` safely without secrets, while a
 * local operator running `npm run smoke` against a real environment can
 * verify the wiring end-to-end.
 *
 * No coverage thresholds here — the unit suite owns the coverage gate. Smoke
 * tests prove the wiring against real services.
 */
export default defineConfig({
  test: {
    include: ["tests/smoke/**/*.smoke.test.ts"],
    environment: "node",
    globals: false,
    // Real network + DB roundtrips need a touch more headroom than the unit
    // suite. Still capped so a hung Linear or DB doesn't wedge the run.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
