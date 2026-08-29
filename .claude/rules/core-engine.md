---
paths:
  - "src/core/**"
---
<!-- generated-by: groundrules v1.10.0 -->

# src/core — invariants that must not regress

`src/core` holds the optimisation algorithms (recommend, extend, repair, rollback) and the
scoring logic. Pure business logic. Two invariants are load-bearing and easy to break silently:

- **Bridge injection.** Core receives a bridge and never constructs one. Every candidate batch
  funnels through a single `bridge.call(...)` — that funnel is what makes parallel evaluation
  and the `ParallelBridge` sharding transparent to core. Do not add a second call path.
- **Determinism.** Ranking is fully deterministic: the candidate pool is id-sorted and ties in
  the ranking are broken by node id. Same inputs must always produce the same plan.
- **Result shape.** Results carry `allocatedNodeIds: { before, after }`, both id-sorted and
  connected by construction; `after === before` means "change nothing". Keep this contract.
- **Objectives** live in `src/core/objective.ts` (`dps-ehp:W` / `blend:A,B,W`), memoised, with
  a `BuildOutput()` counter. Add new objectives there, not inline in the search loop.
