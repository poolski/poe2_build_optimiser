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
  task. **All 11 steps of the plan are complete** (`docs/beam-search/design.md` §Implementation
  status is the live checklist). Working:
  - **extend mode** ("start from here" — add up to `pointBudget` / `--extra-points` within
    proximity `K`)
  - **leaf-only repair mode** (`--respec-budget N` — free the N lowest-value allocated leaves,
    greedily re-spend; `N` is a ceiling, the driver sweeps `k = 1..N` and keeps the best)
  - composite objective (`src/core/objective.ts`: `dps-ehp:W` / `blend:A,B,W`), memoised
    evaluator, `BuildOutput()` counter. 71 unit tests.
- Real PoB-PoE2 gotchas in `docs/gotchas.md` — read before touching `bridge.lua` tree/alloc code.

## Beam-search track — COMPLETE

Full design + step-by-step checklist: `docs/beam-search/design.md`. Summary of the closed work:

### Step 8 — corpus (CLOSED 2026-08-28)

- 6 local builds + 14 pulled off poe.ninja (`npm run fetch-ninja-builds` → `…/Builds/ninja/`;
  table + caveats in `docs/beam-search/corpus.md`). The ninja endpoint's `pathOfBuildingExport` is plain
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
  committed as `docs/beam-search/bench-dps-ehp-0-5.md` (still uses the historical resist floor).
  Findings: repair monotonic (r6 ≥ r3) on all 23 usable builds; `res ok` held everywhere; gutted
  recovery as designed (extend 100–158%, repair 19–73%); `R_Thor` a real repair win; layer-5
  cache hit rate 0.00 everywhere (greedy never reconverges — expected).
- **Corpus split** — `benchTreeApproaches.ts` defaults to `CORE_CORPUS` (9: validation pair + 3
  held-out + `R_Thor` armour + 3 gutted; ~38 min @ `--concurrency=8`); `--full` appends
  `EXTENDED_CORPUS` (16, incl. `HuntressTank` and the 2 dead 0-DPS builds). Per-build cost table
  in `docs/beam-search/corpus.md`.
- `docs/beam-search/bench-totaldps.md` regenerated as the 9-build CORE `TotalDPS` run (step-11 backing);
  it is a harness regression check, not a result.

### Step 11 — validation (DONE 2026-08-28, `d612057`, `docs/beam-search/repro.md`)

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

### Any-node (cascading) repair + a real `(W, D)` beam — COMPLETE 2026-08-28

Chosen 2026-08-28 as the next work (gem optimisation is out of scope, so the tree optimiser got
deepened instead). What shipped as "beam search" was greedy-seed + **leaf-only** repair; this
lifted both limits. All 5 steps done and committed. Follow-up still open: a bench sweep to decide
whether a default `beamWidth > 1` is worth it. Plan, cheapest-gating-first:

1. **Cascade-verification spike** — DONE 2026-08-28 (`spike/verifyDeallocCascade.ts`,
   `npm run verify-dealloc-cascade`; write-up in `docs/gotchas.md`). Verdict: `DeallocNode`
   cascade is fit for any-node repair. On 3 corpus builds — ~80 % of allocated regular nodes are
   interior (leaf-only sees the other ~20 %); 25–55 % of interior removals move the objective
   < 5 % or help it (dead cross-build pathing, long attribute chains, an unused jewel socket
   freeing 10 pts at Δobj 0); after a mid-tree `removeIds` the freed nodes reappear in the pool
   at `pathLength` 1–2; `get_stats` round-trips byte-for-byte. **Remaining work is driver
   accounting** — the `k`-sweep must count *points* freed (variable per removal), not leaves.
2. **Any-node repair** — DONE 2026-08-28. `optimiseTree.ts` repair path keeps every removable
   regular node (leaf or interior), ranks by objective value lost, greedy-knapsacks in that order
   to a `respecBudget` *points* ceiling (an over-budget cascade is skipped for a smaller one), and
   the `k`-sweep frees `sum(pointsFreed)` per step. `stoppedBecause "no-leaves"` → `"nothing-removable"`;
   CLI copy + `RemovedNode.pointsFreed` doc updated; +2 unit tests (73 green). `removeIds` prologue
   was already cascade-safe bridge-side, so no bridge change.
