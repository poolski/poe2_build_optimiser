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

## Point budget and starting mode

Two inputs the driver takes that greedy `recommendTree` does not model:

**`pointBudget`** — the total regular skill points the plan may occupy (already-allocated + newly
recommended). The seed loop stops here instead of running to the tree's absolute maximum.
`get_tree_status` returns `pointsMax = 99 + questPoints + extra` (`bridge.lua:628`) — the
*level-100 endgame* cap, not the character's current budget — so without this gate the seed plans
a 120-ish-point tree for a level-45 character and front-loads toward clusters that only pay off
once fully connected. Defaults: with an existing allocation loaded, `pointBudget = pointsUsed`
("re-optimise what I have, assume no more"); `--point-budget N` or `--target-level L` to plan
ahead; from-scratch mode defaults to `pointsMax`. A smaller budget also directly shrinks seed
length and repair depth `D` — a perf win, not just correctness.

**`respecBudget`** — how many *already-allocated* points the planner may relocate. This is the
single knob separating the two starting modes:

| Mode | `respecBudget` | Behaviour |
|---|---|---|
| **Extend** ("start from here") | `0` | Current allocation frozen. Driver only *adds* nodes, up to `pointBudget`, within proximity `K` of the existing frontier. No regret-set step. Output: "allocate these next, in this order." Lowest risk — the user committed to their tree and wants direction. |
| **Repair** | `N` | Seed from the current allocation, then free up to `N` lowest-value points (the regret set) and re-search. Output: "respec these `M`, allocate these instead." Costs in-game respec currency. |
| **From-scratch** | ∞ + bare tree | Deferred stretch goal. |

`freeze: nodeId[]` (or `freezeAscendancy: true`) marks nodes the regret set may never pick —
generalises the "freeze ascendancy in v1" open question below. Extend mode is `freeze = all
currently-allocated`.

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

Run each build in **both starting modes and at two `pointBudget` values** (current-level and
endgame). The extend-mode / low-budget cell is the common real user situation — a partially
levelled character asking "where next" — and must not regress even if repair-mode numbers look
better in aggregate.

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

**Steps 4–6 + 7 (extend mode) + 8/9 scaffolds DONE (2026-08-27, session 2, uncommitted).**
Live-verified against `RampantlyBisexual.xml`. New bridge RPCs this round: `get_stats_from`,
`list_allocatable_nodes_from` (both take an `allocSet`; the latter also `types`/`maxPathLength`
server-side filters), `get_metrics` / `reset_metrics` + a `recomputeBuild()` wrapper that counts
every `BuildOutput()`. New modules: `src/core/stats.ts` (shared num helpers), `src/core/objective.ts`
(`Objective`, `logBlend`, `metricObjective`, `parseObjective`), `src/core/evaluator.ts`
(`MemoEvaluator`), `src/core/optimiseTree.ts` (extend mode). 51 unit tests. What's NOT done:
repair mode (needs a dealloc-measurement RPC + arbitrary-allocation eval RPC + the
`ImportFromNodeList`/`DeallocNode` verifications — see gotchas.md), and a real corpus.

### Where to start next (recommended order)

**Ship leaf-only repair first.** It's the smaller half of step 7's repair bullet but it makes
repair mode real and unblocks the benchmark headline and the validation write-up. "Any allocated
node" repair (removing a mid-tree node cascades its downstream off too) is a later opt-in — it
needs the arbitrary-exact-allocation eval RPC and the `DeallocNode`-cascade verification, and it
changes nothing already built. Leaf-only avoids both: what's left after removing leaves is still
connected, so the "spend the freed points back" phase is exactly the extend-mode add-loop that
already works, and only one new bridge RPC is needed.

1. **Bridge: `evaluate_dealloc_candidates(nodeIds)`** — for each id: `DeallocNode` → `recomputeBuild`
   → record `{ nodeId, pointsFreed, ascFreed, stats }` → `RestoreUndoState`. Mirrors
   `evaluate_candidate_nodes` in reverse. Verify live: on a real build, a tip node reports
   `pointsFreed == 1`; a mid-tree node reports `> 1` (the cascade), which is exactly the signal
   the driver filters on.
