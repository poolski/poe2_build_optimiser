import * as path from "node:path";
import { defineConfig } from "vitest/config";

// Single source-level alias so the workspace packages resolve to their TS entry points
// without a build step (mirrors the `paths` block in tsconfig.base.json for ts-node).
export default defineConfig({
  resolve: {
    alias: {
      "@poe2/pob-bridge": path.resolve(__dirname, "packages/pob-bridge/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
  },
});
