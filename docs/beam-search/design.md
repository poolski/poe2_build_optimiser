# Beam search / tree re-optimization — design + implementation status

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

*Built:* greedy seed + any-node (cascading) repair + a real width-`W` beam over the add-loop
(`beamAddLoop`, shared by extend and repair; `--beam-width` / `--beam-depth`). `beamWidth 1` is
byte-identical to the original greedy walk and stays the default — a bench sweep to justify a
higher default is a follow-up.

## Point budget and starting mode

Two inputs the driver takes that greedy `recommendTree` does not model:

**`pointBudget`** — the total regular skill points the plan may occupy (already-allocated + newly
recommended). The seed loop stops here instead of running to the tree's absolute maximum.
`get_tree_status` returns `pointsMax = 99 + questPoints + extra` (`bridge.lua:628`) — the
*level-100 endgame* cap, not the character's current budget — so without this gate the seed plans
a 120-ish-point tree for a level-45 character and front-loads toward clusters that only pay off
once fully connected. Defaults: with an existing allocation loaded, `pointBudget = pointsUsed`
("re-optimise what I have, assume no more"); `--point-budget N` or `--extra-points N` to plan
ahead; from-scratch mode defaults to `pointsMax`. A smaller budget also directly shrinks seed
length and repair depth `D` — a perf win, not just correctness.

**`respecBudget`** — how many *already-allocated* points the planner may relocate. This is the
single knob separating the two starting modes:

| Mode | `respecBudget` | Behaviour |
|---|---|---|
| **Extend** ("start from here") | `0` | Current allocation frozen. Driver only *adds* nodes, up to `pointBudget`, within proximity `K` of the existing frontier. No regret-set step. Output: "allocate these next, in this order." Lowest risk — the user committed to their tree and wants direction. |
| **Repair** | `N` | Seed from the current allocation, then free up to `N` lowest-value points (the regret set) and re-search. Output: "respec these `M`, allocate these instead." Costs in-game respec currency. |
| **From-scratch** | ∞ + bare tree | Deferred stretch goal. |

`freeze: nodeId[]` (`--freeze` on the CLI) marks allocated nodes the regret set may never choose
to free. Extend mode is implicitly `freeze = all currently-allocated` (it only adds). Ascendancy
nodes are *always* frozen — their points are a separate pool the re-spend can't use, so there is
no `freezeAscendancy` toggle. A frozen node can still be collaterally freed if it sits downstream
of a chosen *interior* removal (`evaluate_dealloc_candidates` reports a cascade's size, not its
member ids); freeze protects a node from being the removal *target*.

## Perf target

```
beam evals ≈ W · D · P · C          (P = candidates per beam node per step, C = seconds per eval)
W=4, D=15, C≈0.5s, budget ~300s  ⇒  P ≲ 20
```

Observed: Notable+Keystone-only pool (hundreds of nodes) does not finish a single greedy pass in
120s, so C is ~0.3–1s. The job is cutting P from *hundreds* to **~15–25 real evals**.

## Pruning layers (cheap → expensive)

| Layer | What | Cost | Status |
|---|---|---|---|
| **1. Objective keyword filter** | Generalize `keywordsForDamageType` to an objective spec `{ keywords, mode: 'prioritize' \| 'filter' }`. `filter` mode *drops* non-matching candidates. Preset for "physical + defence": Physical / Attack / Damage / Life / Armour / Evasion / Resist / Block + gating attributes; drop mana-regen / cast-speed / minion / curse / ailment-only. | free (text) | DONE |
| **2. Proximity gating** | Only consider candidates within `K` path-points of the current frontier (`K`=1–3, progressive). Beam expands locally anyway; also caps path-node drag-in to 0–2 instead of 8. Needs `pathLength` on `list_allocatable_nodes`. | free | DONE |
| **3. Corridor collapse** | The Iron Reflexes / Giant's Blood / Blood Magic gotcha (`docs/gotchas.md`) — many keystones behind one damage-notable corridor score identically. Detect shared path prefixes, evaluate the corridor entry once, branch into endpoints only if competitive. | cheap heuristic | deferred |
| **4. Approx pre-scoring** | Linear / log-linear delta estimate from stat lines vs a cached multiplier snapshot; real-evaluate only the top ~20. Same approximation the skill-optimiser design needs — build once, share. | medium effort | deferred |
| **5. Cross-beam memoization** | Cache `(sorted allocSet, nodeId) → result`. Beam states that reconverge via different allocation order hit it. `BuildOutput` is not incremental, so this is the main way to reclaim repeated work. | cheap | DONE |
| **6. Progressive widening** | Start tight (`P`, `W` small); widen only when the beam's top scores are within ε (genuine ambiguity) and budget remains. Reuses `maxCandidates`. | control knob | deferred |

