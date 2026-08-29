# ADR-006 — No build step: source-level aliases, not TS project references

**Status:** Accepted (2026-08-29)

## Context

The npm workspaces from ADR-005 need cross-package imports to resolve. TypeScript project
references would add a build graph and a compile step to every change.

## Decision

No build step and no TS project references. Cross-package imports resolve through
`tsconfig.base.json` `paths` plus a shared vitest alias (`vitest.alias.ts`). `tsc --noEmit` is the
type gate; nothing is emitted.

## Consequences

- A new workspace dep usually needs no `npm install` — the alias often already covers it. Check
  before touching the lockfile.
- `packages/web` is carved out of the commonjs typecheck; jsdom is wired via
  `environmentMatchGlobs`.
- Runtime uses `ts-node` / Vite directly.
