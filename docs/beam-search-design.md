# Beam search / tree re-optimization — design + next-session plan

Successor to the greedy `recommendTree` (`src/core/recommendTree.ts`): instead of one pass
ranking the best *next* node, search a multi-step allocation. The dominant constraint is
performance — one candidate evaluation is one real `build.calcsTab:BuildOutput()`
(`pob-runtime/bridge.lua:704`), and a full reachable candidate set already exceeds ten minutes
for a *single* greedy pass. So the design is chosen around a candidate-pruning story, not around
search sophistication.

## Decision of record

Ship **greedy-seed + local beam repair**, not beam-search-from-scratch:

1. Run the existing greedy to a full allocation (the seed).
2. Identify the "regret set" — the allocated nodes with the lowest marginal delta-per-point.
3. Free those points and beam-search (width `W`, depth `D`) over re-allocations, restricted to
   nodes within `K` path-points of the resulting frontier, pruned per the layers below.
4. Return whichever of seed / repaired scores better on the target metric, plus a diff.

Rationale: degrades gracefully (worst case returns the seed unchanged), gets a real improvement
over greedy far sooner than from-scratch, and reuses every existing primitive. Weakness: cannot
discover a tree region the greedy never entered — accepted for v1, from-scratch stays a stretch
goal on the same infra.

## Perf target

```
beam evals ≈ W · D · P · C          (P = candidates per beam node per step, C = seconds per eval)
W=4, D=15, C≈0.5s, budget ~300s  ⇒  P ≲ 20
```

Observed: Notable+Keystone-only pool (hundreds of nodes) does not finish a single greedy pass in
120s, so C is ~0.3–1s. The job is cutting P from *hundreds* to **~15–25 real evals**.

## Pruning layers (cheap → expensive)

| Layer | What | Cost |
|---|---|---|
| **1. Objective keyword filter** | Generalize `keywordsForDamageType` to an objective spec `{ keywords, mode: 'prioritize' \| 'filter' }`. `filter` mode *drops* non-matching candidates (currently `damageType` only reorders). Preset for "physical + defence": Physical / Attack / Damage / Life / Armour / Evasion / Resist / Block + gating attributes; drop mana-regen / cast-speed / minion / curse / ailment-only. | free (text) |
| **2. Proximity gating** | Only consider candidates within `K` path-points of the current frontier (`K`=1–3, progressive). Beam expands locally anyway; also caps path-node drag-in to 0–2 instead of 8. Needs `pathLength` on `list_allocatable_nodes`. | free |
| **3. Corridor collapse** | The Iron Reflexes / Giant's Blood / Blood Magic gotcha (`docs/gotchas.md`) — many keystones behind one damage-notable corridor score identically. Detect shared path prefixes, evaluate the corridor entry once, branch into endpoints only if competitive. | cheap heuristic |
| **4. Approx pre-scoring** | Linear / log-linear delta estimate from stat lines vs a cached multiplier snapshot; real-evaluate only the top ~20. Same approximation the skill-optimiser design needs — build once, share. | medium effort |
| **5. Cross-beam memoization** | Cache `(hash(sorted allocSet), nodeId) → result`. Beam states that reconverge via different allocation order hit it. `BuildOutput` is not incremental, so this is the main way to reclaim repeated work. | cheap |
| **6. Progressive widening** | Start tight (`P`, `W` small); widen only when the beam's top scores are within ε (genuine ambiguity) and budget remains. Reuses `maxCandidates`. | control knob |

**MVP:** bridge changes + layers 1 + 2 + 5. Add 4 if still short; 3 and 6 are polish.

## Bridge changes required

The status memory previously said "no new bridge RPC expected" for this task — that was wrong.
`evaluate_candidate_nodes` always evaluates against the *loaded baseline* and rolls back to it
(`bridge.lua:698-716`); a beam node is `baseline + partial allocation`, which it cannot express.

- **`pathLength` on `list_allocatable_nodes`** — add `pathLength = #node.path` to each entry
  (`bridge.lua:646-654`). Free, already computed, no recompute. Mirror in the `AllocatableNode`
  TS interface.
- **`evaluate_candidate_nodes_from(allocSet, nodeIds)`** — create undo state, `AllocNode` each id
  in `allocSet`, `spec:BuildAllDependsAndPaths()`, run the existing per-candidate
  alloc/eval/rollback loop, then `RestoreUndoState` to the pre-`allocSet` state and rebuild paths
  once more. `evaluate_candidate_nodes` becomes the `allocSet = {}` case (refactor one onto the
  other). Same `node.path`-staleness discipline as the existing method.

## Measuring approach improvements

Comparing greedy (baseline) vs greedy-seed + repair vs (later) beam-from-scratch. The calc engine
is byte-deterministic (`docs/gotchas.md`), so quality is one number per (build, approach) — no
sampling, no variance analysis.

