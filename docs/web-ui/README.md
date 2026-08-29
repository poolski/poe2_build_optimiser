# Web UI + bridge service — index

**Current state (per `git log` on `main`):** v1 **shipped** — a **local web UI** over `src/core/`,
with the LuaJIT bridge extracted into a standalone service package. Phases 1–3, fork-prep, and the
rollback tree preview (`09`) are all merged. **Phase 1.5** (parallel candidate eval — the
single-run wall-time win) is **built on branch `phase1.5-parallel-eval`, not yet merged to
`main`** — see `01-bridge-service.md` §"Phase 1.5" for what shipped. **One item remains, not
started:** the RePoE-fork asset source (`10`, spec only). See Sequencing below for the per-phase
status and commit refs.

This directory is one file per domain — a mix of shipped design-of-record and the two open specs:

| File | Domain | Phase |
| ------ | -------- | ------- |
| [`01-bridge-service.md`](01-bridge-service.md) | Lift `pob-runtime/` + `src/core/bridge.ts` into a package with a process pool; §"Phase 1.5" = parallel candidate eval within a run | 1 (+1.5) |
| [`02-core-progress.md`](02-core-progress.md) | The two v1 changes to `src/core/*`: `onProgress` + `shouldContinue` | 1 |
| [`03-shared-contract.md`](03-shared-contract.md) | Zod schemas + inferred types shared by API and UI | 2 |
| [`04-api-server.md`](04-api-server.md) | Hono + Zod HTTP server: builds, jobs, SSE progress | 2 |
| [`05-frontend.md`](05-frontend.md) | Vite + React SPA: input → config → run → node-list diff | 3 |
| [`06-tree-canvas.md`](06-tree-canvas.md) | Stylised passive-tree canvas with the diff highlighted (shipped) | 3 |
| [`07-performance.md`](07-performance.md) | Why PoB stays the fitness oracle + the full speed-lever table | cross-cutting |
| [`08-fork-prep.md`](08-fork-prep.md) | The one commit between phase 1 and phase 2 that makes the later phases safe to run in parallel | 1 → 2 |
| [`09-rollback-tree-preview.md`](09-rollback-tree-preview.md) | Rollback anchor picker: reuse the canvas in Configure, click-to-select, freed-subtree preview | **shipped** |
| [`10-repoe-asset-source.md`](10-repoe-asset-source.md) | **Spec, not built.** Proposes moving the web tree (geometry, node art, stat text) + a gem asset layer onto RePoE-fork, adding real node icons — would reverse `06`'s "no art" | not started |

**On speed:** v1 (on `main`) runs a job as slowly as the CLI does — the pool (phase 1) only
overlaps *concurrent* jobs, which a single user rarely has. The wall-time win is **phase 1.5**
(lever 1b in `07`): parallelise one run's candidate batch across the pool. It is built
(`packages/pob-bridge`'s `PobBridgePool.lease()`/`acquireParallel()` + `ParallelBridge`,
`--parallelism <n>` on `optimise-tree`, and `packages/api`'s job runner + `JobRegistry` wired to
it) but lives on the unmerged `phase1.5-parallel-eval` branch — `main` itself still runs every job
on one slot until this branch merges. Once merged, the win is opt-in server-side too: `POOL_SIZE`
and the new `JOB_PARALLELISM` both default to half the host's cores, so the win is on by default; set `JOB_PARALLELISM=1` for
the API to actually lease more than 1 slot per optimise job — see `01` §"Phase 1.5" for why that
default is conservative (each extra slot committed per job is another ~700 MB-resident child).

## Decisions of record (2026-08-28)

Settled with the user before writing this plan:

1. **First-version scope — full optimiser.** Extend / repair / rollback modes, objective picker,
   constraints, `freeze`, beam `W`/`D`. The read-only recommender view alone is too thin; it
   comes along for free as a lighter job type.
2. **Build input — paste *and* file upload.** A textarea for a PoB export code
   (`base64(zlib(xml))`, the exact format `spike/fetchNinjaBuilds.ts:76` decodes) and a drop zone
   for a `.xml` file.
3. **Bridge packaging — extract the package now.** Not "server holds a pool, extract later". The
   package is `01-bridge-service.md`.
4. **Stack — Vite + React SPA, Hono API.**
   - **Hono** + `@hono/node-server` for the API: tiny dep tree, first-class TS, ships
     `streamSSE` (progress stream) and `serveStatic` (the built bundle) so we don't hand-roll SSE
     framing or a static handler. Runs on `node:http`, so the bridge pool stays a plain module
     singleton beside it.
   - **Zod** for request validation and as the single source of the shared request/response
     types (`03-shared-contract.md`).
   - **No job-queue library.** Single-user tool → an in-memory `Map<jobId, JobState>` + an
     `EventEmitter` per job. The only scheduling concern is spreading work across the LuaJIT
     pool; port the bench harness's `runWithConcurrency` (`spike/benchTreeApproaches.ts:277`)
     and only reach for `p-queue` if it starts feeling hand-rolled.