3. **Real `(W, D)` beam** — DONE 2026-08-28. `greedyAddLoop` → `beamAddLoop` (shared by extend
   and repair): keeps `beamWidth` partial plans, each depth pools every plan's improving
   extensions, dedups by resulting allocation set, keeps the top `W` (ranked `deltaPerPoint` desc
   / id asc — the exact old greedy pick), each plan carrying its own `walk-state` constraint
   reference. `beamWidth 1` is **byte-identical** to the old greedy walk (verified live + test).
   `--beam-width` / `--beam-depth` on the CLI. +5 tests (78 green). Default `W` stays 1; a bench
   sweep for a higher default is a follow-up, not blocking.
4. **General `freeze` list** — DONE 2026-08-28. `OptimiseTreeOptions.freeze: number[]` /
   `--freeze <id,…>`: allocated node ids the repair regret set may never free (dropped before the
   `evaluate_dealloc_candidates` probe, so they cost nothing). Ascendancy nodes stay
   unconditionally frozen — no `freezeAscendancy` toggle, since their point pool can't be
   re-spent anyway. Freezing every removable node yields `nothing-removable`. +3 tests (81 green).
5. **Rollback-to-node (anchor) option** — DONE 2026-08-28. An extra input to the repair path (not
   a separate mode) that *composes* with steps 2–4. `OptimiseTreeOptions.anchorNodeId` /
   `--rollback-to <id>` (selects repair on its own). The planner force-frees the anchor's whole
   downstream `DeallocNode` cascade as `dropped[0]` (`anchorCascade: true`), unconditionally —
   not scored, not knapsacked, not swept. Cascade members recovered by diffing
   `list_allocated_nodes` vs `list_allocated_nodes({ removeIds: [anchor] })` — a new optional
   `removeIds` on that bridge method — and held out of the regret pool. `respecBudget` then
   applies to the survivors: `--rollback-to <id>` alone = subtree-only (k-sweep → k=1);
   `+ --respec-budget N` = also free ≤ N points of the lowest-value survivors. Step-3 beam
   re-spends `cascadePoints + swept` via the `[anchor, …survivors]` `removeIds` prologue. Rejects
   an ascendancy / non-allocated anchor, an id in both `freeze` and `anchorNodeId`, and (scope
   guard `MIN_ANCHOR_SPINE_POINTS` = 3) an anchor leaving `< 3` surviving points — that case is
   from-scratch mode (zero-delta pathing plateau), still past-v1. +7 tests (88 green).
   Live-verified on `RampantlyBisexual` (`--rollback-to 34015`).

Full sketch: `docs/beam-search/design.md` §7 ("Any-node repair") + §"Open questions".

### Deferred past v1 (only if a real need appears)

- Pruning layers 3 / 4 / 6 (`docs/beam-search/design.md`) — greedy re-spend has been sufficient.
- `--target-level` → point-budget derivation — needs the act→quest-point mapping verified against
  vendored data (the verify-PoE2-vs-PoE1-assumptions discipline, `docs/gotchas.md`).
- From-scratch mode (∞ budget + bare tree) — stretch goal. Also the blocker for
  rollback-to-node with an anchor near the class-start: both need the add-loop to spend
  zero-delta pathing steps toward a distant payoff.

## Active next track: web UI + bridge service (added 2026-08-28)

The tree optimiser is feature-complete and the CLI surface has settled, so the next track is a
**local web UI** over the same `src/core/` functions. It also pulls the long-deferred
**bridge → standalone package** work along with it: a browser cannot shell out to LuaJIT, so the
bridge has to move behind a long-lived service boundary. The two land together.

**Shape:** local-first — a `localhost` app wrapping the local LuaJIT bridge, single user, not
hosted. A third consumer of `src/core/` after the two CLIs, same "parse in / data out" contract.
v1 touches core in two places (`onProgress` + `shouldContinue` for prompt cancel); a post-v1
**phase 1.5** (parallel candidate evaluation within one run) adds a third and is what actually
makes a single run fast — **v1 runs are as slow as the CLI**, just with a progress bar and a
cancel that frees the slot within one add-step.

