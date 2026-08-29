<!-- generated-by: groundrules v1.10.0 -->
# Architecture

High-level system design, layers, and component interactions.

## Overall shape

```
┌─────────────────────────────────────────────────────────┐
│  User-facing Interfaces                                 │
│  ├─ recommend-tree (CLI)                                │
│  ├─ optimise-tree (CLI)                                 │
│  └─ web UI (Vite + React) [Phase 3 shipped]             │
└─────────────┬───────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│  API / Core Routing                                      │
│  ├─ packages/api (Hono server, phases 2+)               │
│  └─ src/core (pure optimization logic)                  │
└─────────────┬───────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│  PoB Bridge (Headless LuaJIT)                           │
│  ├─ packages/pob-bridge (pool, parallelism)             │
│  ├─ pob-runtime/ submodule (PoB calc engine)            │
│  └─ bridge.lua (instrumentation)                        │
└─────────────────────────────────────────────────────────┘
```

## Layers

### 1. Core engine (`src/core/`)

Pure business logic for tree optimization. Knows nothing about LuaJIT, servers, or UI.

**Key modules:**
- `optimiseTree.ts` — the main optimiser: extend/repair/rollback modes, beam search, constraints
- `recommendTree.ts` — single-node recommender, fast read-only pass
- `objective.ts` — flexible objective scoring (blend, composite, custom)
- `bridge.ts` — abstract bridge interface (all bridge calls go through here)

**Invariant:** Core receives a bridge and never constructs one. Bridge injection happens at the edges.

### 2. Bridge to PoB (`packages/pob-bridge/`)

A long-lived pool of LuaJIT child processes that evaluate trees.

**Key modules:**
- `pool.ts` — `PobBridgePool`: size, FIFO queue, crash-respawn, warm-up
- `parallel.ts` — `ParallelBridge`: shards candidate evaluation across pool slots, aggregates results
- `bridge.ts` (legacy) — single-process bridge, now rarely used

**Design:**
- Pool size defaults to half the host's cores (floor 1)
- `ParallelBridge` is a drop-in `PobBridgeClient` — `src/core` doesn't know it exists
- Each slot (LuaJIT process) holds ~700 MB resident

### 3. API Server (`packages/api/`)

Request routing, build management, job orchestration.

**Key modules:**
- `server.ts` — Hono server on `127.0.0.1:8787`
- `core.ts` — bridges the gap between `packages/api` and `src/core/`
- `registry.ts` — in-memory job registry (FIFO, `MAX_ACTIVE_JOBS <= POOL_SIZE`)

**Features:**
- Build ingest (PoB code paste + XML upload)
- Job admission (slot-based, not job-count-based)
- SSE relay for progress events
- Cancel through `shouldContinue` signal

### 4. Frontend (`packages/web/`)

Vite + React SPA for interactive optimization.

**Key modules:**
- `components/Wizard.tsx` — 4-step input flow
- `components/Results.tsx` — node-list diff + tree canvas
- `canvas/` — stylised tree diff renderer (ported from `poe2-tools/poe2-build-planner`)

## Data flow: an optimize run

1. **User input** → API (`POST /api/builds`, `POST /api/jobs`)
2. **API creates a job** → registry decides if pool has slots
3. **Job runner acquires slots** → `BridgeSource.acquireParallel(n)` or `.acquire()`
4. **Core.optimiseTree()** runs, calling `bridge.evaluate_candidate_nodes(...)` for each candidate batch
5. **ParallelBridge shards** the batch across `n` slots (or serial single slot if `n=1`)
6. **Each LuaJIT slot** computes stats for its chunk via `bridge.lua`
7. **Results recombine** → byte-identical to single-slot path (order-independent)
8. **Core finishes**, emits `OptimiseTreeResult` with before/after allocations
9. **API relays progress** via SSE to frontend
10. **Frontend renders** node-list diff and/or tree canvas

## Key design decisions

Full rationale for each is in `docs/decisions/`.

| Decision | Why | Consequence | ADR |
|----------|-----|-------------|-----|
| **PoB stays the oracle** | Accurate damage math; standard in the community | ~280ms per recompute; mitigated by parallelism + objective scoping | 001 |
| **No build step** | Keep iteration fast; catch errors at TS check time | Source-level aliases (`tsconfig` paths + vitest aliases) instead | 006 |
| **Core is agnostic** | Reuse across CLI + web + future interfaces | Bridge injection; no server/UI code in core | 005 |
| **Pool over queue** | Parallelism within a run, not just across runs | Needs slot-based (not job-count-based) admission | 011 |
| **Parallel is transparent** | No core changes needed | Bridge client interface abstract enough that `ParallelBridge` works | 011 |

## See also

- **`docs/decisions/`** — ADR-0001 … ADR-0012, the decisions of record
- **`intake/web-ui/`** — phase-by-phase development specs (01–10)
- **`docs/gotchas.md`** — PoB-PoE2 quirks to watch
- **`CLAUDE.md`** — test strategy, dependencies, layout

---

**Last updated**: 2026-08-29 (post-phase-1.5)