5. **PoB stays the fitness oracle.** Not replaced by a home-grown engine over GGG's data
   exports — the exports are data, not the damage formula; reimplementing PoB's calc is
   person-years, less accurate, and a patch treadmill. The ~280 ms/recompute cost is addressed
   with the speed levers, not by dropping PoB. Full rationale + the lever table:
   `07-performance.md`.
6. **Result rendering — node-list diff *and* the tree canvas, both in v1.** The canvas (`06`) is
   the headline result — for a respec tool "move these points" belongs on the tree, not in a
   list. The `05` list diff stays as the always-correct fallback and the view for a build whose
   tree version ≠ the shipped one. Canvas is stylised only (shapes not sprites, dot size by tier,
   PoE2 colours, no orbit rotation), ported from the MIT Canvas2D renderer in
   `poe2-tools/poe2-build-planner` (same stack) onto our PoB `tree.json` — ~1 day, no GGG art.
   PoB-faithful render (DDS texture pipeline) stays out of scope. **This is the current, shipped
   behaviour.** A change to source geometry + real node art from RePoE-fork is *proposed but not
   yet built* in `10-repoe-asset-source.md`.

## Architecture

```
┌─────────────────────────┐     HTTP + SSE      ┌──────────────────────────┐
│  React SPA (Vite)       │ ──────────────────► │  Hono API server         │
│  packages/web           │ ◄────────────────── │  packages/api            │
│  - build input          │   /api/builds       │  - Zod-validated routes  │
│  - run config form      │   /api/jobs         │  - in-mem job registry   │
│  - progress panel (SSE) │   /api/jobs/:id/... │  - SSE progress relay    │
│  - node-diff results    │                     │                          │
└─────────────────────────┘                     └───────────┬──────────────┘
                                                            │ in-process calls
                                                ┌───────────▼──────────────┐
                                                │  src/core                │
                                                │  optimiseTree /          │
                                                │  recommendTree           │
                                                │  + onProgress callback   │
                                                └───────────┬──────────────┘
                                                            │ PobBridgePool.acquire()
                                                ┌───────────▼──────────────┐
                                                │  packages/pob-bridge     │
                                                │  - PobBridge (moved)     │
                                                │  - PobBridgePool (new)   │
                                                │  - pob-runtime/ (moved)  │
                                                └───────────┬──────────────┘
                                                            │ one LuaJIT child per slot
                                                     ┌──────▼──────┐  ┌──────▼──────┐
                                                     │ luajit.exe  │  │ luajit.exe  │  …
                                                     │ bridge.lua  │  │ bridge.lua  │
                                                     └─────────────┘  └─────────────┘
```

`src/core/*` stays where it is and keeps its "parse in / data out" contract. The API server is
its third consumer after the two CLIs. v1 touches core in exactly two places — `onProgress` and
`shouldContinue` (`02-core-progress.md`); phase 1.5 adds a third (the pool-backed parallel
evaluator, `01` §"Phase 1.5").

## Repo layout

The repo is npm workspaces (moved in `660534d`). Nothing about the CLIs changed for the user — the
`npm run` scripts still work from the root. Current layout:

```
build_optimiser/
  package.json                 # workspaces: ["packages/*"], root run-scripts unchanged
  tsconfig.base.json           # shared compiler options (today's tsconfig.json, minus paths)
  src/                         # unchanged: core + the two CLIs, now depends on packages/pob-bridge
  packages/
    pob-bridge/                # phase 1 — PobBridge + PobBridgePool + pob-runtime/ (submodule under it)
    contract/                  # phase 2 — Zod schemas + inferred DTO types
    api/                       # phase 2 — Hono server
    web/                       # phase 3 — Vite + React SPA
```

`src/core/bridge.ts` was moved to `@poe2/pob-bridge` via a one-release re-export shim (`97cbe27`),
then all callers switched to the package import and the shim was dropped (`5c24241`).

## Sequencing

Status is per `git log` on `main` (the authoritative source); commit refs in parentheses. `status.md`
carries the detailed narrative.

- [x] **Phase 1 — bridge service** (`01`, `02`) — npm workspaces + `tsconfig` split (`660534d`),
      `pob-runtime/` + `bridge.ts` → `packages/pob-bridge` (`97cbe27`, `5c24241`), `PobBridgePool`
      + the real-bridge integration suite (`2b52cee`), `onProgress` + `shouldContinue` (`a7b358c`).
- [x] **Fork-prep** (`08`) — deps in one lockfile pass, `contract`/`api`/`web` skeletons + aliases,
      web typecheck/vitest split out, canvas fixtures committed (`e9e2c56`). Plus
      `allocatedNodeIds.{before,after}` on the core result (`3b7dcf6`).
