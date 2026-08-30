<!-- generated-by: groundrules v1.10.0 -->
# PLAN — poe2-build-optimiser

**Active plan/todo _and_ the map.** Read this first. It records what is happening now (In
progress / Up next / Ideas / Waiting), then what exists and what is out of scope (Shipped /
Out of scope). Forward-looking candidate work lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).
Maintained by Claude during work.

Recommends and optimises PoE2 passive-tree allocations, using PoB-PoE2's own headless calc
engine as the fitness oracle (same technique as the sibling `poe2_craftsman` project, which
stays out of the tree). Provenance and design rationale live in git history and the other
`docs/` files; this file is just the map.

**Maintenance:**

- This is a MAP, not a changelog. Blow-by-blow history (dates, commit hashes, test counts,
  "step N done") belongs in git and the detail docs — not here.
- One line per item. If an item needs a paragraph, it belongs in a `docs/` or `intake/`
  sub-file — link it instead.
- Do NOT reintroduce "phase" / "step" numbering. Describe a capability by what it does, not by
  the plan that produced it. Numbered plans live in `intake/`; decisions live in
  `docs/decisions/`.
- When a capability lands, move it to Shipped. When an open item closes, delete it — don't
  annotate it as done.
- Absolute dates only (YYYY-MM-DD).
- Status vocabulary: `[ ]` to do · `[~]` delivered, in review / awaiting validation · `[x]`
  done & validated.

## In progress

- [ ] *(nothing active)*

## Up next

- [supervised] `PobBridgePool.acquireParallel`'s one-line `onShardProgress` passthrough
  (`packages/pob-bridge/src/pool.ts`) has no fast-unit coverage — `pool.ts` has no fake-slot test
  harness (only `pool.integration.test.ts`, real LuaJIT). Covered transitively by
  `parallel.test.ts` (the callback contract) and `registry.test.ts` (the merge at the API layer);
  the one line connecting them is unverified except by eye or an integration run
  (docs/prd/web-ui-live-progress-view.md)
- [loop] `RunProgress.tsx`: per-worker rows (slot · done/total) and top-5 promising-nodes list —
  realized 2026-08-30, red acceptance tests in `RunProgress.test.tsx`, tasks in
  `loop/backlog.md` (docs/prd/web-ui-live-progress-view.md)
- [supervised] `RunProgress.tsx`: `bestObjective` sparkline — needs a history-tracking design
  decision the PRD doesn't settle (component-local state vs. a new prop from the parent) and
  stateful re-render test tooling not yet used in this test file
  (docs/prd/web-ui-live-progress-view.md)
- [supervised] Highlight top-N nodes on the shipped `06` canvas — PRD's own validation is
  "visual check", no acceptance test specified yet (docs/prd/web-ui-live-progress-view.md)
- [supervised] End-to-end live-progress check against a real bridge, pool size 2, screenshot —
  manual/E2E by nature; conflicts with the real-bridge-only-when-asked rule
  (docs/prd/web-ui-live-progress-view.md)

Candidates and deferred work live in [`docs/ROADMAP.md`](docs/ROADMAP.md) — an item moves up
here when it is actively picked up.

## Ideas — to triage

Raw ideas, captured before they're lost (e.g. via `/groundrules:idea`). Not yet vetted. Each
gets triaged later → a **decision** (ADR), a **build** (PRD), a **milestone** (ROADMAP), or
dropped.

- [ ] **Freeze nodes from tree explorer** — add a right-click context menu to the Configure
  tree explorer to freeze nodes. *(build?)*
- [ ] **Dropdown metric picker in constraint builder** — let users pick constraint metrics from
  a dropdown instead of typing them blind, since they don't know what's available.
- [ ] **Selectable objective metric** — let the user pick the single objective metric from a
  list rather than typing/configuring it.
- [ ] **Drop MinResist constraint** — resists mostly come from gear, not the skill tree, so
  MinResist doesn't pull its weight as a constraint. *(decision?)*

## Waiting / blocked

- [ ] ...

## Recently done

- [x] Migrated `docs/status.md` into this file; `status.md` deleted, references repointed here
  (2026-08-29)
- [x] Extracted forward-looking roadmap items to `docs/ROADMAP.md`; PLAN.md keeps the now-work
  and the map (2026-08-29)
- [x] Triaged the live-progress-view idea into a PRD
  ([`docs/prd/web-ui-live-progress-view.md`](docs/prd/web-ui-live-progress-view.md)) and a
  `docs/ROADMAP.md` entry (2026-08-29)

---

## Shipped on `main`

- **Greedy recommender** — `src/core/recommendTree.ts`, `npm run recommend-tree`. Ranks the best
  *next* node(s) by real stat-delta-per-point. Supports `damageType` prioritisation, `objective`
  keyword filter, and a `constraints` / `preserveMetrics` / `keepViolating` feasibility filter.
  Deterministic (id-sorted pool, id-tie-broken ranking).

- **Tree optimiser** — `src/core/optimiseTree.ts`, `npm run optimise-tree`. Modes and options
  compose:
  - **extend** — add up to a point budget within proximity `K` of the current tree.
  - **repair** (`--respec-budget N`) — free up to `N` points of the lowest-value allocated nodes
    (leaf *or* interior, via the `DeallocNode` cascade), greedily re-spend; the driver sweeps
    `k = 1..N` points freed and keeps the best.
  - **rollback-to-node** (`--rollback-to <id>`) — force-free the anchor's entire downstream
    cascade, then re-spend; composes with `--respec-budget` to also sweep survivors. Guard
    `MIN_ANCHOR_SPINE_POINTS = 3` rejects near-total rollback (that is from-scratch territory).
  - **`(W, D)` beam** — `--beam-width` / `--beam-depth`, shared by extend and repair. `W = 1` is
    byte-identical to the old greedy walk.
  - **`freeze` list** — `--freeze <id,…>`: allocated ids the repair regret set may never free.
    Ascendancy nodes are always frozen.
  - **composite objectives** — `src/core/objective.ts`: `dps-ehp:W` / `blend:A,B,W`, memoised
    evaluator with a `BuildOutput()` counter.
  - Result carries `allocatedNodeIds: { before, after }` (both id-sorted, connected by
    construction); `after === before` when the recommendation is "change nothing".
  Design + open questions: `intake/beam-search-design.md`. Validation recipe (raw `TotalDPS` +
  `--preserve` on tree-sourced defensive layers) and its findings: `docs/beam-search/repro.md`.

