// @poe2/web -- Vite + React single-page app. The wizard (input -> config -> progress ->
// results) lands in phase 3; see docs/web-ui/05-frontend.md and 06-tree-canvas.md.
//
// SKELETON ONLY. This package is deliberately carved out of the repo-root commonjs/no-DOM
// typecheck (see docs/web-ui/08-fork-prep.md task 4): the root tsconfig excludes
// packages/web/**, and this package is typechecked under its own DOM+JSX options via
// `npm run build -w @poe2/web`. See ./env.ts for the canary that locks that split in.
export const WEB_PACKAGE = "@poe2/web";
