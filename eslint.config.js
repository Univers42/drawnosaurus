import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  {
    // The engine is a submodule with its own toolchain — never lint it here.
    ignores: [
      "engine/**",
      "**/build/**",
      "**/dist/**",
      "**/.svelte-kit/**",
      "**/coverage/**",
      "**/node_modules/**",
      ".pnpm-store/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  {
    rules: {
      // The import firewall. engine/src/index.ts re-exports the React adapter,
      // so the bare barrel drags react/react-dom into a Svelte app that does not
      // have them installed — it fails at resolve time, not review time.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@osionos/draw-engine",
              message:
                "Bare barrel pulls in the React adapter. Import a deep path: @osionos/draw-engine/svelte, /types, /json, /camera, /engine.",
            },
          ],
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
