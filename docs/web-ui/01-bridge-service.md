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

### `buildOutputCount` is NOT byte-identical between the serial and parallel path — and that's correct

This was a defect in the first pass of this doc and of the acceptance-gate test, caught and fixed
2026-08-29. The mechanism: the tail of `evaluateCandidatesAgainst` in `bridge.lua` —

```lua
if outerUndo then
    spec:RestoreUndoState(outerUndo)
    spec:BuildAllDependsAndPaths()
    -- ...recompute once here to resync mainOutput with the reverted tree.
    recomputeBuild()
end
```

— runs **one extra `recomputeBuild()` per `evaluate_candidate_nodes[_from]` CALL**, whenever that
call's `allocSet`/`removeIds` is non-empty (every add-step from depth 1 onward, since depth 0's
`allocSet` is the empty initial `BeamState`). Sharding turns one such call into up to N, so it
turns one tail recompute into up to N. **This never touches a candidate's own measured stats** —
those come from the per-candidate `AllocNode` + `recomputeBuild()` inside the loop, *before* the
tail runs — so the plan stays byte-identical; only the recompute *count* grows. Confirmed live on
the self-contained fixture in `optimiseTree.parallel.integration.test.ts` (extend mode,
`pointBudget: 8`, `includeAllNodeTypes: true`, `proximity: 4`, `PARALLELISM = 3`): serial
`buildOutputCount` **139**, parallel **145**, excess **6** = `(N-1) × (steps.length-1)` =
`(3-1) × (4-1)` exactly. Every other field in the result (the full plan, `final.objective`, every
step, `allocatedNodeIds`, …) was byte-identical between the two runs — only `buildOutputCount`
differed, and by exactly the predicted amount.

The acceptance-gate test derives that formula from the actual result rather than hardcoding "6",
and separately re-confirms `buildOutputCount` equals the explicit sum of each slot's own
`get_metrics` (the aggregation claim, independent of the overhead accounting).

**`buildOutputSeconds` has a related but distinct caveat**, documented at the aggregation site in
`parallel.ts`: summed across N slots that ran *concurrently*, it is total **CPU-seconds** across
those children, not elapsed wall/simulation time — unlike the serial (N=1) case, where it's a
genuine per-recompute wall-time figure. A caller that reuses it the way the bench harness's
`sim s` / `ms/BO` columns do (as an elapsed-time proxy) will see a number that grows with N even
though the run got faster. Not directly wired into the bench harness by this work — flagged here
so a future change to the harness (or anything else reading `buildOutputSeconds` off a parallel
run) knows to treat it as a cost figure, not a timing one, once N > 1.

### `packages/api` job runner — wired

`BridgeSource` (`packages/api/src/builds/store.ts`) gained `acquireParallel(n): Promise<BridgeLease>`,
implemented by `PobBridgePool.acquireParallel(n)` (`lease(n)` + `ParallelBridge`, wrapped back into
a single `{call, release}` handle). `JobState` carries a `parallelism` field decided once at
`create()` — `1` for "recommend" jobs always (their bridge calls aren't the sharded `_from` batch
form a beam loop step uses), `jobParallelism` (a registry-wide setting, default 1) for "optimise"
jobs. The job runner (`packages/api/src/jobs/runner.ts`) picks `acquireParallel(job.parallelism)`
when `> 1`, else the plain `acquire()` path (kept untouched for the common `parallelism === 1`
case).