2. **Bridge: `list_allocated_nodes`** — the currently-allocated non-class, non-ascendancy node
   ids (+ name/type/`isAscendancy`), so the driver knows the removal candidate set. Trivial
   filter over `spec.allocNodes`.
3. **Driver: repair path in `optimiseTree`** (`respecBudget > 0`) —
   - Regret set: run `evaluate_dealloc_candidates` over the allocated leaves (those with
     `pointsFreed == 1` — call it once on all allocated nodes, keep the leaves), rank by
     `score(baseline) − score(deallocStats)` ascending (least value lost first), take up to
     `respecBudget`.
   - Freed points `N` = size of that set. Base allocation for the add-back = loaded minus those
     leaves, which is connected, so it's expressible as an `allocSet` diff and reuses
     `evaluate_candidate_nodes_from` / the extend add-loop unchanged.
   - Re-spend `N` points with the extend-mode greedy/beam loop, scored and constraint-gated
     against the *post-removal* stats (not the loaded baseline).
   - Return `{ removed[], added[], better-of(loaded, repaired) }` — always able to fall back to
     "change nothing".
4. **Test** — fake-bridge unit tests for the regret ranking + fallback; then live on `Ranger.xml`
   (gutted L37 — repair should beat leave-alone) and `RampantlyBisexual.xml`.
5. Then step 10 (CLI flags), then step 9 (real benchmark run), then step 11 (write-up).

**In parallel, whenever a build is handy:** one *hand-tuned* build to pair with the naive
`Ranger.xml`, so step 11 can check both directions (improves a bad tree / leaves a good tree
alone). This is the only thing blocking a complete validation and it needs no code.

1. ~~**Bridge: `pathLength` on `list_allocatable_nodes`.**~~ DONE.
2. ~~**Bridge: `evaluate_candidate_nodes_from`.**~~ DONE (see note above re: the extra
   `BuildOutput()` on outer restore).
3. ~~**Objective keyword filter (layer 1).**~~ DONE.
4. ~~**Proximity gating helper (layer 2).**~~ DONE — `filterByProximity(nodes, k)` exported from
   `recommendTree.ts`; `RecommendTreeOptions.maxPathLength` + `OptimiseTreeOptions.proximity`;
   `list_allocatable_nodes_from` also gates server-side to shrink the payload.
