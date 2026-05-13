import { defineConfig } from "vitest/config";

// Default config — runs the hermetic unit suite. Smoke tests live under
// tests/smoke/**.smoke.test.ts and are wired via `npm run smoke` so they
// stay out of CI unless explicitly requested.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/smoke/**", "node_modules/**", "dist/**"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
      reportsDirectory: "./coverage",
    },
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