That determinism now also holds for the *search*, not just the calc: `recommendTree` sorts the
`list_allocatable_nodes` pool by node id before doing anything with it (that RPC yields nodes in
Lua `pairs()` order, which the spec leaves unfixed), and its final ranking breaks `deltaPerPoint`
ties by node id (ties are common — a keystone and its whole path corridor report the same bundled
delta). The beam driver must keep the same discipline: id-sorted candidate pools, id-tie-broken
frontier selection, never a random tiebreak.

Two axes: solution quality and cost.

### Quality

Pin the objective, point budget, and constraints identically across approaches, or the
comparison is meaningless.

- **Headline: target-metric lift at fixed point budget.** Same build, same N points to allocate,
  same objective scalar, same `constraints` / `preserveMetrics`. Report the final scalar,
  absolute and % vs greedy.
- **Single scalar objective.** Either `w·log(DPS) + (1−w)·log(EHP)` computed identically
  everywhere (sweep `w` ∈ {0.3, 0.5, 0.7}), or — fewer knobs — hold one metric as a
  `preserveMetrics` floor and maximize the other. The log-blend form is a new capability:
  `recommendTree` today ranks on a single `targetMetric` *key* (`stats[k] − baseline`), so an
  `objectiveFn(stats) → number` has to be threaded through the driver and the harness, with a
  guard for `TotalEHP` absent or ≤ 0 (it sits behind a conditional `CalcDefence.lua` block —
  `docs/gotchas.md`, and `recommendTree`'s own `finiteNumber` check) → that build is scored
  "objective undefined" and dropped from the comparison, not treated as `log(0)`. Tracked as
  step 6.
- **Feasibility is a gate, not a tiebreak.** An approach that beats another on DPS by dropping a
  resistance below cap is disqualified for that instance, not scored lower.
- **Head-to-head win / tie / loss across the corpus.** Report the distribution, not just mean
  lift — +5% mean with one −20% outlier is a bad trade.
- **Gap-to-optimal on small instances.** Instances small enough to brute-force (few spare points,
  tight `K`, Keystone-only pool): measure each heuristic's gap to the true optimum. Calibrates
  trust in greedy-repair on the large instances where brute force is impossible.

### Cost

- **`BuildOutput()` call count is the currency.** Add a counter to the bridge; report per run.
  Exact, deterministic, machine-independent — unlike wall-clock.
- **Wall-clock secondary**, median of 3–5 runs, machine noted.
- **Layer-5 cache hit rate** — how much repeated work memoization actually reclaims.

### Apples-to-apples checklist

Same builds · same points allocated · same objective + constraints · same vendored PoB data
(pinned) · deterministic beam tiebreaks (by node id, never random).

### Corpus

8–15 builds spanning defence layers (armour / evasion / ES / hybrid), damage types, and
spare-point counts (the constraint repro only fired at 23 spare points; 10 was too few). Include
≥1 hand-tuned build (repair must return ≈no change), ≥1 deliberately naive build (repair must
improve it), and a held-out subset never used while tuning `K` / `W` / `D`.

This does not exist yet: the repo has 3 sample builds (`Blood Mage.xml`, `RampantlyBisexual.xml`,
a `Monk/` dir) and only `RampantlyBisexual` has the high-spare-point regime the repair loop is
meant to exercise. Assembling and characterising the corpus (per-build: class, spare points,
defence layer, damage type, baseline stats, hand-tuned vs naive, held-out flag) is its own task —
the pole that gates the benchmark and the validation write-up. Tracked as step 8.

### Ablations

Run greedy-repair with pruning layers {1}, {1,2}, {1,2,5}, {1,2,4,5}. Quality delta should be ≈0
(pruning shouldn't cost quality); cost delta shows what each layer buys. A layer that meaningfully
drops quality is too aggressive and gets retuned.

## Next-session steps

Ordered; steps 1–3 are independent and parallelizable, and are the natural first chunk (they
unblock everything and are each testable alone).

**Steps 1–3 DONE (2026-08-27, uncommitted).** Verified live against
`RampantlyBisexual.xml` via `spike/verifyBeamBridge.ts`:
- Step 1: all 3821 reachable nodes carry `pathLength`; range 1–32; frontier-adjacent nodes
  read 1, distant weapon-cluster notables read 32.
- Step 2: (a) `evaluate_candidate_nodes_from([], ids)` byte-matches `evaluate_candidate_nodes`;
  (b) `get_stats` after a `from(allocSet=[…])` call byte-matches the pre-call baseline — but
  **only after adding a final `BuildOutput()` to the outer-restore branch**: `RestoreUndoState`
  reverts the spec, not `mainOutput`, and the beam driver calls this repeatedly so the next
  `CreateUndoState` must see a clean baseline. Empty-`allocSet` path left byte-identical.
  (c) a candidate measured over a partial alloc carries that alloc's stat contribution;
  (d) `from(allocSet=[a,b])` == `from(allocSet=[b,a])`.
- Step 3: `objective?: string | ObjectiveSpec` on `RecommendTreeOptions`; `ObjectiveSpec =
  { keywords, exclude?, mode: 'prioritize'|'filter' }`; `physical-defence` preset;
  `--objective <preset>` CLI flag; escape hatch = omit the option. Applied after `nodeTypes`,
  before `damageType` (which stays the primary sort). 6 new unit tests (24 total pass).
  Live: `--objective physical-defence` on the Keystone pool drops Chaos Inoculation / Resolute
  Technique / Eldritch Battery, keeps Iron Reflexes / Giant's Blood / Blood Magic.

1. ~~**Bridge: `pathLength` on `list_allocatable_nodes`.**~~ DONE.
2. ~~**Bridge: `evaluate_candidate_nodes_from`.**~~ DONE (see note above re: the extra
   `BuildOutput()` on outer restore).
3. ~~**Objective keyword filter (layer 1).**~~ DONE.
4. **Proximity gating helper (layer 2).** `filter candidates to pathLength <= K`, `K` a param.
   Unit test.
5. **Cross-beam memoization (layer 5).** `Map` keyed on `hash(sorted allocSet) + ':' + nodeId`,
   wrapping the `evaluate_candidate_nodes_from` calls. Unit-test the cache-hit path (call count
   against the fake bridge).
6. **Composite objective support.** An `objectiveFn(stats) → number` seam so search and benchmark
   can optimise a blend, not just a single `mainOutput` key. Provide a builder for
   `w·log(DPS) + (1−w)·log(EHP)` (any two metrics, any `w`), and the absent/≤0 guard: if either
   input metric is missing or non-positive the objective is `undefined` and that build is
   excluded from a comparison rather than scored as `log(0)`. Thread it through `recommendTree`
   (or a thin wrapper the driver and `benchTreeApproaches` both call) alongside the existing
   `targetMetric` path. Unit-test the blend math and the guard with the fake bridge.
7. **Greedy-seed + local repair driver.**
   - Seed: loop the existing greedy pick → apply → repeat until points exhausted (feed the
     growing set to `evaluate_candidate_nodes_from`).
   - Regret set: the N allocated nodes with lowest marginal delta-per-point (re-measure by
     removing each).
   - Repair: free those points, beam `(W, D)` over re-allocations within proximity `K`, using
     steps 3–6 for pruning + objective and `constraints` / `preserveMetrics` as the feasibility
     gate — evaluated against the *current beam node's* stats, not the seed baseline. Id-sorted
     pools, id-tie-broken frontier (per Measuring approach improvements).
   - Return better-of(seed, repaired) + a node diff.
8. **Corpus assembly.** Source the 8–15 build XMLs described under Corpus (repo has 3 today, one
   in the right spare-point regime). Land them under a fixtures dir with a manifest
   (`docs/beam-corpus.md` or a typed `spike/corpus.ts`) recording per build: class, spare points,
   defence layer, damage type, baseline stats, hand-tuned vs naive, held-out flag. Gates 9 and
   11. Can run in parallel with 4–7.
9. **Benchmark harness (see Measuring approach improvements).** `spike/benchTreeApproaches.ts`:
   for each (build × approach) record `{ final objective, per-metric stats, nodes allocated,
   BuildOutput count, wall-clock, feasible? }`; emit a markdown/CSV table + summary (mean lift vs
   greedy, win/tie/loss, median & p90 BuildOutput count). Commit the table as a fixture and diff
   it when an approach changes. First sub-task: a `BuildOutput()` counter on the bridge — a
   module-level count wrapping *every* `build.calcsTab:BuildOutput()` call site (including the
   step-2 outer-restore rebuild), plus `get_metrics` / `reset_metrics` RPCs.
10. **CLI + spike wiring.** `--beam-width`, `--beam-depth`, `--repair-nodes N`, `--proximity K`,
    `--objective` (the preset flag already landed in step 3; extend for the step-6 blend, e.g.
    `--objective 'dps-ehp:0.5'`). Dev cap in the spike.
11. **Validation.** Find a build where greedy is demonstrably suboptimal (a local notable blocking
    a better cluster); show repair improves the target metric. Regression: on a tuned build,
    repair returns no changes (within ε). Write up as `docs/beam-search-repro.md`, mirroring
    `docs/constraint-rejection-repro.md` — the harness table is its quantitative backing.

## Open questions to resolve early

- **Seed application cost.** Each seed step re-allocs the whole growing set from scratch inside
  `evaluate_candidate_nodes_from` (O(D²) alloc ops). Alloc is cheap vs `BuildOutput`, so probably
  fine — confirm on a real build before optimizing. If it bites, add a stateful "apply
  allocation to the working tree" RPC.
- **Ascendancy nodes.** Greedy tracks `ascendancyPointsSpent` separately. v1 repair should
  **freeze** ascendancy allocations and only re-search regular points.
- **Constraint baseline in repair.** A repair candidate is judged against the current beam node's
  measured stats, not the seed's — a repair step must not be scored against a stale baseline.
  `firstConstraintViolation` already takes `baseline` as a param, so this is a wiring choice, not
  new code.
- **ε for the "no change" regression test.** The constraint-rejection repro showed exact `0.0`
  landings with no float dust, so start with exact equality and add a relative ε only if a real
  run shows neutral-node noise (same call the status memory already made for constraints).