- **Parallel candidate evaluation** — `ParallelBridge` (`packages/pob-bridge/src/parallel.ts`)
  shards each candidate batch across a lease of pool slots and recombines byte-identically. Zero
  `src/core` changes — core already funnels every batch through one `bridge.call(...)`.
  `optimise-tree --parallelism <n>` on the CLI; the API job runner picks it per job.
  Caveat: `buildOutputCount` does not match the serial path exactly (sharding multiplies one tail
  recompute per call); the *plan* is byte-identical. Details: `intake/web-ui/01-bridge-service.md`
  §"Phase 1.5" and ADR-0011.

- **Local web UI** — `packages/{pob-bridge, contract, api, web}`, npm workspaces, source-level
  aliases (no build step, no TS project references). Local-first, single user, not hosted.
  - `pob-bridge` — extracted `pob-runtime/` + `bridge.ts`, with `PobBridgePool` (FIFO,
    crash-respawn, `lease(n)` for atomic multi-slot). `POOL_SIZE` and `JOB_PARALLELISM` default to
    half the host's core count (floor 1) — PoB's calc is CPU-bound and each LuaJIT child is
    ~700 MB resident.
  - `contract` — Zod schemas + inferred DTOs shared by API and web.
  - `api` — Hono on `127.0.0.1:8787`, build ingest/store, in-memory job registry (FIFO,
    slot-based admission), SSE progress relay, cancel via `shouldContinue`, `updatedPobCode` via
    `applyPlan`. Serves `packages/web/dist` at `/` when the bundle exists.
  - `web` — Vite + React wizard, node-list diff, and a stylised passive-tree diff canvas (shapes
    not sprites, ported from the MIT `poe2-tools/poe2-build-planner` Canvas2D renderer onto our
    `tree.json`; no GGG art). `VITE_USE_MOCK=1` runs against a fixture-backed mock client.
  - Core changes for the UI: `onProgress` + `shouldContinue` in `optimiseTree` / `recommendTree`.
  Full plan, one file per domain: `intake/web-ui/` (start at its `README.md`). Decisions:
  ADR-0005, ADR-0006, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0012.

- **PoB-PoE2 gotchas** — `docs/gotchas.md`. Read before touching `bridge.lua` tree/alloc code or
  relying on any mechanic that might be a PoE1 leftover.

## Out of scope

- **Passive tree only.** Skill gems and their support gems are immutable calc inputs — the
  optimiser never edits `socketGroupList` (ADR-0002).
- **Skill / support-gem optimiser — shelved indefinitely.** Design sketch + the completed
  PoE1-vs-PoE2 assumption audit kept in `intake/skill-optimiser-design.md` for reference only.
- **PoB stays the fitness oracle.** Not replaced by a home-grown engine over GGG's data exports —
  the exports are data, not the damage formula. The ~280 ms/recompute cost is a speed-lever
  problem, not an architecture problem (ADR-0001, `intake/web-ui/07-performance.md`).

Decisions of record live in `docs/decisions/` (ADR-0001 … ADR-0012).

## Doc layout

Curated docs live in `docs/`; the design specs that fed them live in `intake/`.

**`docs/` — curated, kept current:**

- `../CLAUDE.md` — working guidance loaded every session: the fast/integration test split
  (integration runs only on request), the `npm audit fix` prohibition, cross-package import
  resolution.
- `../PLAN.md` — this file, the plan and the map.
- `VISION.md` / `ARCHITECTURE.md` / `ROADMAP.md` / `PROCESS.md` / `LEARNINGS.md` / `GLOSSARY.md` —
  groundrules-managed synthesis docs.
- `decisions/` — ADR-0001 … ADR-0012, the decisions of record.
- `gotchas.md` — PoB-PoE2 leftovers to not trip on. Always relevant.
- `constraint-rejection-repro.md` — live repro of the recommender's constraint filter.
- `beam-search/` — the tree-optimiser track's results: `repro.md` (validation write-up),
  `corpus.md`, `bench-totaldps.md`, `bench-dps-ehp-0-5.md`.
- `cli/` — user-facing CLI reference: `README.md`, `optimise-tree.md`, `recommend-tree.md`.

**`intake/` — design specs, updated only when the design changes:**

- `beam-search-design.md` — the tree-optimiser design + implementation-status checklist + open
  questions.
- `web-ui/` — the web UI + bridge-service track, one file per domain. Start at its `README.md`.
- `skill-optimiser-design.md` — shelved track, reference only.

## How to pick this up

1. This file for the plan and the map.
2. `intake/beam-search-design.md` — design, implementation-status checklist, open questions.
3. `docs/decisions/` — why the load-bearing choices were made.
4. `docs/gotchas.md` — PoB-PoE2 leftovers.
5. `src/core/optimiseTree.ts` + `src/core/recommendTree.ts` and their test files.

---

**Convention**: Claude updates this file at the start/end of each session. Completed tasks stay
in "Recently done" for ~1 week then are archived (deleted or moved to git history).