**MVP:** bridge changes + layers 1 + 2 + 5 — all landed. Layers 3, 4, 6 stay deferred until a
live run shows greedy re-spend is not good enough.

## Bridge changes

All landed — see Implementation status §2 for the full RPC list. Kept here for the rationale:
`evaluate_candidate_nodes` evaluates against the *loaded baseline* and rolls back to it
(`bridge.lua:698-716`), but a beam node is `baseline + partial allocation` (and, for repair,
`baseline − removed leaves + additions`), which it cannot express — hence the `_from` family of
RPCs that take an `allocSet` (and optional `removeIds`).

## Measuring approach improvements

Comparing greedy (baseline) vs greedy-seed + repair vs (later) beam-from-scratch. The calc engine
is byte-deterministic (`docs/gotchas.md`), so quality is one number per (build, approach) — no
sampling, no variance analysis.

That determinism now also holds for the *search*, not just the calc: `recommendTree` sorts the
`list_allocatable_nodes` pool by node id before doing anything with it (that RPC yields nodes in
Lua `pairs()` order, which the spec leaves unfixed), and its final ranking breaks `deltaPerPoint`
ties by node id (ties are common — a keystone and its whole path corridor report the same bundled
delta). The beam driver keeps the same discipline: id-sorted candidate pools, id-tie-broken
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
  `preserveMetrics` floor and maximize the other. Implemented in `src/core/objective.ts`
  (`logBlend` / `metricObjective` / `parseObjective`), with the guard: a build whose `TotalEHP`
  (or other input) is absent or ≤ 0 is scored "objective undefined" and dropped from the
  comparison, not treated as `log(0)`.
- **Feasibility is a gate, not a tiebreak.** An approach that beats another on DPS by dropping a
  resistance below cap is disqualified for that instance, not scored lower.
- **Head-to-head win / tie / loss across the corpus.** Report the distribution, not just mean
  lift — +5% mean with one −20% outlier is a bad trade.
- **Gap-to-optimal on small instances.** Instances small enough to brute-force (few spare points,
  tight `K`, Keystone-only pool): measure each heuristic's gap to the true optimum. Calibrates
  trust in greedy-repair on the large instances where brute force is impossible.

### Cost

- **`BuildOutput()` call count is the currency.** `get_metrics` / `reset_metrics` on the bridge;
  a `recomputeBuild()` wrapper counts every call site. Exact, deterministic, machine-independent
  — unlike wall-clock.
- **Per-recompute latency.** `get_metrics.buildOutputSeconds` (`os.clock()` around each
  `recomputeBuild`) → `sim s` / `ms/BO` columns in the bench. The definitive run measured
  **~250–310 ms per recompute** (median), so `BuildOutput` count × ~0.28 s is a good wall estimate
  once search/transport overhead is stripped. Strong L100 builds' `repair-r6` cell hits
  1900–2700 recomputes → ~15–37 min *each*.
- **Wall-clock secondary** — now overlapped across builds by `--concurrency=N` (see §9). The
  8.3 core-hours of the definitive run finished in 1h20m at N=8.
- **Layer-5 cache hit rate** — `MemoEvaluator` tracks `hits` / `misses` / `hitRate`. Was
  **0.00 on every run** in the definitive benchmark (the greedy `beamWidth 1` walk never revisits
  an allocSet key). The cache earns its place at `beamWidth > 1`, where sibling `BeamState`s
  reconverge on the same allocation set via different order — `beamAddLoop` dedups those before
  they cost a recompute.

### Apples-to-apples checklist

Same builds · same points allocated · same objective + constraints · same vendored PoB data
(pinned) · deterministic beam tiebreaks (by node id, never random).

### Corpus

8–15 builds spanning defence layers (armour / evasion / ES / hybrid), damage types, and
spare-point counts (the constraint repro only fired at 23 spare points; 10 was too few). Include
≥1 hand-tuned build (repair must return ≈no change), ≥1 deliberately naive build (repair must
improve it), and a held-out subset never used while tuning `K` / `W` / `D`.

Run each build in **both starting modes and at two `pointBudget` values** (current-level and
endgame). The extend-mode / low-budget cell is the common real user situation — a partially
levelled character asking "where next" — and must not regress even if repair-mode numbers look
better in aggregate.

