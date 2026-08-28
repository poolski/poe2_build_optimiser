# build_optimiser — status & roadmap

Living status doc. Last updated 2026-08-28.

`build_optimiser` recommends / optimises PoE2 passive-tree allocations using PoB-PoE2's own
headless calc engine as the fitness oracle (same technique as the sibling `poe2_craftsman`
project, which stays out of the tree). Detailed provenance lives in git history + the other
`docs/` files; this is the map.

## Shipped on `main`

- **Greedy recommender** — `src/core/recommendTree.ts`, `npm run recommend-tree`. Ranks the best
  *next* node(s) by real stat-delta-per-point. `damageType` prioritisation, `objective` keyword
  filter, `constraints` / `preserveMetrics` / `keepViolating` feasibility filter (live-verified —
  `docs/constraint-rejection-repro.md`). Deterministic: id-sorted pool, id-tie-broken ranking.
- **Greedy optimiser** — `src/core/optimiseTree.ts`, `npm run optimise-tree`. The beam-search
  task. **All 11 steps of the plan are complete** (`docs/beam-search-design.md` §Implementation
  status is the live checklist). Working:
  - **extend mode** ("start from here" — add up to `pointBudget` / `--extra-points` within
    proximity `K`)
  - **leaf-only repair mode** (`--respec-budget N` — free the N lowest-value allocated leaves,
    greedily re-spend; `N` is a ceiling, the driver sweeps `k = 1..N` and keeps the best)
  - composite objective (`src/core/objective.ts`: `dps-ehp:W` / `blend:A,B,W`), memoised
    evaluator, `BuildOutput()` counter. 71 unit tests.
- Real PoB-PoE2 gotchas in `docs/gotchas.md` — read before touching `bridge.lua` tree/alloc code.

## Beam-search track — COMPLETE

Full design + step-by-step checklist: `docs/beam-search-design.md`. Summary of the closed work:

### Step 8 — corpus (CLOSED 2026-08-28)

- 6 local builds + 14 pulled off poe.ninja (`npm run fetch-ninja-builds` → `…/Builds/ninja/`;
  table + caveats in `docs/beam-corpus.md`). The ninja endpoint's `pathOfBuildingExport` is plain
  `base64(zlib(xml))`. Held-out subset marked (4 ninja builds). Class/tier spread good; 13/14 DPS
  match the ladder. `BlandisThree` (ninja) + `Blood Mage` score 0-DPS headless.
