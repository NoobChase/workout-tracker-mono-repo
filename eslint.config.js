// @ts-check
// One flat config for the whole repo (specs step 2, decision 11). The point is
// the *type-aware* rules -- above all no-floating-promises, because a dropped
// `await` on a transaction is a silent data bug that tsc and most tests miss.
// No stylistic rules: Prettier owns formatting.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/cdk.out/",
      "packages/db/migrations/",
      "docs/legacy-*",
      // Not part of the build: design references and Impeccable's workspace.
      "design/",
      ".impeccable/",
      // Agent worktrees: separate checkouts, linted in their own right.
      ".claude/worktrees/",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Not in recommended-type-checked, and both earn their place here.
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      // node:test's describe/it return promises the runner itself tracks;
      // awaiting them is wrong, not just unnecessary.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: ["describe", "it", "test"],
            },
          ],
        },
      ],
    },
  },
  {
    // CDK's Template.findResources() returns CloudFormation as `any`; asserting
    // on it is the whole job of these tests.
    files: ["infra/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    // CloudFront Functions runtime: a script, not a module; `handler` is the
    // entry point CloudFront calls, so it is "unused" as far as ESLint can see.
    files: ["infra/lib/edge/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: "script", ecmaVersion: 2022 },
    rules: { "no-unused-vars": ["error", { varsIgnorePattern: "^handler$" }] },
  },
  {
    files: ["eslint.config.js"],
    extends: [js.configs.recommended],
  },
  prettier,
);
