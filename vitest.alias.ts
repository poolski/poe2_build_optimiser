import * as path from "node:path";

// Single source of the workspace-package aliases for both vitest configs
// (vitest.config.ts + vitest.integration.config.ts). Adding a package now touches this
// file + tsconfig.base.json `paths` instead of three files.
//
// tsconfig.base.json `paths` stays the source of truth -- ts-node resolves via
// tsconfig-paths/register, and this file mirrors it. The asymmetry is intentional: the
// tsconfig has two entries per package (bare + "/*" for deep imports), the vitest aliases
// only need the bare form because nothing deep-imports a package in tests.
export const workspaceAlias: Record<string, string> = {
  "@poe2/pob-bridge": path.resolve(__dirname, "packages/pob-bridge/src/index.ts"),
  "@poe2/contract": path.resolve(__dirname, "packages/contract/src/index.ts"),
  "@poe2/api": path.resolve(__dirname, "packages/api/src/index.ts"),
  "@poe2/web": path.resolve(__dirname, "packages/web/src/index.ts"),
};
