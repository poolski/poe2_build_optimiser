# Performance — the oracle decision + the speed levers

Cross-cutting. Not phased — this is the reference for "why is it slow" and "what can we do about
it", so a future session doesn't re-litigate the architecture.

## Decision of record — PoB's headless calc is the fitness oracle

`optimiseTree` / `recommendTree` score every candidate with one real
`build.calcsTab:BuildOutput()` (`pob-runtime/bridge.lua`), ~250–310 ms each. That is the
dominant cost. The recurring question is whether to drop PoB and score against GGG's own data
exports with a home-grown engine. **No.** Reasons, recorded so this stays settled:

- **GGG exports *data*, not the formula.** The developer exports give the passive tree (stat
  lines as text — `15% increased Physical Damage`), gem data, base items, the mod pool. GGG has
  never published the damage/defence calculation. Turning stat text + skill base values +
  conversion order + penetration + ailments + `more` multipliers + the iterative EHP model into
  a number *is* `Modules/Calc*.lua` (~40k lines). PoB already consumes the same GGG exports; the
  exports were never the hard part.
- **"Our own engine" = reimplement PoB's calc.** Person-years, not weeks. PoB-PoE2 has a team
  and still churns every patch.
- **Guaranteed less accurate**, on a patch treadmill. The project already runs a "verify PoE2 vs
  PoE1 assumptions, don't assume" discipline (`docs/gotchas.md`) because *even PoB* carries
  leftover-PoE1 quirks. A from-scratch engine multiplies that surface and needs chasing GGG's
  undocumented changes every league.
- **Off-model from the user.** Users live in PoB. An oracle that computes exactly what PoB
  displays means a recommendation the user applies and sees confirmed. An independent engine
  that disagrees by a few percent is worse than useless here.
- **Nobody in the ecosystem has done it** and it isn't for lack of the exports —
  `poe2-tools/poe2-build-planner` does no DPS calc at all and lists PoB as the data fallback.

The web UI does not change this: a run stays minutes, which is why the whole design is
submit → progress stream → result (`04`, `05`). Interactive *feel* comes from parallelism +
progress, not a faster oracle.

## Cost model

```
evals ≈ P · W · D · (1 + Ksweep)        per optimise run
  P  = real candidates evaluated per add-step   (after the cheap screens)
  W  = beam width         (default 1)
  D  = add-steps          (≈ points to spend)
  Ksweep = repair k-sweep iterations   (0 in extend mode)
wall ≈ evals · 0.28 s / effectiveConcurrency
```

Measured: strong L100 `repair-r6` runs hit 1900–2700 recomputes → ~15–37 min single-threaded
(`docs/beam-search-design.md` §Cost). The whole game is cutting `P` before it costs a recompute,
and overlapping the recomputes that remain.

## The levers

Ordered by leverage for the web-UI track. "Search-side" levers are specified in detail in
`docs/beam-search-design.md` §"Pruning layers" — not duplicated here, just placed in the
bigger picture.

| # | Lever | Effect | Status | Where |
|---|-------|--------|--------|-------|
| 1 | **Parallel bridge pool** | Overlap independent recomputes across cores. Near-linear to `min(cores−2, pool size)`. The bench proved it: 8.3 core-hours → 1h20m at N=8. For the UI, a single build's run parallelises at the **candidate-batch** level within an add-step (evaluate a step's P candidates across the pool), not just across jobs. | **designed** — `PobBridgePool`, phase 1 (`01`). Bench ref: `runWithConcurrency`, `spike/benchTreeApproaches.ts:277` | `01-bridge-service.md` |
| 2 | **Cross-beam memoisation** | Cache `(sorted allocSet, nodeId) → result`; beam states that reconverge via different order hit it. `BuildOutput` isn't incremental, so this is the main way to reclaim repeated work. Earns its place only at `W > 1`. | **done** — `MemoEvaluator`, `src/core/evaluator.ts` (pruning layer 5) | `beam-search-design.md` |
| 3 | **Cheap candidate screens** | Objective keyword filter (drop non-matching stat lines) + proximity gating (only nodes within `K` path-points of the frontier; also caps path-node drag-in). Cuts `P` from hundreds to tens at zero recompute cost. | **done** — layers 1 & 2 | `beam-search-design.md` |
| 4 | **Approx pre-scoring** | Linear / log-linear delta estimate from stat lines vs a cached multiplier snapshot; real-evaluate only the top ~20. This is the honest version of "score without PoB" — a *filter*, not the oracle. Directional only: `15% increased phys` is worthless to a no-phys build and huge to another, and telling them apart needs build context, i.e. a partial calc. Good enough to rank a shortlist into. | **deferred** — layer 4, past v1 | `beam-search-design.md` |
| 5 | **Objective-scoped BuildOutput** | Skip calc sections the active objective never reads: the iterative EHP model when scoring raw `TotalDPS`; minion / ailment breakdowns when scoring EHP. Zero accuracy loss *on the scored metric*. Needs profiling `recomputeBuild()` to see what's safely skippable and a bridge-side flag (`recompute_build({ only: "offence" })`). Unmeasured upside — could be a large fraction of the 280 ms, could be little. | **unexplored** — new; bridge change | this file → a spike |
| 6 | **Corridor collapse** | Many keystones behind one shared damage-notable corridor score identically (Iron Reflexes / Giant's Blood / Blood Magic gotcha). Evaluate the corridor entry once, branch into endpoints only if competitive. | **deferred** — layer 3 | `beam-search-design.md`, `gotchas.md` |
| 7 | **Progressive widening** | Start tight (`P`, `W` small); widen only where the beam's top scores are within ε (genuine ambiguity) and budget remains. | **deferred** — layer 6 | `beam-search-design.md` |
| 8 | **Beam-width default sweep** | `W = 1` today (byte-identical to the old greedy walk). A bench sweep to justify a higher default is still open — a wider default trades evals for quality, so it's a cost decision. | **follow-up** — open | `status.md`, `beam-search-design.md` |
| 9 | **Warm the pool on boot** | `pool.warm()` spawns all LuaJIT children up front so the first few jobs don't each eat a cold PoB boot (seconds). Pure latency-hiding, no throughput change. | **optional** — phase 1 | `01-bridge-service.md` |
| 10 | **Surrogate-assisted search** | Train a fast approximation on PoB outputs, run the inner beam loop on the surrogate, validate the top-N with real PoB evals. Known technique; could genuinely cut wall time. But: a training pipeline, retraining per patch, and a failure mode of confidently mis-ranking a node in some build contexts. Research project, not a shortcut. | **not planned** — past v1 | this file |

## What not to do

- **Reimplement the calc** (see the decision of record).
- **Cache results across builds.** The memo key is per-build allocation state; nothing transfers.
- **Trade determinism for speed.** `optimiseTree` / `recommendTree` are one value per
  `(build, options)` and the bench relies on it. Any lever that reorders candidate evaluation
  must keep the id-sorted pool + id-tie-broken selection.

## If wall time becomes the blocker for the UI

Do them in this order, stopping when it's fast enough:

1. Ship lever 1 (the pool is already in the plan) — parallelise the per-add-step candidate batch.
2. Spike lever 5 (objective-scoped BuildOutput) — bounded, no accuracy cost, one bridge flag.
3. Land layer 4 (approx pre-scoring) from the beam-search deferred list.
4. Only then consider lever 10.
