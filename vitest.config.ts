import * as path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Default suite: fast, fake-PobBridgeClient unit tests only -- no luajit on PATH needed.
// Real-bridge tests live in *.integration.test.ts and run via `npm run test:integration`
// (see vitest.integration.config.ts).
export default defineConfig({
  resolve: {
    alias: {
      "@poe2/pob-bridge": path.resolve(__dirname, "packages/pob-bridge/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