**CORE vs `--full` (2026-08-28).** The full 25-build corpus × 3 approaches takes ~1h20m at
`--concurrency=8` — too slow for a routine regression check, and a single build's 3 approaches run
serially on its one bridge so the wall floor is the most expensive build (`HuntressTank` alone is
~60 min). `benchTreeApproaches.ts` therefore defaults to `CORE_CORPUS` — 9 builds: the validation
pair, 3 of the 4 held-out, an armour build (`R_Thor`), and 3 gutted (both recovery-fraction
bases). Inferred CORE wall ≈ 38 min at N=8. `--full` appends `EXTENDED_CORPUS` (16, incl.
`HuntressTank` and the 2 0-DPS-headless builds) and is what a re-run of the definitive step-9 /
step-11 numbers should use. Per-build costs and the trim rationale live in `docs/beam-search/corpus.md`.

State of the corpus is tracked in Implementation status §8 and `docs/beam-search/corpus.md`.

### Ablations

Run greedy-repair with pruning layers {1}, {1,2}, {1,2,5}, {1,2,4,5}. Quality delta should be ≈0
(pruning shouldn't cost quality); cost delta shows what each layer buys. A layer that meaningfully
drops quality is too aggressive and gets retuned.

## Implementation status

As of 2026-08-28 — **steps 1–11 all complete and committed** (step 11 = `d612057`), 71 unit
tests green. The living project status/roadmap is `docs/status.md`; this section is the
per-step detail. Live-verification runs were against `RampantlyBisexual.xml` and
`MA-FlickerStrike` unless noted.

- **Done:** steps 1–7 (extend mode + leaf-only repair), step 10 (CLI), the step 9 benchmark
  harness (now parallel — `--concurrency=N`, one shared bridge per build; per-recompute timing via
  `get_metrics.buildOutputSeconds`), and **the definitive step 9 run** — full 25-build corpus ×
  {extend+8, repair-r3, repair-r6} under `dps-ehp:0.5` + a 3-elem-resist floor, 1h20m wall at
  `--concurrency=8`, committed as `docs/beam-search/bench-dps-ehp-0-5.md` (`ba0df4a`).
- **Step 8 (corpus) — closed 2026-08-28:** 6 local + 14 poe.ninja builds, held-out subset marked,
  synthetic-gutting tool (`npm run gut-build`) for spare-point builds with a ground-truth ceiling.
  Blocker (a) — poe.ninja over-allocation — resolved: `get_tree_status` now applies the
  weapon-set point correction PoB's own display uses (see §8 and the Open-questions note below).
  Blocker (b) — no 30–60-spare mid build — is not fully closable from the ladder (L80+ only); the
  gutting tool covers it and the corpus proceeds with that. **Corpus split into CORE (9, the
  benchmark default) + EXTENDED (16, `--full`)** after the definitive run showed the full set is
  too slow for a routine check (`ba0df4a`; see §8).
- **Step 11 (validation write-up) — DONE 2026-08-28.** `docs/beam-search/repro.md`. Repair returns
  **exact no-change** on the hand-tuned Monk (`185998.36 → 185998.36`, `repair-not-worthwhile`) and
  on a strong *held-out* build (`TechnoIceShot`), **+11.4 %** on the naive Monk sibling, and large
  gains on weak/gutted builds — under raw `TotalDPS` with a no-regression floor on the
  **tree-sourced defensive layers** (`Life,Evasion,EnergyShield`). Key finding: the `dps-ehp:0.5`
  blend does **not** separate tuned from naive (both ≈ +1.3 %), and a preserve floor is inert on
  top of it — the blend already blocks the bad trade but flattens the contrast, and repair still
  reallocates notables the blend cannot price. Backing: CORE bench re-run under `TotalDPS`
  (`docs/beam-search/bench-totaldps.md`, 9 builds, 54 min). Harness change: default floor switched from
  the 3 elemental resists to `TotalEHP` no-regression — resists come from gear, not the tree, so
  flooring them steers the planner wrong (`res ok` = y on all 27 runs confirms nothing traded them
  away regardless). Per-build `preserve` override added for hand-picked defence.
- **Deferred past v1:** pruning layers 3 / 4 / 6; any-node (cascading) repair; the real `(W, D)`
  beam (plain greedy re-spend has been enough so far).

1. **Bridge: `pathLength` on `list_allocatable_nodes`** — DONE. `#node.path` per entry; mirrored
   on `AllocatableNode`. Live: 3821 reachable nodes, range 1–32, frontier-adjacent read 1.
2. **Bridge: `evaluate_candidate_nodes_from(allocSet, nodeIds)`** — DONE. `evaluate_candidate_nodes`
   is the `allocSet = []` case, byte-identical. The outer restore needs a final `BuildOutput()`
   — `RestoreUndoState` reverts the spec but not `mainOutput`, and a repeated caller must see a
   clean baseline (`docs/gotchas.md`). Sibling RPCs added the same round: `get_stats_from`,
   `list_allocatable_nodes_from` (server-side `types` / `maxPathLength` filters),
   `evaluate_dealloc_candidates`, `list_allocated_nodes`, `get_metrics` / `reset_metrics` +
   `recomputeBuild()`. An optional `removeIds` prologue on `evaluate_candidate_nodes_from` /
   `get_stats_from` deallocs given ids off the loaded tree *before* laying down `allocSet`, inside
   one outer undo — this is what makes leaf-only repair measurable.
3. **Objective keyword filter (layer 1)** — DONE. `objective?: string | ObjectiveSpec` on
   `RecommendTreeOptions`; `physical-defence` preset; `--objective` flag. Applied after
   `nodeTypes`, before `damageType` (still the primary sort).
4. **Proximity gating (layer 2)** — DONE. `filterByProximity(nodes, k)` in `recommendTree.ts`;
   `RecommendTreeOptions.maxPathLength` / `OptimiseTreeOptions.proximity`;
   `list_allocatable_nodes_from` also gates server-side to shrink the payload.
5. **Cross-beam memoization (layer 5)** — DONE. `MemoEvaluator` (`src/core/evaluator.ts`) wraps
   `evaluate_candidate_nodes_from` and `get_stats_from`, keyed on the sorted allocSet joined
   (lossless, no hash) + `:` + nodeId; optional `removeIds` prefixes the key as `r<sorted>|…`
   (empty → byte-identical to the extend-mode key).
6. **Composite objective (`src/core/objective.ts`)** — DONE. `logBlend`, `metricObjective`,
   `parseObjective` (`"dps-ehp:W"` / `"blend:A,B,W"` / bare metric). `objectiveFn` on both option
   types. Unscorable baseline → throw; unscorable candidate → dropped.
7. **Greedy-seed + local repair driver (`src/core/optimiseTree.ts`)**
   - **Extend mode** (`respecBudget` 0 / unset) — DONE. Greedy walk outward from the loaded
     frontier, bounded by `pointBudget` (default `pointsUsed` → returns nothing without
     `--point-budget` / `--extra-points`) and proximity `K`, objective-scored, constraint-gated
     vs the loaded baseline, id-sorted pool + id-tie-broken pick. Ascendancy steps skipped.
     Returns ordered `steps[]`, `addedNodeIds`, `final`, `stoppedBecause`, `buildOutputCount`,
     `cacheHitRate`. Live: `RampantlyBisexual +6 pts, K=2` → Concussive Attack / Vile Wounds /
     Essence of the Mountain, TotalDPS 39525 → 43509, 98 recomputes, 24s.
   - **Repair mode, leaf-only** (`respecBudget > 0`) — DONE (`9e5b5e3` / `9efcbef` / `3f43d85`;
     `respecBudget`-as-ceiling sweep added after the first bench run).
     Regret set via `evaluate_dealloc_candidates` + `list_allocated_nodes`, kept to true leaves
     (`pointsFreed == 1 && ascendancyPointsFreed == 0`), ranked by objective value lost (a leaf
     whose removal makes the build unscorable is `+Infinity`, never dropped; negative = removal
     *helps*), id tie-break. **`respecBudget` is a ceiling, not a target:** the driver sweeps
     `k = 1..respecBudget` freed leaves, re-spends each prefix with the shared `greedyAddLoop`
     (`removeIds` threaded through every bridge call, against post-removal stats), and keeps the
     highest-scoring plan (ties → smaller `k`). This is because one-shot removal of the full budget
     is non-monotonic — the first bench run showed `repair-r6` scoring *below baseline* (→
     no-change) on builds where `repair-r3` gained 20%+. Constraints gated against running
     walk-state (`constraintReference: "walk-state"`), then the whole plan re-checked vs the loaded
     baseline. Recommends the repair only if a swept plan has `finalObjective > baselineObjective`
     and ≥1 step, else `stoppedBecause: "repair-not-worthwhile"` / `"nothing-removable"` (renamed
     from `"no-leaves"` in step 2) with `removed` still surfaced. Pre-sweep live numbers (one-shot):
     `RampantlyBisexual` / TotalDPS / respec 3 → +11.9% at net 0 pts; `MA-FlickerStrike` / TotalEHP
     / respec 5 → +13%. Post-sweep bench numbers in `docs/beam-search/bench-<objective>.md`.
   - **Any-node repair — ACTIVE NEXT TRACK (chosen 2026-08-28).** Allow non-leaf removal
     (`DeallocNode` cascades everything only reachable through the removed node). `bridge.lua`
     `evaluate_dealloc_candidates` already does this and already reports the true `pointsFreed`;
     the driver filter was the only leaf-only limit. Steps:
     1. **Cascade-verification spike** — DONE 2026-08-28. `spike/verifyDeallocCascade.ts`
        (`npm run verify-dealloc-cascade`); write-up in `docs/gotchas.md` (§`DeallocNode` cascade).
        Verdict: fit for any-node repair — `pointsFreed` trustworthy for interior nodes, ~80 % of
        allocated nodes are interior, 25–55 % of interior removals are cheap/helpful, freed nodes
        re-enter the pool at `pathLength` 1–2, `get_stats` round-trips byte-for-byte. Remaining
        work is driver accounting, not a bridge gap.
     2. **Lift the leaf-only filter** — DONE 2026-08-28. `optimiseTree.ts` repair path now keeps
        every removable regular node (`ascendancyPointsFreed == 0 && pointsFreed >= 1`), ranks by
        objective value lost, then greedy-knapsacks in that order so cumulative `pointsFreed` fits
        the `respecBudget` *points* ceiling (a single removal bigger than the whole budget is
        skipped; scanning continues for a smaller one). The `k`-sweep frees `sum(pointsFreed)` per
        step, not `k`, and `pointsFreed` / `final.pointsSpent` in the result use the real cascade
        total. `stoppedBecause: "no-leaves"` → `"nothing-removable"`. `removeIds` re-spend prologue
        unchanged (it already `DeallocNode`s, so cascades were always handled bridge-side). +2 unit
        tests (interior removal re-spends the whole cascade; an over-budget cascade is skipped for
        a smaller one). 73 tests green.
     3. **Real `(W, D)` beam** — DONE 2026-08-28. `optimiseTree.ts`: `greedyAddLoop` → `beamAddLoop`,
        shared by extend and repair. Keeps `beamWidth` `BeamState`s in parallel; each depth every
        live state proposes its improving extensions (`expandState`, ranked `deltaPerPoint` desc /
        id asc — the exact old greedy pick), all proposals pooled, de-duplicated by resulting
        sorted allocation set, top `W` carried forward; each state holds its own `stats` for its
        own `walk-state` constraint reference. Returns the highest-objective plan among terminal +
        surviving states (ties: fewer points, fewer steps, lexicographic ids). **`beamWidth === 1`
        is byte-identical to the old greedy walk** (verified live + unit test). `--beam-width` /
        `--beam-depth` on the CLI (`beamWidth` echoed in the result when > 1). +5 tests (78 green):
        W=1 == greedy, a width-2 beam keeps a 2-point move greedy can't afford, determinism across
        runs, `beamDepth` caps steps, CLI parse. Cost ~W × (pool-list + eval batch) per depth; the
        layer-5 memo dedups reconverging states. Default `W` stays 1 — a bench sweep to pick a
        higher default is a follow-up, not blocking.
     4. **General `freeze` list** — DONE 2026-08-28. `OptimiseTreeOptions.freeze: number[]` /
        `--freeze <id,…>`: allocated node ids excluded from the repair regret set (dropped before
        the `evaluate_dealloc_candidates` probe, so they cost nothing). Ascendancy nodes stay
        unconditionally frozen — no `freezeAscendancy` toggle, since their points can't be
        re-spent. Freezing every removable node → `nothing-removable`. +3 tests (81 green).
        Verified live: `--freeze 2334` on `RampantlyBisexual` keeps `Dexterity` and the regret set
        picks other 0-value nodes for the same +11.9%.
     5. **Rollback-to-node (anchor) option** — DONE 2026-08-28. Not a mode; one extra input to the
        repair path that *composes* with steps 2–4. `OptimiseTreeOptions.anchorNodeId` /
        `--rollback-to <id>` (selects repair on its own — no `respecBudget` needed). The planner
        force-frees the anchor's entire downstream cascade (`DeallocNode(anchor)` semantics — the
        anchor plus every node only connected to the tree through it); the anchor row is
        `dropped[0]`, `anchorCascade: true`, and its whole cascade is removed unconditionally (not
        scored, not knapsacked, not swept). Everything steps 2–4 built then runs on top:
        - **Cascade members** are recovered by diffing `list_allocated_nodes` against
          `list_allocated_nodes({ removeIds: [anchor] })` — a new optional `removeIds` on that
          bridge method (mirrors `list_allocatable_nodes_from`), because `evaluate_dealloc_candidates`
          only *counts* a cascade, never enumerates it. Members are then held out of the regret
          pool so the `k`-sweep can't double-free one.
        - `respecBudget` applies to the **survivors**: `--rollback-to <id>` alone → subtree-only
          (`dropped = [anchor]`, `k`-sweep collapses to `k = 1`); `--rollback-to <id>
          --respec-budget 6` → also free ≤ 6 points of the lowest-value survivors (`k`-sweep 1..N
          over `[anchor, …survivors]`). Answers the old open sub-question: compose, don't choose.
        - The step-3 beam re-spends `cascadePoints + swept points` via the `removeIds` prologue
          (`[anchor, …survivors]` — bridge `DeallocNode`s the anchor, which cascades, then each
          survivor).
        - `freeze` interaction: a frozen node inside the anchor's cascade is still collaterally
          freed (step-4 caveat). An id in both `freeze` and `anchorNodeId` is rejected; so is an
          ascendancy anchor or a non-allocated one.
        - **Scope guard — `MIN_ANCHOR_SPINE_POINTS` (3).** If `pointsUsed − cascadePoints < 3` the
          anchor is rejected: too little tree survives for the add-loop to grow from. That case is
          from-scratch construction and hits the zero-delta pathing plateau (`expandState` filters
          to `objective − state.objective > 0`, so a near-empty tree stops at depth 0). Solving it
          = from-scratch mode, which stays **past v1**. This step ships the mid/late-pivot use
          ("re-plan the half of my tree past the mid-game pivot without touching the early core").
        +7 tests (88 green). Live-verified on `RampantlyBisexual` (`--rollback-to 34015` force-frees
        the 29-node `Dexterity` subtree, drops the objective to the anchor, then re-spends).
