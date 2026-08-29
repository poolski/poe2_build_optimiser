---
title: build_optimiser — project status
purpose: The map. A concise record of what exists, what is open, and what is out of scope. Read first.
maintenance: |
  - This is a MAP, not a changelog. Blow-by-blow history (dates, commit hashes, test counts,
    "step N done") belongs in git and the detail docs — not here.
  - Four sections, in order: Shipped, Open follow-ups, Deferred, Out of scope. One line per item;
    if an item needs a paragraph, it belongs in a `docs/` or `intake/` sub-file — link it instead.
  - Do NOT reintroduce "phase" / "step" numbering. Describe a capability by what it does, not by
    the plan that produced it. Numbered plans live in `intake/`; decisions live in
    `docs/decisions/`.
  - When a capability lands, move it to Shipped. When an open item closes, delete it — don't
    annotate it as done.
  - Absolute dates only (YYYY-MM-DD).
---

# build_optimiser — status

Recommends and optimises PoE2 passive-tree allocations, using PoB-PoE2's own headless calc engine
as the fitness oracle (same technique as the sibling `poe2_craftsman` project, which stays out of
the tree). Provenance and design rationale live in git history and the other `docs/` files; this
file is just the map.

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
  §"Phase 1.5" and ADR-011.

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
  ADR-005, ADR-006, ADR-008, ADR-009, ADR-010, ADR-011.

- **PoB-PoE2 gotchas** — `docs/gotchas.md`. Read before touching `bridge.lua` tree/alloc code or
  relying on any mechanic that might be a PoE1 leftover.

## Open follow-ups (non-blocking)

- **Bench sweep for a default `beamWidth > 1`.** `W = 1` ships as the default; no data yet on
  whether a wider beam is worth the cost. Open since the beam-search track.
- **`10` — RePoE-fork asset source.** Spec only, not built (`intake/web-ui/10-repoe-asset-source.md`).
  Would add real node art / stat text / gem data to the web tree; calc engine stays on PoB.
- **`spike/genCanvasFixture.ts` writes only a trimmed canvas projection.** Contract tests
  reconstitute a full `OptimiseResultDTO` before parsing, so the fixture test never exercises the
  nullable `objectiveAfterRemoval` branch (a dedicated unit test does). Worth dumping an untrimmed
  `OptimiseTreeResult` blob alongside the projection.

## Deferred (only if a real need appears)

- Pruning layers 3 / 4 / 6 from the beam-search design — greedy re-spend has been sufficient.
- `--target-level` → point-budget derivation — needs the act→quest-point mapping verified against
  vendored data first (`docs/gotchas.md` discipline).
- From-scratch mode (∞ budget + bare tree) — also the blocker for rollback with an anchor near
  the class start; both need the add-loop to spend zero-delta pathing steps toward a distant
  payoff.

## Out of scope

- **Passive tree only.** Skill gems and their support gems are immutable calc inputs — the
  optimiser never edits `socketGroupList` (ADR-002).
- **Skill / support-gem optimiser — shelved indefinitely.** Design sketch + the completed
  PoE1-vs-PoE2 assumption audit kept in `intake/skill-optimiser-design.md` for reference only.
- **PoB stays the fitness oracle.** Not replaced by a home-grown engine over GGG's data exports —
  the exports are data, not the damage formula. The ~280 ms/recompute cost is a speed-lever
  problem, not an architecture problem (ADR-001, `intake/web-ui/07-performance.md`).

Decisions of record live in `docs/decisions/` (ADR-001 … ADR-011).

## Doc layout

Curated docs live in `docs/`; the design specs that fed them live in `intake/`.

**`docs/` — curated, kept current:**

- `../CLAUDE.md` — working guidance loaded every session: the fast/integration test split
  (integration runs only on request), the `npm audit fix` prohibition, cross-package import
  resolution.
- `status.md` — this file, the map.
- `VISION.md` / `ARCHITECTURE.md` / `ROADMAP.md` / `PROCESS.md` / `LEARNINGS.md` / `GLOSSARY.md` —
  groundrules-managed synthesis docs.
- `decisions/` — ADR-001 … ADR-011, the decisions of record.
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

1. This file for the map.
2. `intake/beam-search-design.md` — design, implementation-status checklist, open questions.
3. `docs/decisions/` — why the load-bearing choices were made.
4. `docs/gotchas.md` — PoB-PoE2 leftovers.
5. `src/core/optimiseTree.ts` + `src/core/recommendTree.ts` and their test files.
