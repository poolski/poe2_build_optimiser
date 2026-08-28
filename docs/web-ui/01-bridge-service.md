# Phase 1 — bridge service extraction

**Goal:** move the LuaJIT bridge behind a package with a long-lived process **pool**, so a
non-CLI consumer (the API server) can run many optimise jobs without spawning a fresh `luajit.exe`
per request. This is the bridge → shared-package work that was deferred for lack of a second
consumer; the web UI is that consumer.

Depends on nothing. Blocks phase 2.

## What exists today

- `pob-runtime/bridge.lua` — the JSON-RPC server (stdin/stdout, newline-delimited). ~25 methods
  (`ping`, `load_build_xml`, `get_stats`, `get_tree_status`, `list_allocatable_nodes[_from]`,
  `evaluate_candidate_nodes[_from]`, `get_stats_from`, `list_allocated_nodes`,
  `evaluate_dealloc_candidates`, `get_metrics`, `reset_metrics`, …). **Unchanged by this phase.**
- `pob-runtime/PathOfBuilding-PoE2/` — git submodule, the vendored calc engine.
- `src/core/bridge.ts` — `PobBridge` class: spawns one `luajit.exe bridge.lua`, keeps it warm,
  correlates requests by integer id, `dispose()` kills it. Plus the `PobBridgeClient` interface
  (`call<T>(method, params)`) that every `src/core` module and every test depends on.
- `spike/benchTreeApproaches.ts:277` — `runWithConcurrency(items, limit, worker, onDone)`, a
  fixed-size worker pool that already runs N builds in parallel over N bridges. The reference
  implementation for the pool.

## Target package: `packages/pob-bridge`

```
packages/pob-bridge/
  package.json            # name "@poe2/pob-bridge", main dist/index.js
  tsconfig.json           # extends ../../tsconfig.base.json
  src/
    index.ts              # re-exports PobBridge, PobBridgePool, PobBridgeClient, types
    bridge.ts             # moved verbatim from src/core/bridge.ts
    pool.ts               # new — PobBridgePool
    pool.test.ts          # new
  pob-runtime/            # moved from repo root
    bridge.lua
    PathOfBuilding-PoE2/  # submodule — .gitmodules path updated
```

### Moves

1. `git mv pob-runtime packages/pob-bridge/pob-runtime`; update `.gitmodules` `path =
   packages/pob-bridge/pob-runtime/PathOfBuilding-PoE2` and `git submodule sync`.
2. `git mv src/core/bridge.ts packages/pob-bridge/src/bridge.ts`. Fix the two path constants:
   - `REPO_ROOT` → `PACKAGE_ROOT = path.resolve(__dirname, "..")` (dist is one level down).
   - `POB_SRC_DIR` / `BRIDGE_LUA` resolve under `PACKAGE_ROOT/pob-runtime` now.
   - `LUAJIT_EXE` / `POB_LUAJIT_PATH` env override unchanged.
3. `src/core/bridge.ts` becomes `export * from "@poe2/pob-bridge";` for one commit, then callers
   (`src/core/*.ts`, `src/*Cli.ts`, `spike/*.ts`, tests) switch their import to the package and
   the shim is deleted.
4. Root `package.json`: `"workspaces": ["packages/*"]`, add `"@poe2/pob-bridge": "*"` to deps.
   Root `npm run` scripts (`recommend-tree`, `optimise-tree`, `bench-*`, `test`) unchanged.
5. `tsconfig.json` → `tsconfig.base.json` (compiler options only); each package's `tsconfig.json`
   extends it with its own `rootDir`/`outDir`/`include`. Root keeps a `tsconfig.json` for `src/`.

### Exit check for the moves

`npm test` — all 88 tests green with zero source changes beyond imports. `npm run optimise-tree
<a build.xml> --respec-budget 4` produces byte-identical output to `main`.

## `PobBridgePool`

A fixed-size pool of warm `PobBridge` instances. The API server holds exactly one pool for its
lifetime.

```ts
export interface PobBridgePoolOptions {
  size?: number;              // default: 2 (see "Pool size" below) — NOT the bench's cpus-2
  luajitPath?: string;        // overrides POB_LUAJIT_PATH for this pool
  onChildError?: (slot: number, err: Error) => void;
}

export class PobBridgePool {
  constructor(opts?: PobBridgePoolOptions);
  /** Resolve with an exclusive bridge. Rejects if the pool is disposed. FIFO queue when all
   *  slots are busy — no timeout (jobs are minutes; the API layer owns any deadline). */
  acquire(): Promise<PooledBridge>;
  /** Current counts, for /api/health. */
  stats(): { size: number; busy: number; queued: number };
  /** Kill every child; reject all queued acquire()s. Idempotent. */
  dispose(): Promise<void>;
}

export interface PooledBridge extends PobBridgeClient {
  /** Return the bridge to the pool. MUST be called (try/finally). After release the handle
   *  throws on further use. */
  release(): void;
}
```

