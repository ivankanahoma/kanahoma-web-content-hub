// Vite compiles JSX, it does not check it. A component referencing a variable that is
// not in scope builds cleanly and blanks the page at runtime, which is how a misplaced
// hook took the Leadership screen down. `no-undef` catches exactly that.

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "supabase/functions/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Real, and pre-existing across four components: props synced into state, and a
      // clock read during render. Worth fixing, but not while they would drown out the
      // errors this config exists to catch. Warnings so they stay visible every run.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      // JSX reads as "unused" to the base rules, which have no idea it is markup.
      "no-unused-vars": ["warn", { varsIgnorePattern: "^[A-Z]", args: "none" }],
    },
  },
  {
    files: ["test/**/*.mjs", "scripts/**/*.{js,mjs}", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