8. **Corpus assembly** — DONE (2026-08-28). 6 local + 14 poe.ninja builds + the gutting tool.
   `spike/characteriseBuild.ts` (`npm run characterise-build`) emits a manifest row;
   `docs/beam-search/corpus.md` holds the manifest + gap list + the poe.ninja pull table/caveats.
   - **Local:** 6 builds. Validation pair (both Monk) is now usable end-to-end —
     `Martial Artist - Shattering Palm + Flicker Strike` (hand-tuned, ~186k DPS) vs
     `MA-FlickerStrike` (naive, user-gutted, ~90k DPS); both fixed 2026-08-27 (stale
     `mainSocketGroup`, empty active weapon set) so the `TotalDPS` regression runs, not just EHP.
   - **poe.ninja:** 14 builds pulled 2026-08-28 (`npm run fetch-ninja-builds` → `…/Builds/ninja/`).
     The endpoint's `pathOfBuildingExport` is plain `base64(zlib(xml))`. Class/tier spread good,
     13/14 DPS match the ladder; held-out subset (4 builds) marked. `BlandisThree` + `Blood Mage`
     score 0-DPS headless.
   - **Synthetic gutting:** `spike/gutBuild.ts` (`npm run gut-build`) deallocs N leaf nodes from a
     strong XML (policy `random|low|high`), writing `<name>-gut<N>-<policy>.xml` + a `.json`
     sidecar (`removedNodes`, original vs gutted, `gapToRecover`) into `…/Builds/ninja/gutted/`.
     Gives spare-point builds *with* a ground-truth ceiling → the benchmark can score "fraction of
     lost objective recovered". Use `random`/`high` (low pulls objective-dead notables first).
   - **Problem (a) — ninja exports over-allocate — RESOLVED 2026-08-28.** Cause confirmed: ninja
     `<Spec nodes=>` is the *union* of the base tree and the `<WeaponSet1/2 nodes=>` deviations
     (~+24–27), and `PassiveSpec:CountAllocNodes()` folds every weapon-set-specific node into its
     raw `used`. Fix (Option 2 — account for weapon swap): `get_tree_status` now returns
     `pointsUsed = treeNodesAllocated − min(weaponSet1PointsUsed, weaponSet2PointsUsed)`, exactly
     PoB's own `EstimatePlayerProgress` display formula — weapon-set nodes draw on a separate
     per-set budget (`weaponSetPointsMax = questPoints + PassivePointsToWeaponSetPoints`), now also
     surfaced. Took the 9 offenders from −17…−27 spare to −1/−2. Residual −1/−2 on 8 L100 builds is
     a separate, minor headless-ExtraPoints undercount (Atlas / item "+N passive points" with no
     config toggle) — pass `--point-budget` for extend mode on those; repair mode is unaffected.
     `TreeStatus` (`src/core/recommendTree.ts`) gained `weaponSet1PointsUsed` /
     `weaponSet2PointsUsed` / `weaponSetPointsMax` / `treeNodesAllocated`.
   - **Problem (b) — no 30–60-spare mid build.** The ninja ladder is L80+ only; gutting
     (`npm run gut-build`) fills the gap, though every gutted instance still traces to a L80+ tree.
     Accepted — the corpus proceeds on that basis.
   - **CORE / EXTENDED split (`ba0df4a`).** `benchTreeApproaches.ts` defaults to `CORE_CORPUS`
     (9 builds); `--full` adds `EXTENDED_CORPUS` (16). See §Corpus above and `docs/beam-search/corpus.md`
     for the per-build cost table. HuntressTank moved to EXTENDED (its `repair-r6` alone is ~37 min);
     CORE keeps 3 of the 4 held-out builds.