**Full plan is now `docs/web-ui/` — one file per domain:**

| File | Domain |
| ------ | -------- |
| `docs/web-ui/README.md` | Index, decisions of record, architecture, sequencing |
| `docs/web-ui/01-bridge-service.md` | Phase 1 — `pob-runtime/` + `bridge.ts` → `packages/pob-bridge` with a `PobBridgePool`; §"Phase 1.5" = parallel candidate eval within a run |
| `docs/web-ui/02-core-progress.md` | Phase 1 — `onProgress` + `shouldContinue` in `optimiseTree` / `recommendTree` |
| `docs/web-ui/03-shared-contract.md` | Phase 2 — `packages/contract`: Zod schemas + inferred DTOs |
| `docs/web-ui/04-api-server.md` | Phase 2 — `packages/api`: Hono + Zod, builds / jobs / SSE |
| `docs/web-ui/05-frontend.md` | Phase 3 — `packages/web`: Vite + React wizard, node-list diff |
| `docs/web-ui/06-tree-canvas.md` | Phase 3 (in v1) — stylised passive-tree diff canvas |
| `docs/web-ui/07-performance.md` | Cross-cutting — why PoB stays the fitness oracle + the speed-lever table |
| `docs/web-ui/08-fork-prep.md` | Between phases 1 and 2 — the serial commit that makes phases 2–3 safe to run as parallel worktrees |

**Decisions of record (2026-08-28, with the user):**

1. **Scope — full optimiser** (extend / repair / rollback, objective, constraints, `freeze`,
   beam `W`/`D`). Recommender comes along as a lighter job type.