5. ~~**Cross-beam memoization (layer 5).**~~ DONE — `MemoEvaluator` (`src/core/evaluator.ts`)
   wraps `evaluate_candidate_nodes_from` *and* `get_stats_from`, keyed on the sorted allocSet
   joined (lossless, no hash) + `:` + nodeId. Tracks `hits`/`misses`/`hitRate`/`cacheSize`.
   (Extend mode's linear walk never revisits a key, so its hit rate is ~0 — the cache earns its
   place only once repair's beam reconverges.)
6. ~~**Composite objective support.**~~ DONE — `src/core/objective.ts`: `logBlend`,
   `metricObjective`, `parseObjective` (`"dps-ehp:W"` / `"blend:A,B,W"` / bare metric).
   `RecommendTreeOptions.objectiveFn` + `OptimiseTreeOptions.objectiveFn`; baseline that can't be
   scored → throw; a candidate that can't be scored → dropped.
7. **Greedy-seed + local repair driver** — `src/core/optimiseTree.ts`.
   - ~~**Extend mode**~~ DONE (`respecBudget` 0 / unset): greedy walk outward from the loaded
     frontier, bounded by `pointBudget` (default `pointsUsed` → returns nothing) and `proximity`
     K, objective-scored, constraint-gated vs the loaded baseline, id-sorted pool + id-tie-broken
     pick. Returns ordered `steps[]`, `addedNodeIds`, `final`, `stoppedBecause`, `buildOutputCount`,
     `cacheHitRate`. Ascendancy steps are skipped (`ascendancyPointsSpent > 0`). Spike:
     `npm run optimise-tree-spike`. Live: `RampantlyBisexual +6 pts, K=2` → Concussive Attack /
     Vile Wounds / Essence of the Mountain, TotalDPS 39525 → 43509, 98 recomputes, 24s.
   - **Repair mode** (`respecBudget > 0`) — NOT DONE; `optimiseTree` throws. Do it in two
     passes; the leaf-only pass is sequenced step-by-step under **Where to start next** above.
     - **Leaf-only (do first):** `evaluate_dealloc_candidates` + `list_allocated_nodes` bridge
       RPCs; regret set = allocated leaves (`pointsFreed == 1`) ranked by value lost; re-spend
       the freed points with the extend add-loop against post-removal stats; return
       `better-of(loaded, repaired)` + diff. No new eval RPC — the post-removal tree is connected.
     - **Any-node (later opt-in):** allow non-leaf removal (cascades downstream off). Needs an
       arbitrary-exact-allocation eval RPC and the `DeallocNode`-cascade verification. Also folds
       in `freeze` / `freezeAscendancy` (general freeze list, not a special case) and, if the
       beam is still short on quality, the real `(W, D)` beam with per-beam-node constraint
       baselines instead of the plain greedy re-spend.
8. **Corpus assembly** — SCAFFOLD DONE, corpus not. `spike/characteriseBuild.ts` (`npm run
   characterise-build`) emits a manifest row; `docs/beam-corpus.md` holds the manifest + the
   gap list. Only 4 local builds today (one at 23 spare, three at 10; **two report `TotalDPS = 0`
   headless** so are DPS-objective-unusable). Still need mid-level (30–60 spare) builds, a
   hand-tuned/naive pair, and a held-out third.
9. **Benchmark harness** — SCAFFOLD DONE. `spike/benchTreeApproaches.ts` (`npm run
   bench-tree-approaches`) runs the corpus × approaches, emits the markdown table + a cost
   summary. The `BuildOutput()` counter (was "first sub-task") is done and wraps every call site.
   Today it only sweeps extend mode across K (no repair row, no greedy-vs-repair headline — that
   needs step 7 repair). Commit a table fixture once repair + corpus land.
10. **CLI + spike wiring.** `--beam-width`, `--beam-depth`, `--repair-nodes N`, `--proximity K`,
    `--point-budget N` / `--target-level L`, `--respec-budget N` (`0` = extend mode; also accept
    `--mode extend|repair`), `--freeze-ascendancy`, `--objective` (the preset flag already landed
    in step 3; extend for the step-6 blend, e.g. `--objective 'dps-ehp:0.5'`). Dev cap in the
    spike.
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
  **freeze** ascendancy allocations and only re-search regular points — via the general `freeze`
  mechanism (Point budget and starting mode), not a special case.
- **`targetLevel` → `pointBudget` derivation.** Needs the quest passive-point total for the acts
  a character of that level has plausibly cleared. `bridge.lua` already sums `maxWeaponSets` from
  `QuestRewards.lua` but only the whole-game total; a partial total is guesswork. v1 takes an
  explicit `--point-budget`; `--target-level` is a later nicety, and only if the act→quest-point
  mapping reads cleanly from vendored data (verify per
  [[feedback-verify-poe2-vs-poe1-assumptions]]). Also confirm `get_tree_status.pointsMax` is the
  endgame cap, not current-level — the `99 +` term in `bridge.lua:628` says it is, but check
  against a mid-level sample build before relying on the `pointBudget = pointsUsed` default.
- **Constraint baseline in repair.** A repair candidate is judged against the current beam node's
  measured stats, not the seed's — a repair step must not be scored against a stale baseline.
  `firstConstraintViolation` already takes `baseline` as a param, so this is a wiring choice, not
  new code.
- **ε for the "no change" regression test.** The constraint-rejection repro showed exact `0.0`
  landings with no float dust, so start with exact equality and add a relative ε only if a real
  run shows neutral-node noise (same call the status memory already made for constraints).
