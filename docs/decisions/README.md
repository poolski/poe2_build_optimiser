<!-- generated-by: groundrules v1.10.0 -->
# Architecture Decisions (ADR)

This folder contains the project's **Architecture Decision Records**: each structural decision made during the project is recorded in a file.

## Format

Inspired by [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). See `0000-template.md`.

## Naming convention

`NNNN-title-kebab.md` where NNNN is a 4-digit incremental integer.

Examples:
- `0001-database-choice.md`
- `0002-auth-pattern.md`

## When to create an ADR

When a decision:
- has a **long-term impact** on the architecture
- is **hard to reverse**
- has **explicit tradeoffs** worth documenting
- might be **revisited later** (better to freeze the context now)

No ADR needed for trivial choices or implementation details.

Add one with `/groundrules:add-adr`. After writing it, trim the prose that used to carry the
decision elsewhere down to a one-line pointer at the ADR. Detail and the running implementation
state live in `PLAN.md`, `intake/beam-search-design.md`, and `intake/web-ui/`.

## Index

| # | Title | Status | Date |
| --- | --- | --- | --- |
| 0000 | Template | — | — |
| [0001](0001-pob-is-the-fitness-oracle.md) | Path of Building stays the fitness oracle | Accepted | 2026-08-28 |
| [0002](0002-passive-tree-only-scope.md) | Scope is the passive tree only | Accepted | 2026-08-28 |
| [0003](0003-any-node-cascading-repair.md) | Any-node cascading repair, not leaf-only | Accepted | 2026-08-28 |
| [0004](0004-ehp-no-regression-floor.md) | The no-regression floor is `TotalEHP`, not elemental resists | Accepted | 2026-08-28 |
| [0005](0005-extract-pob-bridge-package.md) | Extract `packages/pob-bridge`; repo moves to npm workspaces | Accepted | 2026-08-28 |
| [0006](0006-no-build-step-source-aliases.md) | No build step: source-level aliases, not TS project references | Accepted | 2026-08-29 |
| [0007](0007-split-fast-and-integration-tests.md) | Split fast unit tests from real-bridge integration tests | Accepted | 2026-08-29 |
| [0008](0008-web-stack.md) | Web stack: Vite + React SPA, Hono API, Zod, no job-queue library | Accepted | 2026-08-28 |
| [0009](0009-build-input-paste-and-xml.md) | Build input: paste PoB code and `.xml` upload, both | Accepted | 2026-08-28 |
| [0010](0010-stylised-canvas-and-node-list-diff.md) | Result rendering: stylised tree canvas + node-list diff, both in v1 | Accepted (art clause superseded by 0012) | 2026-08-28 |
| [0011](0011-parallelism-defaults-to-half-cores.md) | Pool size and job parallelism default to half the host's cores | Accepted | 2026-08-29 |
| [0012](0012-repoe-fork-asset-source.md) | RePoE-fork is the web render layer's asset source | Accepted | 2026-08-29 |
| [0013](0013-close-out-live-progress-view-prd-defer-remaining-scope.md) | Close out live-progress-view PRD; defer sparkline, canvas highlight, and e2e check to a new feature | Accepted | 2026-08-30 |
| [0014](0014-bundle-configure-step-ui-ideas-into-one-feature-release.md) | Bundle Configure-step UI ideas into one feature release | Accepted | 2026-08-30 |
