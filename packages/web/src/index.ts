// @poe2/web -- Vite + React single-page app. Runtime entry is src/main.tsx (mounted by
// index.html). This barrel re-exports the pieces other modules / tests import by name.
//
// The 4-step wizard: docs/web-ui/05-frontend.md. The stylised tree canvas:
// docs/web-ui/06-tree-canvas.md. This package is carved out of the repo-root commonjs/no-DOM
// typecheck (docs/web-ui/08-fork-prep.md task 4) and typechecked under its own DOM+JSX options
// via `npm run build -w @poe2/web`. ./env.ts stays as the canary that locks that split in.
export const WEB_PACKAGE = "@poe2/web";

export * from "./render";
