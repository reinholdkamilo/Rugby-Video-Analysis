import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Existing pages intentionally load remote data from effects. These React 19
      // compiler-oriented rules are tracked for gradual refactoring and should not
      // block the stabilisation baseline.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      // Legacy navigation remains functional and will be migrated to next/link as
      // individual pages are modernised.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
