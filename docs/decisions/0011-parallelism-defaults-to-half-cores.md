<!-- generated-by: groundrules v1.10.0 -->
# 0011 — Pool size and job parallelism default to half the host's cores

**Date**: 2026-08-29
**Status**: Accepted — supersedes the v1 default (pool size 2, single run not parallelised)

## Context

v1 shipped with `POOL_SIZE = 2` and no within-run parallelism, so a single run — the thing the
user waits on — stayed serial. Phase 1.5 added `ParallelBridge`: it shards one run's candidate
batch across a lease of pool slots, recombines byte-identically, and needed zero `src/core`
changes (core already funnels every batch through one `bridge.call(...)`).

## Decision

`POOL_SIZE` and `JOB_PARALLELISM` both default to `defaultPoolSize()` = half
`os.availableParallelism()`, floor 1. Per-job parallelism defaults to the whole pool so a single
run is fully parallelised; a second concurrent optimise job queues (strict FIFO) rather than both
running at half speed.

## Alternatives considered

- **Default to all cores** — rejected: PoB's calc is CPU-bound, so oversubscribing buys nothing,
  and each LuaJIT child is ~700 MB resident.
- **Run concurrent jobs at half speed each instead of queueing** — rejected: strict FIFO gets the
  first user their answer sooner, and the app is single-user local anyway.
- **Expose parallelism per request** — rejected: it would widen `packages/contract` for a knob
  that is a property of the host, not of a job.

## Consequences

### Positive
- The single run a user waits on is fully parallelised without any `src/core` change.

### Negative / Tradeoffs
- `buildOutputCount` does **not** match the serial path exactly — sharding multiplies one tail
  `recomputeBuild()` per call; excess = `(N-1) × (steps.length-1)`. The plan is byte-identical.

### Neutral
- Admission is **slot-based**: `pump()` admits the FIFO head only when committed slots + the
  head's own `parallelism` fit `poolSize`. `maxActiveJobs` is an independent additional ceiling on
  running job count.
- Server-config-only (env `POOL_SIZE` / `JOB_PARALLELISM`).
- `/api/health` reports `registry.effectiveJobParallelism` (post-clamp), not the raw config.

## Notes

Design record: `intake/web-ui/01-bridge-service.md` §"Phase 1.5".
