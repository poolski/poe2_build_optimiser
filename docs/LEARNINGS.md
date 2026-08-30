<!-- generated-by: groundrules v1.10.0 -->

# Learnings — poe2-build-optimiser

Rules learned from corrections and non-trivial discoveries during the project. Reverse-chronological order (newest at the top). **Re-read at session start.**

One entry = one **actionable rule**, not a journal note. Each entry has:

- a title that states the rule (imperative or "X: do Y");
- **Why** — the story behind it: what happened, what it cost (a revert, a lost CI cycle, a confused user…);
- **When to apply** — the concrete trigger conditions, so the rule fires at the right moment instead of being remembered too late.

Include the minimal code snippet / command when it is the fix.

---

## Frontend checks: Playwright + Chromium against the mock API, not the real bridge

**Why**: on 2026-08-30, verifying the `TreeCanvas` context-menu feature needed a real browser
click-through, but no browser tool (chromium-cli or similar) was available in the environment,
and driving the app against the real API would have meant booting the real LuaJIT bridge just
for a UI check. `npx playwright` plus the app's existing `VITE_USE_MOCK=1` fixture-backed client
gave a clean, fast headless check with screenshots, no bridge involved.

**When to apply**: when making changes to the frontend (`packages/web`), whether style or
functionality, drive the manual check with Playwright + Chromium against the mock/fixture-backed
API (`VITE_USE_MOCK=1`), not the real API/bridge. If the change touches only frontend code, skip
running backend tests. Ensure you clean up the dev server once done testing.

## Grep for existing wiring before scoping a PRD as "free text"

**Why**: on 2026-08-30 the Configure-step-pickers PRD was scoped assuming `ObjectiveBuilder`'s
metric field was pure free text, based on reading the field's obvious JSX. It only surfaced
during `/groundrules:realize` test-authoring that the field already had a `datalist` hybrid
picker (shipped in `fdc7fcc`) — containing two invented metric names, `CombinedDPS` and
`FullDPS`, that had sat unnoticed on `main` since. The cost: a PRD success criterion and build
step had to be rewritten mid-`realize`, and an invented-data bug went undetected for a release.

**When to apply**: before writing a PRD's Problem/Scope section claiming a behaviour is "free
text" / "missing" / "not built," grep for the attribute or handler that would prove otherwise
(`list=`, `datalist`, `onClick`, `onContextMenu`, etc.) rather than stopping at eyeballing the
component's obvious code path.

## A spec is not queued until it is linked: land the PRD, the ROADMAP entry, and the PLAN.md triage removal together

**Why**: on 2026-08-29 the live-progress-view PRD was written and committed, but `PLAN.md` still
listed it under "Ideas — to triage" and `docs/ROADMAP.md` never mentioned it. The most-developed
piece of pending work was invisible in the roadmap while simultaneously reading as un-triaged in
the plan. The cost is trust: once the same item carries two different statuses in two files,
`PLAN.md` and `ROADMAP.md` stop being usable as the map, which is the one job they have.

**When to apply**: on any doc-map edit — a change to `PLAN.md`, `docs/ROADMAP.md`, or `docs/prd/`.
Before finishing, confirm the other two agree: every PRD has a ROADMAP entry, and nothing sits in
PLAN.md's Ideas list that has already been triaged into a spec.

## Re-verify a PRD's premises against shipped code whenever you touch it

**Why**: the same 2026-08-29 pass found the live-progress PRD resting on two premises the code
contradicted — it assumed per-worker candidate state was reachable from `beamAddLoop` (it is not:
phase 1.5 lives entirely in `ParallelBridge`, which shards batches and leaves `src/core`
worker-unaware), and it treated the spec-`06` tree canvas as possibly-unlanded when it had already
shipped to `main`. Both would have surfaced mid-build. A build plan whose steps rest on stale
premises is a roadmap entry that cannot be trusted — same cost as the rule above.

**When to apply**: on any doc-map edit that touches a PRD, and again before starting its first
build step if the PRD is more than a few commits old. Re-read the modules and specs it names
rather than trusting the sentence that names them.

## Verify every PoE2 mechanic against real PoB behaviour before relying on it

**Why**: the PoB-PoE2 fork vendored data from an older PoE1 build, so plausible-looking mechanics in
the vendored files are sometimes PoE1 leftovers that PoE2 does not have. Assuming they are current
produces a calc result that looks fine and is wrong — the failure is silent, which is the expensive
kind. The known set is catalogued in [`docs/gotchas.md`](gotchas.md).

**When to apply**: before touching `bridge.lua` tree/alloc code, and before relying on any stat,
node, or mechanic read out of vendored PoB data. Read `docs/gotchas.md` first; if the data the calc
needs is missing or looks wrong, stop and surface it rather than inventing it.

## Spare passive points are the intersection of the weapon sets, not the union

**Why**: builds can allocate different passive nodes per weapon set, so a naive total over-counts
what is actually free to respec. The correct figure is
`min(weaponSet1PointsUsed, weaponSet2PointsUsed)` — take the union and the optimiser spends points
it does not have, producing a plan PoB will not accept.

**When to apply**: any point-budget arithmetic — respec budgets, `--extra-points`, and the future
`--target-level` mapping.