- [x] **Phase 2 — API** (`03`, `04`) — `packages/contract` Zod schemas + DTOs (`564c15b`),
      `packages/api` Hono server + job registry + SSE + `updatedPobCode` (`bf18bb2`, merged
      `8376f38`), serve the built SPA at `/` (`0eeaa3f`).
- [x] **Phase 3 — UI** (`05`, `06`) — Vite + React scaffold (`9055fb6`), 4-step wizard + node-list
      diff (`fdc7fcc`), stylised tree canvas (`59f56a7`, merged `6d27617`). Follow-ups on `main`:
      `treeVersion` on `BuildSummary` (`5a5bd57`), edges at all zoom (`cf3d6cf`), group-index
      off-by-one fix (`29dc76e`).
- [x] **Rollback tree preview** (`09`) — canvas reused in Configure, click-to-select anchor,
      freed-subtree preview (`740374a`, PR #2 `05563b2`).
- [x] **Phase 1.5 — parallel candidate eval** (`01` §"Phase 1.5", `07` lever 1b) — **built, on
      `phase1.5-parallel-eval`, not yet merged.** `PobBridgePool.lease(n)`/`acquireParallel(n)`
      (new, atomic all-or-nothing) + `ParallelBridge` (new, `packages/pob-bridge/src/parallel.ts`)
      shard `evaluate_candidate_nodes[_from]` across N leased slots and recombine by chunk index
      (order-independent, byte-identical plan to N=1 — `buildOutputCount` is NOT identical, by a
      predictable amount; see `01` for the mechanism and the live numbers); `get_metrics` is
      summed across slots; `load_build_xml`/`reset_metrics` broadcast to every slot; everything
      else routes to the primary slot. Zero changes to `src/core` — `ParallelBridge` is a drop-in
      `PobBridgeClient`, consistent with "core receives a bridge, never constructs one".
      `optimise-tree --parallelism <n>` wires it into the CLI. **Wired into `packages/api`'s job
      runner**: `BridgeSource.acquireParallel(n)`, a `parallelism` field on `JobState` decided at
      admission, and `JobRegistry`'s admission rewritten to be slot-based (not job-count-based —
      the old rule silently allowed a lease-time deadlock once a job could request `N > 1` slots).
      New env `JOB_PARALLELISM` (defaults to half the host's cores, = `POOL_SIZE`). See `01` §"Phase 1.5" for the deadlock argument
      and the fast admission tests.
- [ ] **RePoE-fork asset source** (`10`) — **spec only, not started.** Web tree geometry + real node
      art + stat text + gem assets from RePoE-fork; adds icon rendering to the shared `TreeCanvas`.

## Running it

One command each way; add both to the root `package.json` during phase 3.

- **Dev:** `npm run dev` — `concurrently` runs the Hono API (`packages/api`, `127.0.0.1:8787`)
  and the Vite dev server (`packages/web`, `:5173` with `/api` proxied). Open `:5173`.
- **Prod (local):** `npm run build` (all packages, SPA → `packages/web/dist`) then `npm start`
  (API only; it `serveStatic`s `dist` at `/`). Open `127.0.0.1:8787`.

Neither is a background service — it's a tool you start when you want it and Ctrl-C when done.

## Cross-cutting

- **Local-first, single-user, not hosted.** No auth, no multi-tenant concerns, binds
  `127.0.0.1`. Say so in the API README so nobody deploys it.
- **Windows / LuaJIT.** `LUAJIT_EXE` stays env-overridable (`POB_LUAJIT_PATH`), default
  `C:\msys64\mingw64\bin\luajit.exe`. The pool multiplies the number of child processes; document
  the RAM cost (~one PoB runtime per slot).
- **Determinism is a feature.** `optimiseTree` / `recommendTree` are one deterministic value per
  `(build, options)` and the bench harness relies on it. `onProgress` must be side-effect-free
  and must not touch search order. The API must pass options straight through.
- **Long jobs.** An optimise run is hundreds of ~280 ms recomputes = minutes. Everything is
  submit → poll/stream → result; there is no synchronous "optimise now" endpoint.
- **Error surfaces to keep first-class:** 0-DPS builds that score nothing headless (`BlandisThree`,
  `Blood Mage` in the corpus), an objective that can't score the baseline, a LuaJIT child that
  dies mid-job, an over-allocated ninja import (`--point-budget` territory).

## Non-goals for v1

- Hosting / multi-user / persistence of jobs across a server restart.
- A PoB-faithful tree render (sprites, DDS atlases, orbit rotation) — the canvas is stylised
  shapes only (`06`), and that is what ships today. `10-repoe-asset-source.md` proposes adding real
  node icons from RePoE-fork (fetched PNGs + `drawImage`, not a DDS/atlas pipeline), but that work
  is not started.
- Editing gear, gems, or anything outside the passive tree (permanent project scope).
- Deferred beam-search items (pruning layers, `--target-level`, from-scratch mode) stay below
  this track — pick them up only on demand.
