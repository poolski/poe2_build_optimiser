import * as path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Real-bridge suite: boots actual LuaJIT PoB children. Needs luajit on PATH at the usual
// location or POB_LUAJIT_PATH set. Run with `npm run test:integration`; NOT part of `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@poe2/pob-bridge": path.resolve(__dirname, "packages/pob-bridge/src/index.ts"),
    },
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
