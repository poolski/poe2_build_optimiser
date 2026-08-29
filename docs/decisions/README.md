<!-- generated-by: groundrules v1.10.0 -->
# Architecture Decision Records

Records of significant decisions and their rationale — the "why" behind major choices, for future
maintainers and for understanding trade-offs.

## Format

Each ADR is a markdown file named `ADR-NNN-title.md` with:

- **Status** — Accepted / Rejected / Superseded / Deprecated (+ date; note what it supersedes)
- **Context** — the situation that prompted the decision
- **Decision** — the choice and why it matters
- **Consequences** — what follows; trade-offs

Keep them short. Detail and the running implementation state live in `PLAN.md`,
`intake/beam-search-design.md`, and `intake/web-ui/`.

## To add a decision

1. Take the next number (they are listed chronologically below).
2. Write the ADR with the sections above.
3. Add it to the list here.
4. Trim the prose that used to carry the decision elsewhere down to a one-line pointer at this ADR.

## ADRs

| # | Decision | Status |
|---|----------|--------|
| [001](ADR-001-pob-is-the-fitness-oracle.md) | PoB stays the fitness oracle | Accepted |
| [002](ADR-002-passive-tree-only-scope.md) | Scope is the passive tree only | Accepted |
| [003](ADR-003-any-node-cascading-repair.md) | Any-node cascading repair, not leaf-only | Accepted (supersedes leaf-only) |
| [004](ADR-004-ehp-no-regression-floor.md) | No-regression floor is `TotalEHP`, not resists | Accepted (supersedes resist floor) |
| [005](ADR-005-extract-pob-bridge-package.md) | Extract `packages/pob-bridge`; npm workspaces | Accepted |
| [006](ADR-006-no-build-step-source-aliases.md) | No build step — source-level aliases | Accepted |
| [007](ADR-007-split-fast-and-integration-tests.md) | Split fast unit / real-bridge integration tests | Accepted |
| [008](ADR-008-web-stack.md) | Web stack — Vite + React + Hono + Zod, no queue lib | Accepted |
| [009](ADR-009-build-input-paste-and-xml.md) | Build input — paste PoB code and `.xml` upload | Accepted |
| [010](ADR-010-stylised-canvas-and-node-list-diff.md) | Stylised tree canvas + node-list diff, both in v1 | Accepted |
| [011](ADR-011-parallelism-defaults-to-half-cores.md) | Pool + job parallelism default to half the host's cores | Accepted (supersedes v1 size-2) |
