# ADR-001 — Path of Building stays the fitness oracle

**Status:** Accepted (2026-08-28)

## Context

Every candidate tree must be scored by real PoE2 damage and defence math. GGG publishes data
exports, so a home-grown calc engine over those exports was on the table. Path of Building's
headless LuaJIT calc engine already implements the full formula and is the community standard.

## Decision

Use PoB-PoE2's own headless calc engine as the only fitness oracle. The GGG exports are data, not
the damage formula; reimplementing the formula is a multi-year effort with its own bug surface.
The ~280 ms/recompute cost is treated as a speed-lever problem (parallel bridge pool, candidate
pruning, objective-scoped `BuildOutput`), not an architecture problem.

## Consequences

- Hard dependency on the `pob-runtime/` submodule and a LuaJIT binary on `PATH`.
- Run wall-time is dominated by evaluation count. Mitigations: `ParallelBridge` (ADR-011),
  memoised evaluator, beam pruning.
- PoB-faithful *rendering* is explicitly not pulled in with it — see ADR-010.
- Full rationale and the speed-lever table: `intake/web-ui/07-performance.md`.