2. **Build input — paste PoB code *and* `.xml` upload.**
3. **Bridge packaging — extract `packages/pob-bridge` now** (not "pool in the server, extract
   later"). Repo moves to npm workspaces.
4. **Stack — Vite + React SPA + Hono API** (`@hono/node-server`, `streamSSE`, `serveStatic`),
   **Zod** for request validation + shared types, **no job-queue lib** (in-memory registry +
   `EventEmitter`; port the bench harness's `runWithConcurrency` for the pool).
5. **Result rendering — tree canvas *and* node-list diff, both in v1** (canvas promoted out of
   "deferred" 2026-08-28). Canvas is the headline; list diff is the fallback + tree-version-
   mismatch view. Canvas is stylised only (shapes not sprites, dot-size by tier, PoE2 colours, no
   orbit rotation), porting the **MIT** Canvas2D renderer from `poe2-tools/poe2-build-planner`
   (same stack) onto our PoB `tree.json` — ~1 day, no GGG art. PoB-faithful render (DDS texture
   pipeline) stays out of scope.
6. **PoB stays the fitness oracle.** Not replaced by a home-grown engine over GGG's data
   exports — the exports are data, not the damage formula. The ~280 ms/recompute cost is a
   speed-lever problem (parallel bridge pool, candidate pruning, objective-scoped `BuildOutput`,
   …), not an architecture problem. Rationale + full lever table: `docs/web-ui/07-performance.md`.
7. **Pool is size 2 for v1; a single run is not parallelised until phase 1.5.** The pool only
   overlaps concurrent jobs, which a single user rarely has, so it barely moves the wait the user
   sees. Phase 1.5 (lever 1b) parallelises one run's candidate batch across the pool — the real
   wall-time win, and the first fast-follow after v1 ships.

Sequencing: phase 1 (bridge) → **fork-prep** (`08`) → phase 2 (API) → phase 3 (UI = wizard + list
diff + tree canvas) = **v1**. Then **phase 1.5** (parallel candidate eval, the wall-time win) as
the first fast-follow.

**Phase 1 is COMPLETE as of 2026-08-29**, on branch `phase1-bridge-service` (not yet merged to
`main`):

- `660534d` npm workspaces + `tsconfig` split. Cross-package resolution is **source-level aliases**
  (`tsconfig` `paths` + a vitest alias) — no build step, no TS project references.
- `97cbe27` + `5c24241` `pob-runtime/` and `bridge.ts` → `packages/pob-bridge`, submodule path
  updated, shim added then dropped.
- `2b52cee` `PobBridgePool` (size 2, FIFO, crash-respawn, `dispose`, `warm`) **plus a test-suite
  split**: `npm test` = fake-bridge units only (fast, no LuaJIT on PATH); `npm run test:integration`
  = real-bridge suite (`*.integration.test.ts`, `fileParallelism: false`). Keep new real-bridge
  tests out of the default suite.
- `a7b358c` `onProgress` + `shouldContinue` in `optimiseTree` / `recommendTree`. `shouldContinue`
  false → clean early return with `stoppedBecause: "cancelled"`. `beamAddLoop` gained an `onDepth`
  hook; all returns funnel through one `finish()` that emits the terminal event.

Verified: 98 default tests green, integration suite 10/10, `tsc` clean, and the phase-1 gate
(`optimise-tree --respec-budget 3` vs the `main` baseline) byte-identical — same 432 BuildOutputs,
same plan.

**Fork-prep is DONE — `e9e2c56`** (`08-fork-prep.md`, executed 2026-08-29). All v1 deps in one
lockfile pass, `packages/{contract,api,web}` skeletons + aliases (shared `vitest.alias.ts`), web
carved out of the commonjs typecheck, jsdom via `environmentMatchGlobs`, and the canvas fixtures
committed (`packages/web/public/tree-0_5.min.json` 407 KB + `packages/web/fixtures/`), so the
canvas track needs neither LuaJIT nor the submodule. 101 fast tests, integration still 10.

### ✔ RESOLVED — `allocatedNodeIds.{before,after}` on `OptimiseTreeResult` (`3b7dcf6`)

Fixed 2026-08-29 on `phase1-bridge-service`, as the agreed design said — no deviations.
`list_allocated_nodes` now takes an optional `allocSet` alongside `removeIds`: it deallocs the
`removeIds` cascade, `AllocNode`s each `allocSet` id (auto-pathing), one
`BuildAllDependsAndPaths`, lists `spec.allocNodes`, restores. **No `recomputeBuild()`** — the
method never reads `mainOutput`, so it adds zero BuildOutputs and cannot move the run's counter.
The `removeIds`-only and no-arg call paths stay byte-identical (the added per-list dedup is a
no-op without duplicates); an id in both sets is deallocated then re-allocated, ending allocated
(what repair does when it re-picks a freed node).

`optimiseTree` calls it once inside `finish()` — after the search settles, never during, so it
can't touch search order or the beam — with `{ removeIds: <dropped ids>, allocSet: <winning
picks> }`, and exposes `allocatedNodeIds: { before, after }` (both id-sorted; same node filter as
`list_allocated_nodes`, i.e. class/ascendancy-start + item-granted nodes excluded).
`after === before` whenever the recommendation is "change nothing" (`steps` empty).

`after` is connected by construction (`spec.allocNodes` after real `AllocNode`/`DeallocNode`).
Verified: `--rollback-to 34015` on `RampantlyBisexual` is byte-identical either side of the
change (same 12-step plan, same 692 BuildOutputs, same `47236.738915`; only the new field
appears). On the R_Thor fixture run `before` 127 → `after` 127, the size invariant
`after.length === before.length − pointsFreed + Σ step.pointsSpent` holds, the one previously-
unlogged traversal node (id 11433) is now present, and the integration test prices the
newly-allocated ids explicitly to confirm `AllocNode` drags in no extra connectors. `04`'s
`applyPlan.ts` writes `<Spec nodes>` straight from `allocatedNodeIds.after` now.

Rejected alternative (threading path ids through `evaluate_candidate_nodes_from` + the beam) was
not needed. Fixture `packages/web/fixtures/canvas-diff.R_Thor-L84-weak.json` regenerated:
`afterConnected` populated (127 ids), `afterPicksOnly` (126, picks only) kept alongside for
comparison. Tests: fast suite 101 → 106, integration 10 → 11 (new
`optimiseTree.integration.test.ts`, a ~2 min tagged repair run).

After that: `03` (the contract) stays serial and alone, since it is what forces rework in two
tracks if it moves. Then fork into `04` / `05`+`06` / phase 1.5.

Deferred beam-search items (pruning layers, `--target-level`, from-scratch mode) stay below all of
it — pick them up only on demand.

### Phases 2 and 3 — COMPLETE 2026-08-29 (parallel worktrees)

Run as two concurrent Sonnet agents in `git worktree`s off `phase1-bridge-service`, exactly as
`08-fork-prep.md` designed. Both merged back clean, including root `package.json` — the fork-prep
bet paid off.

- **`04` API** (`bf18bb2`, merged `8376f38`) — `packages/api`: Hono on `127.0.0.1:8787`, build
  ingest + store, in-memory job registry (`EventEmitter`/job, FIFO, `MAX_ACTIVE_JOBS <= POOL_SIZE`),
  SSE relay, cancel through `shouldContinue`, `updatedPobCode` via `applyPlan`, all 8 contract
  mapper obligations tagged at their sites. `CoreFns` is injectable so the fast suite stubs core.
- **`05`+`06` frontend + canvas** (`9055fb6`, `59f56a7`, `fdc7fcc`, `21845ea`, merged `6d27617`) —
  `packages/web`: Vite + React 4-step wizard, node-list diff, and the stylised tree canvas ported
  from the MIT `poe2-tools/poe2-build-planner` renderer onto `tree-0_5.min.json`
  (`LICENSE.upstream` + per-file provenance; no GGG art). Upstream's min<->max wheel-zoom bug is
  fixed (`zoom.ts`: log slider + fixed wheel step). Dev hits the real API by default; set
  `VITE_USE_MOCK=1` to run against the fixture-backed mock client with no API process.

**Integration fixes applied on top (2026-08-29):**

- **`treeVersion` added to `BuildSummary`** (contract). `05` and `06` both specified a
  tree-version-mismatch fallback to the list view, and it was **unimplementable** — no such field
  existed anywhere in the contract, core, or the bridge, and `get_tree_status` does not return it.
  The API now reads `<Spec treeVersion>` straight off the XML (`parseTreeVersion`, deliberately the
  *first* `<Spec>` so it describes the spec `applyPlan` edits). `Results.tsx` prefers the declared
  version and keeps the id-overlap heuristic only as the fallback for XML that carries none.
- **`serveStatic` wired** — the prod server serves `packages/web/dist` at `/` with an SPA
  fallback, mounted only when the bundle exists on disk so an API-only run doesn't 404 through a
  rootless static handler.
- **`zustand` dropped** — installed by fork-prep, never used (`05` mandates `useReducer`).

**Known gaps carried forward, both cheap:**

- `ProgressEvent.bestObjective` is required (`z.number()`), but core's `RecommendProgress` has no
  such field, so recommend ticks report `0`. Either core exposes one or the contract makes it
  optional for the recommend kind.
- `lightningcss` has no native binding on this machine, so `vite build` uses
  `cssMinify: "esbuild"` (`packages/web/vite.config.mts`). Machine-level, not a project defect.

## Known follow-ups (non-blocking)

- **`ProgressEvent.bestObjective` should be optional** (raised 2026-08-29, deferred as a
  follow-up). `progress.ts`'s own header says the optimise fields and the recommend fields are
  "all optional", but `bestObjective` is declared `z.number()` — required — and only
  `OptimiseProgress` has it. `RecommendProgress` carries `candidatesTotal`/`candidatesScored`
  and no objective, so `normalizeProgress` (`packages/api/src/jobs/mappers.ts:219`) is forced to
  invent `0`.
  **Why `0` is the wrong sentinel:** it is a legitimate objective value — builds that score 0 DPS
  headless are a first-class error surface here (two in the corpus), so a consumer cannot tell
  "recommend job, no such concept" from "optimise job on an unscorable build". Worse,
  `RunProgress.tsx:49` computes `bestObjective - baselineObjective`, so a recommend tick would
  render a huge *negative* delta — a run apparently collapsing.
  **Not reachable today:** `packages/web/src/api.ts:80` hardcodes `kind: "optimise"`; the
  recommend-only screen is a deferred v1 non-goal. This bites whoever adds that screen.
  **Fix (~15 min):** `bestObjective: z.number().optional()`, drop the fabrication in the mapper,
  guard it in `RunProgress` the way `depth`/`k` already are. Rejected alternative: giving
  `RecommendProgress` a real `bestObjective` — recommend scores candidates in isolation against a
  fixed baseline, so there is no "best so far" to report, and its
  `candidatesScored`/`candidatesTotal` is already a better progress signal than optimise has
  (a real denominator).
- **`spike/genCanvasFixture.ts` writes only a trimmed canvas projection.** Contract tests must
  therefore *reconstitute* a full `OptimiseResultDTO` before parsing, which is the weakest link
  in an otherwise strong verification chain: `final.stats` is hand-authored, and the
  reconstitution derives a finite `objectiveAfterRemoval`, so the fixture test never exercises
  the nullable branch (a dedicated unit test does). Worth dumping an untrimmed
  `OptimiseTreeResult` blob alongside the projection so future tests parse raw output instead.
  Raised by the phase-1 session 2026-08-29. Not worth holding the fork for.
- Bench sweep to justify a default `beamWidth > 1` (open since the beam-search track).

## Scope

**Passive skill tree only.** Skill gems and their support gems are immutable calculation inputs —
the optimiser never edits `socketGroupList` (decided 2026-08-28). The skill / support-gem
optimiser is shelved indefinitely, not "next".

## Other tracks

### Skill / support-gem optimiser — SHELVED (out of scope)

Design sketch + the completed PoE1-vs-PoE2 assumption audit are kept in
`docs/skill-optimiser-design.md` for reference only, in case scope ever reopens. Not on the
roadmap. Audit headline (still valid if revived): the calc engine enforces almost none of the gem
rules — one-support-per-character, ≤5-per-skill, family-uniqueness would all be ours to impose;
socket colours don't exist; no minimum-stat gate to socket a support; Spirit is flat-only and
loads already-violating (needs `keepViolating`); gem level/quality are free inputs.

### Bridge → standalone shared package — folded into the web UI track

Was blocked on needing a second consumer of `pob-runtime/bridge.lua` + `src/core/bridge.ts`. The
web UI is that consumer, so this is now step 1 of the *Active next track* above rather than its
own line.

### Web frontend — promoted to the Active next track

See *Active next track: web UI + bridge service* above.

## `docs/` layout

- `../CLAUDE.md` (repo root) — working guidance loaded every session: the fast/integration
  test split (**integration runs only on request**), the `npm audit fix` prohibition, and how
  cross-package imports resolve. Added 2026-08-29.
- `status.md` — this file, the map.
- `gotchas.md` — PoB-PoE2 leftovers to not trip on. Always relevant.
- `constraint-rejection-repro.md` — live repro of the recommender's constraint filter.
- `skill-optimiser-design.md` — shelved track, kept for reference.
- `beam-search/` — the completed passive-tree optimiser track: `design.md` (+ Implementation
  status checklist), `repro.md`, `corpus.md`, `bench-totaldps.md`, `bench-dps-ehp-0-5.md`.
- `cli/` — **user-facing** CLI reference: `README.md` (objectives, constraints, picking a
  mode), `optimise-tree.md`, `recommend-tree.md`. Added 2026-08-29 alongside the root
  `README.md`, which covers both the CLI and the web UI.
- `web-ui/` — the active track. Start at its `README.md`.

## How to pick this up

1. This file for the map.
2. `docs/beam-search/design.md` — design + Implementation status checklist + open questions.
3. `docs/gotchas.md` — PoB-PoE2 leftovers to not trip on.
4. `src/core/optimiseTree.ts` + `src/core/recommendTree.ts` and their test files.