9. **Benchmark harness** — DONE, incl. the definitive run.
   `npm run bench-tree-approaches -- [objective] [extraPoints] [--no-constraints] [--concurrency=N]
   [--full] [--fresh-bridge] [--only=substr] [--preserve=A,B]` runs corpus × {`extend+N` fresh
   points, `repair-r3`, `repair-r6`} → per-build table (lift %, net pts, respec, `res ok` resist
   diagnostic, BuildOutputs, `sim s`, `ms/BO`, cache-hit %, wall s, stop reason) + a per-build
   summary with a repair-monotonicity flag + a cost-by-approach median. Default no-regression floor
   `DEFAULT_PRESERVE = ["TotalEHP"]` (was the 3 elemental resists until step 11 — resists come from
   gear, not the tree); `--preserve=A,B` adds to it corpus-wide, and each `CorpusBuild` may carry a
   `preserve` override for hand-picked defence (`MA-Shattering` → `Life,Evasion,EnergyShield`).
   - **Parallel (`9d50dad`).** `--concurrency=N` (default 4 / `$BENCH_CONCURRENCY`): a fixed-size
     worker pool over builds, one shared LuaJIT bridge per build (all 3 approaches, `load_build_xml`
     once). Deterministic regardless of N — rows carry a hidden `(ci, ai)` key and are sorted before
     every render. `--fresh-bridge` = the old spawn-per-approach path.
   - **Definitive run (`ba0df4a`, `docs/beam-search/bench-dps-ehp-0-5.md`).** Full 25-build corpus,
     `dps-ehp:0.5`, +8, resist floor, `--concurrency=8`, 1h20m, 69 rows (`Blood Mage` +
     `BlandisThree` skip under the blend). Findings: **repair monotonic (r6 ≥ r3) on all 23 usable
     builds** (the k-sweep fix holds); **`res ok` = y everywhere**; gutted recovery behaves as
     designed (`extend` spends 25 pts back → 100–158%; net-0 `repair` → 19–73%); `R_Thor` is a
     genuine repair win (r3 +3.65% / r6 +4.59% both beat `extend` +2.47%); layer-5 cache hit rate
     0.00 throughout; ~250–310 ms/recompute. The earlier local-only fixtures
     (`docs/beam-search/bench-totaldps.md`, and the pre-`ba0df4a` `dps-ehp-0-5.md`) stay as harness
     regression checks. The committed `dps-ehp-0-5.md` is the 25-build run; running the default now
     regenerates it as the 9-build CORE set.