### Design notes

- **One child per slot, spawned lazily on first `acquire` for that slot**, then kept warm. A
  cold start is PoB's full boot (seconds); amortised across a session it's free.
- **No per-job reload isolation in the pool.** The caller (the API job runner) does
  `load_build_xml` on the acquired bridge, runs its job, then `release()`. It does **not** need
  to "clean up" the spec: every `*_from` RPC `optimiseTree` uses restores the spec to the loaded
  baseline, and the next job calls `load_build_xml` again which replaces the build wholesale.
  Document this contract on `acquire()`.
- **`reset_metrics` is the caller's job**, same as the CLI (`optimiseCli.ts:272`). The job
  runner calls it right after `load_build_xml`.
- **Crash handling.** `PobBridge` already rejects all `pending` on child `exit`. The pool adds:
  on a slot's child exiting unexpectedly, mark the slot dead, fire `onChildError`, and re-spawn
  it on the next `acquire`. An `acquire()` already holding that slot's handle sees its in-flight
  `call()` reject — the job runner turns that into a failed job (`04-api-server.md`), it does not
  crash the server.
- **Backpressure.** `acquire()` queues FIFO when `busy === size`. The API layer caps how many
  jobs it starts (`04`), so the queue stays short, but the pool must not reject on "busy".
- **Determinism.** In v1 the pool changes nothing about a single job's execution — one job runs
  on one bridge, single-threaded, in the same RPC order; parallelism is only *across* jobs. Phase
  1.5 parallelises *within* a job but keeps the result identical by recollecting each candidate
  batch id-sorted before the frontier pick (same technique the bench uses across builds).

### Tests (`pool.test.ts`)

Use the real LuaJIT bridge (the existing tests already do; there is no fake for a full run).

- `size: 1` — two concurrent `acquire()`s serialise; the second resolves only after the first
  `release()`.
- `stats()` reflects busy/queued through an acquire/release cycle.
- A job that runs `load_build_xml` + `get_stats` on a pooled bridge returns the same `StatSet`
  as a standalone `PobBridge`.
- `dispose()` kills children and makes a pending `acquire()` reject.
- Kill a slot's child mid-session (`process.kill` via a test hook or a bridge method that
  `os.exit`s) → next `acquire()` gets a working bridge, `onChildError` fired once.

### Pool size

Default **2**, not `cpus - 2`. This is a single-user tool: the common case is one job running
while the user watches it. A big pool would leave 6+ idle `luajit.exe` children (≈ one PoB
runtime of RAM each) for a concurrency level that almost never happens. Size 2 covers "a second
job queued behind the first" and a `pool.warm()` prespawn. `POOL_SIZE` stays env-configurable for
anyone who wants more. A large pool only earns its keep once **phase 1.5** (below) uses it to
parallelise *one* run.

## Phase 1.5 — parallel candidate evaluation within a run (post-v1)

Not in v1. Scoped here because it is what actually cuts a single run's wall time (`07` lever 1b),
and because it constrains the pool API above.

Today `beamAddLoop` evaluates a step's `P` surviving candidates serially through one
`MemoEvaluator` on one bridge. Phase 1.5 fans that batch across the pool:

- `optimiseTree` / `recommendTree` take an **evaluator that owns a pool**, not a single bridge —
  e.g. `createParallelEvaluator(pool)` implementing the same `evaluate(allocSet, nodeIds)` shape
  the memo already exposes, dispatching each candidate to a free slot and awaiting the batch.
- **Determinism is preserved the same way the bench is:** collect all `P` results, then sort by
  node id before the frontier pick. N does not affect the outcome, only the wall time.
- The memo cache becomes pool-wide (keyed as now; just shared).
- This is a real `packages/pob-bridge` + `src/core` change — it makes `02`'s "core changes" list
  three items, not two. Keep it out of v1 so the UI ships against the known-good serial path.

Expected effect: strong-build `repair-r6` from ~15–37 min to ~3–6 min at pool size 8.

## Open questions

- **Submodule under a nested path** — confirm `git submodule sync` + a fresh
  `git submodule update --init` works from a clean clone after the move. Do this before touching
  anything else in the phase.
- **Workspace build + test ordering.** Four interdependent packages (`pob-bridge` ← `src/core` ←
  `api` → `contract` ← `web`). Decide up front: TS **project references** (`composite: true`,
  `tsc -b` from the root) vs. a plain ordered `npm run -ws build`. `npm test` must run `vitest`
  across every package's tests, not just `src/` — wire that into the root `test` script as part of
  the workspaces move, and the "88 tests green" exit check verifies it.
- **Warm-all-on-boot vs lazy.** Lazy is simpler and the first few jobs eat the cold starts.
  Offer `pool.warm()` (spawns all slots up front) for the API to call on boot if the first-job
  latency annoys.
