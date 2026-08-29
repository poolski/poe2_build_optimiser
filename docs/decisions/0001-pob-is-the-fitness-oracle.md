<!-- generated-by: groundrules v1.10.0 -->
# 0001 — Path of Building stays the fitness oracle

**Date**: 2026-08-28
**Status**: Accepted

## Context

Every candidate tree must be scored by real PoE2 damage and defence math. GGG publishes data
exports, so a home-grown calc engine over those exports was on the table. Path of Building's
headless LuaJIT calc engine already implements the full formula and is the community standard.

## Decision

Use PoB-PoE2's own headless calc engine as the only fitness oracle. The GGG exports are data, not
the damage formula. The ~280 ms/recompute cost is treated as a speed-lever problem (parallel
bridge pool, candidate pruning, objective-scoped `BuildOutput`), not an architecture problem.

## Alternatives considered

- **A home-grown calc engine over the GGG data exports** — rejected: reimplementing the full
  damage/defence formula is a multi-year effort with its own bug surface, and it would diverge
  from the community's reference numbers.
- **Scoring on a cheap proxy metric (node stat sums)** — rejected: it cannot see conversion,
  scaling breakpoints, or defensive interactions, which is exactly where the interesting
  allocations are.

## Consequences

### Positive
- Results match what players verify in PoB itself; no second formula to keep current per patch.

### Negative / Tradeoffs
- Hard dependency on the `pob-runtime/` submodule and a LuaJIT binary on `PATH`.
- Run wall-time is dominated by evaluation count. Mitigations: `ParallelBridge` (ADR-0011),
  memoised evaluator, beam pruning.

### Neutral
- PoB-faithful *rendering* is explicitly not pulled in with it — see ADR-0010 and ADR-0012.

## Notes

Full rationale and the speed-lever table: `intake/web-ui/07-performance.md`.