**Admission is now slot-based, not job-count-based** — `JobRegistry`'s `pump()` (`registry.ts`)
admits the head of the FIFO queue only when `(slots committed by every running job) +
job.parallelism <= poolSize`, in addition to the pre-existing `maxActiveJobs` ceiling on running
job *count* (kept as an independent, additional cap). This is a deliberate fix, not an
enhancement: with every job leasing exactly 1 slot (pre-phase-1.5), job-count admission and
slot-based admission were the same rule, and the header comment on `registry.ts` used to state the
invariant this depended on — *"a running job never waits inside `pool.acquire()`"*. Once a job can
lease `N > 1` slots, that stopped being true under job-count admission alone: two jobs each
admitted because job-count allowed it, each leasing more slots than were actually free between
them, can genuinely block inside `PobBridgePool.lease()` waiting on slots the other is holding —
the shape of a deadlock. Slot-based admission restores the invariant by construction: a job is
never admitted unless its full slot requirement is free, so `lease()`/`acquireParallel()` never
has to wait once called by an admitted job. See `registry.ts`'s file header for the full
description, including why admission is strict FIFO (the head of the queue, not the first job
that happens to fit, to avoid a large job starving behind an endless stream of small ones) and why
`PobBridgePool.lease()` was *also* hardened to be atomically all-or-nothing internally (defence in
depth for any caller that isn't going through this admission control).

`POOL_SIZE` and `JOB_PARALLELISM` both default to **half the host's `availableParallelism()`** (floor 1; 16 cores → 8), so one optimise job fans across the whole warm pool out of the box. `JOB_PARALLELISM` (env, formerly default **1** — i.e. off, byte-identical to
pre-phase-1.5 behaviour) is the new conservative knob; raising it trades pool headroom for
wall-clock, since each additional slot committed per job is another ~700 MB-resident LuaJIT child.
`GET /api/health` now echoes `jobParallelism` for visibility. **Deliberately not exposed as a
per-request field on `OptimiseRequest`** in this pass — kept server-config-only to avoid widening
`packages/contract`'s surface (Zod schema, DTO, mapper, wizard form) for a knob a single local
operator can already set via env; a per-request override is a reasonable future addition if the
need for per-job control (rather than a fleet-wide default) actually shows up.

### Tests

- `packages/pob-bridge/src/parallel.test.ts` — fast, fake slots: byte-identical sharded-vs-single
  results, order-independent-of-completion-order, `get_metrics` summation, a dying shard fails the
  whole call, broadcast reaches every slot, primary-only routing, no sharding below 2 candidates.
- `packages/pob-bridge/src/pool.integration.test.ts` — real LuaJIT, not run by the agent that wrote
  them: `lease(n)` hands out `n` distinct slots all loadable with the same build; `lease(n)` over
  the pool size throws immediately with nothing acquired; a `lease()` waiting for slots to free up
  holds **none** of them meanwhile (the all-or-nothing proof — asserts `pool.stats().busy` does NOT
  rise while a lease waits); two concurrent `lease(2)` calls against a 3-slot pool do not deadlock;
  `lease()` rejects cleanly if the pool disposes while it's waiting; `acquireParallel(n)` returns a
  single handle whose calls reach `n` slots with the same build loaded on each.
- `src/core/optimiseTree.parallel.integration.test.ts` — the phase-1.5 acceptance gate: runs the
  same `optimiseTree(bridge, options)` once against a plain `PobBridge` and once against a
  `ParallelBridge` over a 3-slot lease (self-contained minimal build, `includeAllNodeTypes: true`
  so there are enough candidates near the frontier to actually exercise sharding). Asserts the
  plan is byte-identical (every field except `buildOutputSeconds`/`buildOutputCount`), then checks
  `buildOutputCount` against the derived tail-recompute-overhead formula above (not a hardcoded
  number) and against the explicit sum of each slot's own `get_metrics`. **Run once, live, while
  fixing the counter defect** — see "buildOutputCount is NOT byte-identical" above for the actual
  numbers observed.
- `packages/api/src/jobs/registry.test.ts` (fast, fake bridges — no real LuaJIT needed since these
  only exercise the registry's own bookkeeping via a gated stub core): two optimise jobs whose
  combined `jobParallelism` exceeds `poolSize` serialise rather than both running; a 1-slot
  "recommend" job and a 3-slot "optimise" job on a 4-slot pool run concurrently; a `jobParallelism`
  exceeding `poolSize` is rejected at `JobRegistry` construction, never queued.

Expected effect (still unmeasured on a real strong build — the live run above was on a
self-contained fixture, only to confirm the recompute-count mechanism, not to benchmark wall
time): strong-build `repair-r6` from ~15–37 min to ~3–6 min at pool size 8, per the original
cost-model estimate in `07`.

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
