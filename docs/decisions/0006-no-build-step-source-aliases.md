<!-- generated-by: groundrules v1.10.0 -->
# 0006 — No build step: source-level aliases, not TS project references

**Date**: 2026-08-29
**Status**: Accepted

## Context

The npm workspaces from ADR-0005 need cross-package imports to resolve. TypeScript project
references would add a build graph and a compile step to every change.

## Decision

No build step and no TS project references. Cross-package imports resolve through
`tsconfig.base.json` `paths` plus a shared vitest alias (`vitest.alias.ts`). `tsc --noEmit` is the
type gate; nothing is emitted.

## Alternatives considered

- **TS project references** — rejected: a build graph plus a compile step on every edit, for a
  repo that runs everything through `ts-node` / Vite anyway.
- **Publishing the workspaces as built packages** — rejected: nothing consumes them outside this
  repo.

## Consequences

### Positive
- A new workspace dep usually needs no `npm install` — the alias often already covers it. Check
  before touching the lockfile.

### Negative / Tradeoffs
- The alias list is duplicated between `tsconfig.base.json` and `vitest.alias.ts`; both must be
  updated when a package is added.

### Neutral
- `packages/web` is carved out of the commonjs typecheck; jsdom is wired via
  `environmentMatchGlobs`.
- Runtime uses `ts-node` / Vite directly.
