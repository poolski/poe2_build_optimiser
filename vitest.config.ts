import { configDefaults, defineConfig } from "vitest/config";
import { workspaceAlias } from "./vitest.alias";

// Default suite: fast unit tests -- fake PobBridgeClient, no luajit on PATH needed.
// Real-bridge tests live in *.integration.test.ts and run via `npm run test:integration`
// (see vitest.integration.config.ts).
//
// Web (packages/web) tests -- jsx + DOM -- run in this same suite via:
//   - environmentMatchGlobs: jsdom for packages/web/**, node everywhere else
//   - esbuild.jsx "automatic": the .tsx transform, using react's jsx-runtime
// NOT a vitest.workspace.ts: a workspace file is globally auto-discovered and makes *every*
// `vitest` invocation run *every* project, which breaks the --config split between this suite
// and the integration one (verified 2026-08-29 -- see intake/web-ui/08-fork-prep.md).
// NOT @vitejs/plugin-react: it needs vite@8, which npm nests under packages/web/node_modules
// (root has vitest 2.1's older vite), so the root config cannot require it. esbuild's built-in
// automatic JSX covers what the tests need; 05 can add the plugin to a web-local Vite/vitest
// setup when it builds the real dev server.
export default defineConfig({
  resolve: {
    alias: workspaceAlias,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.tsx",
    ],
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    environmentMatchGlobs: [["packages/web/**", "jsdom"]],
  },
});
