# Web UI + bridge service — plan index

The tree optimiser (`src/core/optimiseTree.ts` + `recommendTree.ts`) is feature-complete and its
CLI surface has settled. The next track puts a **local web UI** over the same `src/core/`
functions, and pulls the long-deferred **bridge → standalone package** work along with it: a
browser cannot shell out to LuaJIT, so the bridge has to move behind a long-lived service
boundary. The two land together.

This directory is the plan, split by domain so each piece can be picked up on its own:

| File | Domain | Phase |
|------|--------|-------|
| [`01-bridge-service.md`](01-bridge-service.md) | Lift `pob-runtime/` + `src/core/bridge.ts` into a package with a process pool; §"Phase 1.5" = parallel candidate eval within a run | 1 (+1.5) |
| [`02-core-progress.md`](02-core-progress.md) | The two v1 changes to `src/core/*`: `onProgress` + `shouldContinue` | 1 |
| [`03-shared-contract.md`](03-shared-contract.md) | Zod schemas + inferred types shared by API and UI | 2 |
| [`04-api-server.md`](04-api-server.md) | Hono + Zod HTTP server: builds, jobs, SSE progress | 2 |
| [`05-frontend.md`](05-frontend.md) | Vite + React SPA: input → config → run → diff | 3 |
| [`06-tree-canvas.md`](06-tree-canvas.md) | Optional follow-up: render the passive tree with the diff highlighted | 4 |
| [`07-performance.md`](07-performance.md) | Why PoB stays the fitness oracle + the full speed-lever table | cross-cutting |

**On speed:** v1 runs a job as slowly as the CLI does — the pool (phase 1) only overlaps
*concurrent* jobs, which a single user rarely has. The wall-time win is **phase 1.5** (lever 1b in
`07`): parallelise one run's candidate batch across the pool. v1 ships against the serial path;
1.5 is the first fast-follow. Don't let the pool's existence imply v1 runs are fast.

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

## Repo layout after the track

Move to npm workspaces (the repo is a single package today). Nothing about the CLIs changes for
the user — the `npm run` scripts still work from the root.

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

`src/core/bridge.ts` becomes a re-export shim (`export * from "@poe2/pob-bridge"`) for one
release so nothing downstream breaks in a single commit, then callers switch to the package
import and the shim is deleted.

## Sequencing

- [ ] **Phase 1 — bridge service** (`01`, `02`)
  - [ ] npm workspaces + `tsconfig.base.json`; decide project-references vs ordered build; root
        `test` script runs `vitest` across *all* packages; root run-scripts still green
  - [ ] move `pob-runtime/` + `src/core/bridge.ts` into `packages/pob-bridge`, submodule path
        updated, `src/core` imports the package, all 88 tests green
  - [ ] `PobBridgePool` — size 2 default, `acquire`/`release`, crash-replace, `dispose`, `warm()`
  - [ ] `onProgress` + `shouldContinue` in `OptimiseTreeOptions`, wired at the beam depths +
        k-sweep; CLIs pass neither; `shouldContinue`-false → `stoppedBecause: "cancelled"`
- [ ] **Phase 2 — API** (`03`, `04`)
  - [ ] `packages/contract` — request/response/event Zod schemas
  - [ ] `packages/api` — Hono server, build decode/encode, job registry, SSE
  - [ ] Cancel wired through `shouldContinue` (frees the bridge within one add-step)
  - [ ] updated-PoB-code output (read allocated ids off the bridge, patch `<Spec nodes>`, re-encode)
- [ ] **Phase 3 — UI** (`05`)
  - [ ] Vite + React scaffold, dev proxy to the API
  - [ ] input → summary → run-config form → progress panel → results diff → copy updated code
- [ ] **Phase 1.5 — parallel candidate eval** (`01` §"Phase 1.5", `07` lever 1b) — first
      fast-follow after v1. Pool-backed evaluator in `beamAddLoop`, id-sorted recollection,
      determinism unchanged. This is what makes a single run fast.
- [ ] **Phase 4 — tree canvas** (`06`) — only on demand. Stylised (shapes, no sprites); port the
      MIT renderer from `poe2-tools/poe2-build-planner` onto our `tree.json`.

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
- The tree canvas (`06` is deferred).
- Editing gear, gems, or anything outside the passive tree (permanent project scope).
- Deferred beam-search items (pruning layers, `--target-level`, from-scratch mode) stay below
  this track — pick them up only on demand.