## Repair must free interior nodes via the `DeallocNode` cascade, not leaves only

**Why**: the first repair design only freed terminal nodes. Real trees waste points on long dead
paths whose _interior_ nodes are the ones worth removing, so leaf-only repair could not reach the
actual waste and under-performed on real builds. Lifting the filter and freeing connected subtrees
through `DeallocNode` is what made repair useful (ADR-0003).

**When to apply**: any change to the regret set or the removal candidate pool. Removal candidates
are "any allocated node with its downstream cascade", not "nodes with no children".

## Keep `beamWidth = 1` as the default until bench data justifies widening it

**Why**: the beam was designed for `W > 1`, but greedy (`W = 1`) proved sufficient across the
25-build corpus, and `W = 1` is byte-identical to the original greedy walk — a free correctness
anchor. Widening the default without measurement would spend real wall-clock on every run for
unproven lift.

**When to apply**: when tempted to raise the default beam width. It stays 1 until a
`npm run bench-tree-approaches` sweep shows lift-vs-wall-time that justifies the change (the open
item in [`docs/ROADMAP.md`](ROADMAP.md)). Per-run overrides via `--beam-width` are always fine.

## Always hold a defensive metric floor during repair

**Why**: with no floor on a defensive metric, repair "improves" a build by enabling Chaos
Inoculation — which removes the life cap — and then reallocating every life node into damage. The
objective score climbs and the build is unplayable. The floor is what makes the optimiser's output
trustworthy rather than merely high-scoring (ADR-0004).

**When to apply**: any run that can free allocated nodes, and any new objective or scoring blend.
Preserve at least one defensive metric (`--preserve`, default `TotalEHP` — resists come from gear,
not the tree). Note that a preserve floor is inert on top of a `dps-ehp` blend, so the blend does not
substitute for it.

## Size the bridge pool by memory, not by core count

**Why**: each LuaJIT child holds roughly 700 MB resident, so "one per core" exhausts RAM on a normal
desktop long before it saturates the CPU. `POOL_SIZE` and `JOB_PARALLELISM` therefore default to
half the host's cores (floor 1), not all of them (ADR-0011).

**When to apply**: when changing pool defaults, adding a parallel code path, or running anything that
boots real bridges. Corollary: only one session or worktree may run the integration suite at a time —
check for a live `luajit.exe` first.

## Parallelise by sharding the batch at the bridge, leaving `src/core` untouched

**Why**: parallel candidate evaluation is the real wall-time win for large repair budgets, and it
landed with _zero_ `src/core` changes — `ParallelBridge` shards one `evaluate_candidate_nodes[_from]`
batch across leased pool slots and recombines by chunk index, so core still sees a single
`bridge.call(...)`. Keeping the split there preserved determinism (recombination is by index, not
arrival order) and the architecture rule below. The cost is that core has no notion of a "worker" —
see the PRD-premise rule above for what that broke.

**When to apply**: any future speed-lever work. Push concurrency into the bridge layer and keep the
recombination order-independent; if a feature seems to need core-level worker awareness, that is a
design smell worth re-examining first.

## Don't reach for the memo cache to explain optimiser cost

**Why**: the layer-5 per-allocation-set cache hits at roughly 0% during greedy search — greedy never
reconverges on the same allocation set, so there is nothing to hit. Tuning or blaming the cache is
wasted effort; the cost is the ~280 ms PoB recompute itself. The cache stays for future algorithm
variants that do reconverge.

**When to apply**: when profiling a slow run or proposing a caching change. Measure recompute count
(`get_metrics`) first; a cache-hit-rate hypothesis needs a search variant that actually revisits
states.

## Any test that boots a real bridge belongs in `*.integration.test.ts`

**Why**: end-to-end optimiser runs once leaked into the default suite, which turned the routine check
into a ~4-minute, multi-gigabyte run that spawns `luajit.exe` children. The split (ADR-0007) exists to
keep `npm test` fast and fake-bridge-only; a single misplaced test silently undoes it for everyone.

**When to apply**: when adding any test that constructs a real bridge or pool — put it in an
`*.integration.test.ts` file. The routine verification loop stays `npm test` plus `npx tsc --noEmit`;
`npm run test:integration`, the bench harness, and the `spike/` scripts run only when explicitly
asked.

## `src/core` receives a bridge and never constructs one

**Why**: keeping construction at the edges (the CLIs, `packages/api/src/server.ts`) is what let the
core stay pure business logic and testable against fake bridges — and it is why parallelism could be
added later as a drop-in `bridge` argument with no core changes at all.

**When to apply**: any new code path in `src/core` that needs calc results. Take the bridge as a
parameter; construct it at the edge. `packages/api/src/core.ts` is the single sanctioned crossing
from `packages/` into repo-root `src/`.

## Resolve cross-package imports through source aliases, not a build step

**Why**: cross-package imports resolve through `tsconfig.base.json` `paths` plus the vitest aliases,
so the repo has no build step and no TypeScript project references (ADR-0006). A new workspace
dependency usually needs no `npm install` at all — reaching for the lockfile first adds churn and
risks disturbing the five deliberately-unfixed dev-toolchain advisories.

**When to apply**: when adding a cross-package import. Check whether the alias already covers it
before touching `package.json` or the lockfile. Never run `npm audit fix --force`.
