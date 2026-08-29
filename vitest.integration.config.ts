import { configDefaults, defineConfig } from "vitest/config";
import { workspaceAlias } from "./vitest.alias";

// Real-bridge suite: boots actual LuaJIT PoB children. Needs luajit on PATH at the usual
// location or POB_LUAJIT_PATH set. Run with `npm run test:integration`; NOT part of `npm test`.
export default defineConfig({
  resolve: {
    alias: workspaceAlias,
  },
  test: {
    include: ["src/**/*.integration.test.ts", "packages/*/src/**/*.integration.test.ts"],
    exclude: [...configDefaults.exclude],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // PoB children are the unit under test; keep them from racing for the machine.
    fileParallelism: false,
  },
});
