// Scaffold canary -- keep this file until real DOM code lands in phase 3.
//
// It is a plain `.ts` file (NOT `.tsx`) that touches `document` and a DOM lib type. The
// repo-root tsconfig globs `packages/*/src/**/*.ts`, so before the fork-prep split this file
// would be pulled into the root commonjs/`lib: ["ES2022"]` program and fail with
// "Cannot find name 'document'". It must:
//   1. be invisible to the root typecheck  -> root tsconfig `exclude` lists `packages/web/**`
//   2. typecheck fine on its own           -> this package's tsconfig adds DOM + DOM.Iterable
// If `npm run build` (root) ever fails here, the exclude regressed; if
// `npm run build -w @poe2/web` fails here, the web tsconfig lib list regressed.
export function findRoot(): HTMLElement {
  const el: HTMLElement | null = document.getElementById("root");
  if (!el) throw new Error("#root not found");
  return el;
}

export function isCanvas(node: Element | null): node is HTMLCanvasElement {
  return node instanceof HTMLCanvasElement;
}
