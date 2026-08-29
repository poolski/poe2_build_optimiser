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

## Phase 1.5 — parallel candidate evaluation within a run

**BUILT** (2026-08-29, branch `phase1.5-parallel-eval`, not yet merged to `main`; not yet wired
into `packages/api`'s job runner — see "Not yet wired" below). Scoped here because it is what
actually cuts a single run's wall time (`07` lever 1b), and because it constrained the pool API
above (`PobBridgePool.lease`).

### What shipped, vs. what this doc originally sketched

The original sketch above assumed `optimiseTree` / `recommendTree` would need to take "an
evaluator that owns a pool" — a `src/core` change, on top of the two `onProgress`/`shouldContinue`
changes from `02`. **That turned out to be unnecessary.** `src/core/evaluator.ts`'s `MemoEvaluator`
already funnels every candidate-batch RPC through one call: `bridge.call("evaluate_candidate_nodes_from",
{ allocSet, nodeIds, removeIds })`. If `bridge` is something that implements the same
`PobBridgeClient` shape (`call<T>(method, params)`) but internally fans a `nodeIds` batch across
several LuaJIT children before resolving, sharding happens completely underneath `MemoEvaluator`
and `optimiseTree` — **neither file changed**. This also matches the repo's own architecture rule
(`CLAUDE.md`: "`src/core` receives a bridge and never constructs one") more literally than the
original sketch did: a `ParallelBridge` is still just a bridge from `src/core`'s point of view.

### `PobBridgePool.lease(n)` (new, `pool.ts`)

```ts
lease(n: number): Promise<BridgeLeaseHandle>;   // BridgeLeaseHandle = { slots: PooledBridge[]; release(): void }
```

Acquires `n` slots one at a time (reusing `acquire()`'s existing FIFO queue), so a lease can take a
moment to fully assemble under contention. Throws synchronously if `n` exceeds the pool size —
acquiring more slots than the pool has would otherwise queue forever. If any acquire in the
sequence fails (e.g. `dispose()` mid-lease), every slot already acquired is released before
rejecting, so a failed lease never strands busy slots. `acquire()`/`release()` (single-slot) are
completely unchanged — `packages/api` keeps working against them without modification.

### `ParallelBridge` (new, `packages/pob-bridge/src/parallel.ts`)

Implements `PobBridgeClient` over an array of leased `PooledBridge`s (`slots[0]` is the
conventional "primary"). Per-method routing, verified against `bridge.lua`'s actual handlers
(not just inferred from names):

| Methods | Routing | Why |
|---|---|---|
| `evaluate_candidate_nodes_from`, `evaluate_candidate_nodes` | **SHARDED** — `nodeIds` split into up to `slots.length` contiguous chunks, one `call` per non-empty chunk, dispatched concurrently | Each is fully self-contained per call in `bridge.lua`: the handler wraps the whole batch in its own `CreateUndoState`/`RestoreUndoState` and ends by resyncing `mainOutput` (`evaluateCandidatesAgainst`), reading only the ids/`allocSet`/`removeIds` passed in that one request. Nothing carries over between calls, and each leased slot is a separate OS process, so concurrent calls on different slots can't race. |
| `load_build_xml`, `reset_metrics` | **BROADCAST** — awaited on every slot | The whole point of a lease is "every slot has the same build loaded"; these are the only methods where that needs an explicit fan-out instead of routing to one slot. |
| `get_metrics` | **AGGREGATED** — summed across every slot | `buildOutputCount` / `buildOutputSeconds` are per-child module-local counters in `bridge.lua` (`local buildOutputCount = 0` at file scope) — each slot only knows about the recomputes *it* ran. |
| everything else (`get_stats`, `get_tree_status`, `list_allocatable_nodes_from`, `get_stats_from`, `list_allocated_nodes`, `evaluate_dealloc_candidates`, …) | **ROUTED to `slots[0]`** | Each is a single round trip that reads or mutate-then-restores the *whole* spec as one value, or already covers its entire input in one pass (`list_allocatable_nodes_from` enumerates the whole reachable set) — no per-item axis to shard, and correctness needs a stable spec baseline throughout the call, which only one consistently-used slot provides. |

Determinism: shard results are recombined by **chunk index**, never by arrival order —
`Promise.all` resolves its array in input order regardless of which shard settles first, so the
merged result is byte-identical to a single-slot call for the same inputs, independent of N.
Proven by `packages/pob-bridge/src/parallel.test.ts` (fake slots, no LuaJIT): one case deliberately
makes the *first* chunk's slot resolve *last* and asserts the merged order is still correct.

Failure handling: a shard's `call()` rejecting (its child died — `PobBridge` rejects every pending
call on unexpected exit with `"bridge process exited (code N) before responding"`) propagates
through `Promise.all` and fails the whole `ParallelBridge.call()` — no shard's candidates are ever
silently dropped, and `packages/api/src/jobs/mappers.ts`'s existing `bridge-crash` classification
(`/bridge process (exited|error)|before responding/i`) still matches unchanged.

Memo cache: still a single `Map` inside one `MemoEvaluator` instance, keyed exactly as before —
sharding is invisible to it, so nothing about the cache changed.

### CLI wiring

`optimise-tree --parallelism <n>` (`src/optimiseCli.ts`): `n > 1` constructs a
`PobBridgePool({ size: n })`, leases all `n` slots, wraps them in a `ParallelBridge`, and passes
that as the `bridge` argument to `optimiseTree` — otherwise identical to the plain
`new PobBridge()` path. `n <= 8` is documented as the sane ceiling (§"Pool size" above); `POOL_SIZE`
still overrides the pool's own default elsewhere.

### Not yet wired

`packages/api`'s job runner (`packages/api/src/jobs/runner.ts`) still calls `deps.source.acquire()`
for a single-slot `BridgeLease` and passes that straight to `optimiseTree`/`recommendTree` —
**unchanged**. Wiring the web UI's benefit requires: (1) a per-run parallelism knob surfaced
through the API (request option or server config), (2) `BridgeSource` growing an
`acquireParallel(n)` alongside `acquire()`, backed by `pool.lease(n)` + `ParallelBridge`, and (3) a
decision on how a leased-N job interacts with `MAX_ACTIVE_JOBS <= POOL_SIZE` (a size-N lease
consumes N of the pool's slots, so either jobs needing parallelism get a smaller pool slice each,
or `POOL_SIZE` needs to grow when the web UI wants both queued concurrent jobs and a wide lease per
job). Left undecided — a design question for whoever wires this up next, not a code gap.

### Tests

- `packages/pob-bridge/src/parallel.test.ts` — fast, fake slots: byte-identical sharded-vs-single
  results, order-independent-of-completion-order, `get_metrics` summation, a dying shard fails the
  whole call, broadcast reaches every slot, primary-only routing, no sharding below 2 candidates.
- `packages/pob-bridge/src/pool.integration.test.ts` — 3 new cases (real LuaJIT, not run by the
  agent that wrote them): `lease(n)` hands out `n` distinct slots all loadable with the same build,
  `lease(n)` with `n` over the pool size throws synchronously with nothing acquired, and a lease
  that fails partway releases what it already had.
- `src/core/optimiseTree.parallel.integration.test.ts` — the phase-1.5 acceptance gate: runs the
  same `optimiseTree(bridge, options)` once against a plain `PobBridge` and once against a
  `ParallelBridge` over a 3-slot lease (self-contained minimal build, `includeAllNodeTypes: true`
  so there are enough candidates near the frontier to actually exercise sharding), and asserts the
  results are equal except `buildOutputSeconds` (real per-child timing legitimately differs) —
  `buildOutputCount` must still match exactly, and is checked against the explicit sum of each
  slot's own `get_metrics`. Not run by the agent that wrote it — see the phase-1.5 session report
  for the exact `npm run test:integration -- optimiseTree.parallel` invocation.

Expected effect (unmeasured — no real LuaJIT run performed while writing this): strong-build
`repair-r6` from ~15–37 min to ~3–6 min at pool size 8, per the original cost-model estimate in
`07`.

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