- Validation pair — the two Monks: `Martial Artist - Shattering Palm + Flicker Strike.xml`
  (hand-tuned ~186k, "repair ≈ no change") vs `MA-FlickerStrike.xml` (naive ~90k, "repair
  improves"). Both fixed 2026-08-27 (stale `mainSocketGroup`; empty active weapon set).
- **Synthetic-gutting tool** — `spike/gutBuild.ts` (`npm run gut-build`): deallocs N leaf
  Normal/Notable/Keystone nodes from a strong XML (policy `random|low|high`), writes
  `<name>-gut<N>-<policy>.xml` + a `.json` sidecar (`removedNodes`, original vs gutted,
  `gapToRecover`) into `…/Builds/ninja/gutted/`. Gives spare-point builds with a ground-truth
  ceiling → the benchmark can score "fraction of lost objective recovered". Use `random`/`high`
  (`low` leaves the objective ≈unchanged).
- **Blocker (a) — ninja over-allocation — RESOLVED** by accounting for weapon-swap points.
  `PassiveSpec:CountAllocNodes()` folds every weapon-set-specific node into its raw `used`, and
  ninja `<Spec nodes=>` is the union of base tree + `<WeaponSet1/2 nodes=>` deviations (~+24–27).
  `bridge.lua get_tree_status` now returns
  `pointsUsed = treeNodesAllocated − min(weaponSet1PointsUsed, weaponSet2PointsUsed)` — exactly
  PoB's own `Build.lua:EstimatePlayerProgress` display formula — plus new fields
  `weaponSet1PointsUsed` / `weaponSet2PointsUsed` / `weaponSetPointsMax`
  (`= questPoints + PassivePointsToWeaponSetPoints`) / `treeNodesAllocated`. `TreeStatus` in
  `src/core/recommendTree.ts` mirrors them. Took the 9 offenders from −17…−27 spare to −1/−2.
  **Residual −1/−2 on 8 L100 builds** = a separate minor headless-ExtraPoints undercount (Atlas /
  item "+N passive points", no config toggle) → pass `--point-budget` for extend mode on those;
  repair is unaffected.
- **Blocker (b) — no 30–60-spare mid build** — not closable from the ladder (L80+ only); the
  gutting tool covers it and the corpus proceeds on that basis. Positive-spare ninja builds after
  the fix top out at 16 (`dosesondoses`, `R_Thor`).
- poe-snipe.com was considered and rejected as a low-level fixture source (no PoB export;
  RSC-only, UUID-keyed).

### Step 9 — benchmark (DONE, incl. the definitive run)

`spike/benchTreeApproaches.ts` (`npm run bench-tree-approaches -- [objective] [extraPoints]
[--no-constraints] [--concurrency=N] [--full] [--fresh-bridge] [--only=substr] [--preserve=A,B]`)
runs the corpus × {`extend+N`, `repair-r3`, `repair-r6`} → per-build table (lift %, net pts,
respec, `res ok`, BuildOutputs, `sim s`, `ms/BO`, cache-hit %, wall s, stop reason) + a per-build
summary with a repair-monotonicity flag + a cost-by-approach median.

- **Parallel harness + timing** — `--concurrency=N` (default 4 / `$BENCH_CONCURRENCY`):
  fixed-size worker pool over builds, one shared LuaJIT bridge per build (all 3 approaches),
  `load_build_xml` once. Deterministic regardless of N (rows carry a hidden `(ci, ai)` key,
  sorted before every render). `--fresh-bridge` = the old spawn-per-approach path. `bridge.lua`
  `recomputeBuild()` accumulates `buildOutputSeconds` (`os.clock()`); surfaced as `sim s` /
  `ms/BO` columns (~250–310 ms/recompute).
- **Default no-regression floor** is `DEFAULT_PRESERVE = ["TotalEHP"]` (was the 3 elemental
  resists until step 11 — resists come from gear, not the tree; `res ok` is now a diagnostic that
  they didn't regress anyway). `--preserve=A,B` adds corpus-wide; each `CorpusBuild` may carry a
  per-build `preserve` override (`MA-Shattering` → `Life,Evasion,EnergyShield`).
- **Definitive `dps-ehp:0.5` run** — full 25-build corpus × 3, `--concurrency=8`, 1h20m wall,
  committed as `docs/beam-bench-dps-ehp-0-5.md` (still uses the historical resist floor).
  Findings: repair monotonic (r6 ≥ r3) on all 23 usable builds; `res ok` held everywhere; gutted
  recovery as designed (extend 100–158%, repair 19–73%); `R_Thor` a real repair win; layer-5
  cache hit rate 0.00 everywhere (greedy never reconverges — expected).
- **Corpus split** — `benchTreeApproaches.ts` defaults to `CORE_CORPUS` (9: validation pair + 3
  held-out + `R_Thor` armour + 3 gutted; ~38 min @ `--concurrency=8`); `--full` appends
  `EXTENDED_CORPUS` (16, incl. `HuntressTank` and the 2 dead 0-DPS builds). Per-build cost table
  in `docs/beam-corpus.md`.
- `docs/beam-bench-totaldps.md` regenerated as the 9-build CORE `TotalDPS` run (step-11 backing);
  it is a harness regression check, not a result.

### Step 11 — validation (DONE 2026-08-28, `d612057`, `docs/beam-search-repro.md`)

Recipe that works: **raw `TotalDPS` + `--preserve` on the tree-sourced defensive layers**
(`Life,Evasion,EnergyShield` for the Monk pair). Repair returns:
- **exact no-change** on the hand-tuned `MA-Shattering` (`185998.36 → 185998.36`,
  `repair-not-worthwhile`) *and* on the strong held-out `TechnoIceShot`
- **+11.4%** on the naive `MA-FlickerStrike` sibling (frees 2 dead notables → `Glaciation`)
- big net-zero gains on weak/gutted builds (`R_Thor` +130%, `Venereable-gut25` +83%);
  monotonic r6 ≥ r3 on all 9 CORE builds.

Key findings:
- The **`dps-ehp:0.5` blend does NOT separate tuned from naive** (both ≈+1.3%) and a preserve
  floor is inert on top of it — the blend already blocks the bad trade (Chaos Inoculation tanks
  EHP) but flattens the contrast, and repair still reallocates notables the blend can't price.
- Without any defensive floor, raw `TotalDPS` repair "gains" +40% on the tuned build via Chaos
  Inoculation (`Maximum Life is 1`) — the failure the floor exists for. `--min-resist` alone
  does not stop it (CI touches no resist) → another reason resists are the wrong thing to floor.

### Deferred past v1 (only if a real need appears)

- Pruning layers 3 / 4 / 6 (`docs/beam-search-design.md`) — greedy re-spend has been sufficient.
- Any-node (cascading) repair + a real `(W, D)` beam — needs an arbitrary-exact-alloc eval RPC +
  `DeallocNode`-cascade verification.
- `--target-level` → point-budget derivation — needs the act→quest-point mapping verified against
  vendored data (the verify-PoE2-vs-PoE1-assumptions discipline, `docs/gotchas.md`).

## Other tracks

### Skill / support-gem optimiser — NOT STARTED (next major track)

Design sketch: `docs/skill-optimiser-design.md`. A constrained assignment + knapsack problem
around the same headless-calc oracle, reusing the `constraints` / `preserveMetrics` gate. Ordered
start:

1. **"Must verify first" audit** (gating, cheap) — 5 PoE1-vs-PoE2 assumptions to check against
   vendored PoB source (`docs/skill-optimiser-design.md` §Must verify first): the "one support
   per character" rule, support sockets per skill (flat 5 vs level-scaled), skill-gem socket
   colours, Spirit reservation field semantics, and whether gem level/quality are decision
   variables.
2. **Two new bridge RPCs** — `list_socket_groups` and `evaluate_gem_changes`. Rollback primitive
   is the open question (the skills tab likely needs deep-copy-and-restore of `socketGroupList`
   rather than the tree's undo-state); watch for a stale-cache trap analogous to `node.path`.
3. **Search pipeline** — pool pruning → fast bipartite assignment pass (Hungarian / min-cost
   flow on log-additive marginal gains) → 2-opt local search with the real evaluator → Spirit
   knapsack as a coordinate-descent step.

### Bridge → standalone shared package — NOT STARTED

The agreed trigger for extracting `pob-runtime/bridge.lua` + `src/core/bridge.ts` into a shared
package is it gaining a *second* consumer — i.e. the skill optimiser. Do the extraction early in
that work.

### Web frontend — deferred

The core/CLI split keeps the seam clean; deferred until the CLI tools settle.

## How to pick this up

1. This file for the map.
2. `docs/beam-search-design.md` — design + Implementation status checklist + open questions.
3. `docs/gotchas.md` — PoB-PoE2 leftovers to not trip on.
4. `src/core/optimiseTree.ts` + `src/core/recommendTree.ts` and their test files.
