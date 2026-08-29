import * as path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dir = fileURLToPath(new URL(".", import.meta.url));

// Dev server for the SPA. Root vitest does NOT use this file (it runs web tests with esbuild's
// automatic JSX + jsdom -- see docs/web-ui/08-fork-prep.md task 5); the real @vitejs/plugin-react
// only lives here, resolved from packages/web/node_modules where vite@8 is nested.
//
// Cross-package imports resolve by source-level alias, not node_modules linking (repo convention):
// @poe2/contract -> packages/contract/src/index.ts. Mirrors tsconfig.base.json `paths` and
// vitest.alias.ts.
export default defineConfig({
  root: dir,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@poe2/contract": path.resolve(dir, "../contract/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssMinify: "esbuild",
  },
});