10. **CLI + spike wiring** — DONE. `src/optimiseCli.ts` (`npm run optimise-tree`), parsing +
    output only; core returns data. Flags: `--mode extend|repair`, `--respec-budget N`
    (`--repair-nodes N` alias; `>0` implies repair), `--point-budget N` / `--extra-points N`
    (mutually exclusive), `--proximity K`, `--target <metric>` / `--objective <spec>` (mutually
    exclusive; `spec` via `parseObjective`), `--node-types`, `--all-node-types`, `--keywords` /
    `--exclude-keywords`, `--max-candidates N` (dev cap), `--min-resist N` /
    `--constraint Metric=N` / `--preserve A,B`. Shared helpers in `src/cliShared.ts`; `parseArgs`
    unit-tested (12 tests). `--beam-width` / `--beam-depth` / `--target-level` /
    `--freeze-ascendancy` omitted — no backing feature yet.
11. **Validation** — DONE 2026-08-28. `docs/beam-search/repro.md`.

    **What shipped.** The repro doc mirrors `docs/constraint-rejection-repro.md`: the tuned/naive
    Monk pair, the objective + floor recipe, a 2×2 of CLI transcripts, and the CORE bench re-run as
    corpus-wide backing.
    - naive: `MA-FlickerStrike.xml` (~90k DPS, user-gutted, 25 spare)
    - tuned: `Martial Artist - Shattering Palm + Flicker Strike.xml` (~186k DPS, hand-picked
      evasion/ES defence, 10 spare)

    **Result.** Under raw `TotalDPS` + a no-regression floor on the tree-sourced defensive layers
    (`--preserve Life,Evasion,EnergyShield`): repair returns **exact no-change** on the tuned build
    (`185998.36 → 185998.36`, `repair-not-worthwhile`) and on the strong held-out `TechnoIceShot`,
    **+11.4%** on the naive sibling (frees 2 dead notables → `Glaciation`), and large net-zero gains
    on weak/gutted builds (`R_Thor` +130%, `Venereable-gut25-high` +83%). Monotonic (r6 ≥ r3) on all
    9 CORE builds.

    **Why not the blend (the plan's expected path).** `dps-ehp:0.5` at +8 headroom does *not*
    separate tuned from naive — both ≈ +1.3% on every approach:

    | build | extend+8 | repair-r3 | repair-r6 |
    |---|--:|--:|--:|
    | `MA-Shattering` (tuned) | +1.82% | +0.57% | +1.33% |
    | `MA-FlickerStrike` (naive) | +1.75% | +0.63% | +1.30% |

    A `preserveMetrics` floor is *inert* on top of the blend: the blend already blocks the bad trade
    (Chaos Inoculation tanks `TotalEHP`), so the floored layers were never being touched — but the
    blend also flattens the contrast, and repair still finds ~1.3% by freeing notables the blend
    cannot price (`Immaterial` / suppression, `One with the Storm`, ailment/utility). Raw metric +
    a floor on the specific layers forbids the bad trade outright *and* keeps the contrast.

    **Harness changes (`spike/benchTreeApproaches.ts`).** `--preserve=A,B` global passthrough +
    per-build `preserve` override on `CorpusBuild` (`MA-Shattering` → `Life,Evasion,EnergyShield`).
    Default floor switched from the 3 elemental resists to `DEFAULT_PRESERVE = ["TotalEHP"]` — a
    build-agnostic aggregate, and resists come from gear not the tree so flooring them steered the
    planner wrong. `res ok` (now a diagnostic, not an enforced floor) = y on all 27 CORE runs, so
    nothing traded resist away regardless. Backing fixture: `docs/beam-search/bench-totaldps.md`
    (regenerated as the 9-build CORE `TotalDPS` run, 54 min at `--concurrency=4`).

    **"No change" assertion.** Exact equality — `repair-not-worthwhile` lands on `final === base`
    with no float dust (matches the constraint repro). No relative ε added.

## Open questions to resolve early

- **Seed application cost.** Each greedy step re-allocs the growing set from scratch inside the
  `_from` RPCs. Alloc is cheap vs `BuildOutput`, so probably fine at greedy depths — revisit only
  if a real `(W, D)` beam lands and the O(D²) alloc cost starts to show.
- **`targetLevel` → `pointBudget` derivation.** Needs the quest passive-point total for the acts
  a character of that level has plausibly cleared. `bridge.lua` already sums `maxWeaponSets` from
  `QuestRewards.lua` but only the whole-game total; a partial total is guesswork. v1 takes an
  explicit `--point-budget` / `--extra-points`; `--target-level` is a later nicety, and only if
  the act→quest-point mapping reads cleanly from vendored data (verify per
  [[feedback-verify-poe2-vs-poe1-assumptions]]). Also confirm `get_tree_status.pointsMax` is the
  endgame cap, not current-level — the `99 +` term in `bridge.lua` says it is, but check
  against a mid-level sample build before relying on the `pointBudget = pointsUsed` default.
  Weapon-set points: RESOLVED (§8, problem a). `get_tree_status.pointsUsed` is now the
  weapon-set-corrected count (`treeNodesAllocated − min(ws1, ws2)`), matching PoB's own display,
  so `pointBudget = pointsUsed` no longer inherits the `<WeaponSet1/2>` inflation. Weapon-set
  nodes have their own budget (`weaponSetPointsMax`); a `--target-level` derivation still needs
  the per-act quest-point total but no longer a weapon-set term on the normal pool.
### Resolved

- **ε for the "no change" regression test (step 11)** — RESOLVED. Exact equality is enough:
  `repair-not-worthwhile` lands on `final === base` with no float dust (matches the
  constraint-rejection repro). No relative ε added. See §11.
- **Ascendancy nodes** — both modes skip ascendancy steps outright (`ascendancyPointsSpent > 0` /
  `ascendancyPointsFreed > 0`). A general `freeze` list for regular nodes stays a future item,
  tied to any-node repair (§7).
- **Constraint baseline in repair** — repair gates each step against the running walk-state, then
  re-checks the whole plan against the loaded baseline (`constraintReference: "walk-state"`).
