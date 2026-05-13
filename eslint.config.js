// ESLint flat config for openclaw-hawkins (ESM, TypeScript).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
      parserOptions: {
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Prefer explicit returns on exported functions; relax for arrow helpers.
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // Allow `any` only where genuinely unavoidable (e.g. raw JSON payloads).
      "@typescript-eslint/no-explicit-any": "warn",
      // We use unused leading-underscore params as a deliberate signal.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Require error chaining when wrapping caught errors.
      "@typescript-eslint/only-throw-error": "error",
      // Promise hygiene.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // Keep imports tidy.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
  {
    // Tests get a softer hand: side-effecting setup, MagicMock-style fakes.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // `expect(spy.method).toHaveBeenCalled()` is the standard vitest pattern
      // even when `method` is unbound from its prototype; safe inside tests.
      "@typescript-eslint/unbound-method": "off",
      // `vi.fn(async () => ...)` factories may not contain an await.
      "@typescript-eslint/require-await": "off",
      // Mock helpers occasionally need `as never` / `as { ... }` casts
      // that the type checker sees as redundant but are load-bearing for the
      // dual-shape spies.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
];
