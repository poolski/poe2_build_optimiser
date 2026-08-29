# ADR-011 — Pool size and job parallelism default to half the host's cores

**Status:** Accepted (2026-08-29) — supersedes the v1 default (pool size 2, single run not
parallelised)

## Context

v1 shipped with `POOL_SIZE = 2` and no within-run parallelism, so a single run — the thing the
user waits on — stayed serial. Phase 1.5 added `ParallelBridge`: it shards one run's candidate
batch across a lease of pool slots, recombines byte-identically, and needed zero `src/core`
changes (core already funnels every batch through one `bridge.call(...)`).

## Decision

`POOL_SIZE` and `JOB_PARALLELISM` both default to `defaultPoolSize()` = half
`os.availableParallelism()`, floor 1. Half rather than all because PoB's calc is CPU-bound
(oversubscribing cores buys nothing) and each LuaJIT child is ~700 MB resident. Per-job
parallelism defaults to the whole pool so a single run is fully parallelised; a second concurrent
optimise job queues (strict FIFO) rather than both running at half speed.

## Consequences

- Admission is **slot-based**: `pump()` admits the FIFO head only when committed slots + the
  head's own `parallelism` fit `poolSize`. `maxActiveJobs` is an independent additional ceiling on
  running job count.
- `buildOutputCount` does **not** match the serial path exactly — sharding multiplies one tail
  `recomputeBuild()` per call; excess = `(N-1) × (steps.length-1)`. The plan is byte-identical.
- Not exposed as a per-request field — server-config-only (env `POOL_SIZE` / `JOB_PARALLELISM`),
  to avoid widening `packages/contract`.
- `/api/health` reports `registry.effectiveJobParallelism` (post-clamp), not the raw config.
- Design record: `intake/web-ui/01-bridge-service.md` §"Phase 1.5".
