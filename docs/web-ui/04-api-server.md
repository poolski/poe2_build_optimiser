# Phase 2 — API server (`packages/api`)

A thin Hono server that turns HTTP requests into `optimiseTree` / `recommendTree` calls on a
`PobBridgePool`, with an in-memory job registry and an SSE progress stream. Local-first,
single-user, binds `127.0.0.1`.

Depends on phases 1 (`PobBridgePool`, `onProgress`) and 2's contract package.

```
packages/api/
  package.json        # deps: hono, @hono/node-server, zod, @poe2/contract, @poe2/pob-bridge; the repo root for src/core
  src/
    server.ts         # Hono app + node-server bootstrap, 127.0.0.1:<port>
    routes/
      builds.ts
      jobs.ts
      health.ts
    jobs/
      registry.ts     # Map<jobId, JobState> + EventEmitter, lifecycle
      runner.ts       # acquire bridge → load → run core → release; emits progress
    pob/
      code.ts         # decode/encode PoB export codes
      applyPlan.ts    # apply the node diff to <Spec nodes> for updatedPobCode
    config.ts         # PORT, POB_LUAJIT_PATH, POOL_SIZE, MAX_ACTIVE_JOBS
```

## Endpoints

All under `/api`. Bodies validated with the `@poe2/contract` schemas; a Zod failure → `400` with
`{ kind: "bad-request", message }`.

| Method | Path | Body / params | Returns |
|--------|------|---------------|---------|
| `POST` | `/builds` | `BuildInput` (`pobCode` or `xml`) | `BuildSummary` |
| `GET` | `/builds/:id` | — | `BuildSummary` |
| `POST` | `/jobs` | `OptimiseRequest` \| `RecommendRequest` (discriminated by a `kind` field) | `JobRef` (`{ jobId, status: "queued" }`) |
| `GET` | `/jobs/:id` | — | `JobRef` + `result?: OptimiseResultDTO \| RecommendedNodeDTO[]` + `error?: JobError` |
| `GET` | `/jobs/:id/events` | — | **SSE stream** (see below) |
| `POST` | `/jobs/:id/cancel` | — | `JobRef` (`status: "cancelled"` if it was still running) |
| `GET` | `/health` | — | `{ ok, contractVersion, pool: { size, busy, queued }, jobs: { active, total } }` |

In production the same server also `serveStatic`s the built SPA from `packages/web/dist` at `/`.
In dev the SPA runs under Vite and proxies `/api` here (`05`).

## Build ingestion (`pob/code.ts`)

Decode is exactly `spike/fetchNinjaBuilds.ts:76`:

```ts
export function decodePobCode(code: string): string {
  const b64 = code.trim().replace(/-/g, "+").replace(/_/g, "/");
  return zlib.inflateSync(Buffer.from(b64, "base64")).toString("utf-8");
}
export function encodePobCode(xml: string): string {
  return zlib.deflateSync(Buffer.from(xml, "utf-8"))
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}
```

`POST /builds` → get the XML (decode the code, or take `xml` straight), `PobBridgePool.acquire()`,
`load_build_xml`, `reset_metrics`, `get_stats` + `get_tree_status`, `release()`. Store
`{ buildId, xml, summary }` in a `Map`. `notes` is assembled here: 0-DPS (`TotalDPS` absent or
0), over-allocation (`pointsUsed > pointsMax`, the `--point-budget` case from
`docs/status.md`), missing active weapon set.

Builds are kept in memory, no expiry for v1 (single user, restart clears them). A stored build is
independent of any job — one build, many jobs.

## Job model (`jobs/registry.ts`)

```ts
type JobState = {
  jobId: string;
  kind: "optimise" | "recommend";
  buildId: string;
  request: OptimiseRequest | RecommendRequest;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  startedAt?: number;
  emitter: EventEmitter;          // "progress" (ProgressEvent), "settled"
  lastProgress?: ProgressEvent;   // replayed to a late SSE subscriber
  result?: unknown;
  error?: JobError;
  abort: AbortController;         // cancel → runner checks between add-loop depths
};
```

- **Admission.** `MAX_ACTIVE_JOBS` (default = pool size) running at once; extra jobs sit
  `queued`. Since a job holds a bridge for its whole run, `MAX_ACTIVE_JOBS === POOL_SIZE` means
  no job ever waits inside `pool.acquire()`. **Superseded by phase 1.5** (`01` §"Phase 1.5"): once
  a job can lease more than 1 slot (`JOB_PARALLELISM > 1`), job-COUNT admission alone no longer
  guarantees that invariant -- `JobRegistry`'s admission became SLOT-based (committed slots across
  running jobs vs. `POOL_SIZE`), with `MAX_ACTIVE_JOBS` kept as a separate, additional ceiling on
  running job count. `registry.ts`'s file header is the design of record for the current rule.
- **Cancellation.** `abort.abort()` flips `status = "cancelled"`. The runner passes
  `shouldContinue: () => !abort.signal.aborted` into core (`02`), so `optimiseTree` stops after
  the current add-step, returns its partial plan with `stoppedBecause: "cancelled"`, and the
  `finally` releases the bridge. The runner then discards that result (the user cancelled because
  the config was wrong). **This is not "discard-on-completion" — the job stops within one
  add-step (seconds), not one full run (minutes).** That matters here: the pool is size 2, so a
  zombie job would block the user's corrected re-submit. A single `BuildOutput` still can't be
  interrupted, but that's ≤ ~310 ms.
- **Retention.** Finished jobs stay in the map until server restart. Fine for one user.

## Runner (`jobs/runner.ts`)

```
1. status = "running", startedAt = now
2. bridge = await pool.acquire()
3. try:
     await bridge.call("load_build_xml", { xml: builds.get(buildId).xml })
     await bridge.call("reset_metrics")
     const opts = mapRequestToOptions(request)      // OptimiseRequest → OptimiseTreeOptions
     opts.onProgress = ev => {
       const pe = { ...ev, jobId, elapsedMs: now - startedAt };
       state.lastProgress = pe; state.emitter.emit("progress", pe);
     }
     opts.shouldContinue = () => !state.abort.signal.aborted
     const result = await optimiseTree(bridge, opts) // or recommendTree
     state.result = kind === "optimise" ? toResultDTO(result, buildXml) : result
     state.status = "done"
   catch err:
     state.error = classify(err)  // unscoreable-objective | zero-dps-build | bridge-crash | internal
     state.status = "error"
   finally:
     bridge.release()
     state.emitter.emit("settled")
4. if state.status was flipped to "cancelled" meanwhile, drop the result.
```

`mapRequestToOptions` is the one place `mode: "rollback"` collapses to "pass `anchorNodeId`", and
`minResist` expands to three `constraints`. `extraPoints` → `pointBudget = pointsUsed +
extraPoints` needs `get_tree_status` first (same as `optimiseCli.ts:272`).

`toResultDTO` also computes `updatedPobCode` via `pob/applyPlan.ts`.

## `updatedPobCode` (`pob/applyPlan.ts`)

> **RESOLVED 2026-08-29 (`3b7dcf6`).** `list_allocated_nodes` now takes an optional `allocSet`
> alongside `removeIds`, and `optimiseTree` puts `allocatedNodeIds: { before, after }` on
> `OptimiseTreeResult`. `after` is the **connected** post-plan allocation set — every path node
> `AllocNode` dragged in included — id-sorted, same node filter as `list_allocated_nodes`
> (class/ascendancy-start + item-granted nodes excluded). `after === before` when the plan is
> "change nothing". So `updatedPobCode` is a straight string-replace from
> `result.allocatedNodeIds.after`; no extra bridge round-trip, no set arithmetic. Mechanism +
> determinism argument: `docs/status.md`.

The `<Spec>` element's `nodes="12,34,56,…"` attribute is the allocated-node id list. `toResultDTO`
already has the answer on the result:

- Take `result.allocatedNodeIds.after` (already the connected set, ascending), join it with `,`,
  string-replace the `nodes="…"` attribute in the original XML, `encodePobCode`. Nothing to
  recompute or reconcile — `optimiseTree` derived it from the bridge with the plan's `removeIds`
  cascade deallocated and its picks allocated.
- Do **not** rebuild it in TS from `removed`/`addedNodeIds`: that set is picks-only and would
  drop the traversal nodes, emitting a disconnected tree.

Weapon-set nodes: PoB stores those in `<WeaponSet1 nodes>` / `<WeaponSet2 nodes>`. The optimiser
only touches the base spec, so leave those attributes untouched.

## Mapper obligations — non-negotiable (from the contract, `564c15b`)

These are things the contract **cannot** enforce and the result mapper **must** do. Each was found
by validating real optimiser output against the schemas; skipping one produces a runtime
validation rejection, not a type error.

1. **Coerce non-finite → `null`** on `RemovedNodeDTO.objectiveAfterRemoval` and `valueLost`.
   Core assigns `Number.NaN` / `Number.POSITIVE_INFINITY` when a removal makes the build
   unscorable (`optimiseTree.ts:556-557`, `:586`, `:593`), and a `nothing-removable` return
   *ships that entry*. Both fields are `z.number().nullable()` for this reason — "mirror
   field-for-field" as originally written would have rejected valid output.
2. **Strip non-finite keys from every `StatSet`** before validating — both
   `BuildSummary.baseline` *and* `OptimiseResultDTO.final.stats`. `bridge.lua`'s
   `sanitizeForJson` passes `inf`/`nan` through untouched. The original doc flagged this hazard
   for `baseline` only; `final.stats` has exactly the same shape and the same problem.
3. **Build `updatedPobCode` from `allocatedNodeIds.after`** — never rebuild it from `removed` +
   `addedNodeIds`, which are picks-only and would emit a disconnected tree. See `gotchas.md`.
4. **Map a `parseObjective` throw to a `JobError.kind`.** `ObjectiveSpec` is deliberately looser
   than core: it does not range-check the weight (`dps-ehp:5` passes the regex, core throws) and
   it is case-sensitive where core matches `/i`. Do not assume a 400 already caught it.
5. **`extraPoints` has no core equivalent** — compute `pointBudget = pointsUsed + extraPoints`,
   so the optimise handler needs the stored build's `pointsUsed`.
6. **`minResist` is sugar** — expand to Fire/Cold/Lightning `constraints` in the mapper.
7. **`mode` cardinality is intentional:** the request has `extend|repair|rollback`, the result has
   `extend|repair`. `rollback` means "pass `anchorNodeId`"; core has no `mode` option.
8. **Progress naming:** core's `OptimiseProgress` / `RecommendProgress` already call the count
   `buildOutputs`, matching `ProgressEvent`. Only the *bridge's* `get_metrics` says
   `buildOutputCount` — bridge that name only if you read the bridge directly. **The two names
   coexist deliberately: `OptimiseResultDTO.buildOutputCount` (the *result* field) keeps core's
   name, while only the *progress event* normalises to `buildOutputs`. Do not "harmonise" them —
   both are correct and both are commented in the contract.** `jobId` and
   `elapsedMs` are API-added; they are not on the core progress objects.

9. **Populate `BuildSummary.treeVersion` from the XML** (added at integration 2026-08-29).
   `get_tree_status` does not return it, so read `<Spec treeVersion>` directly — the **first**
   `<Spec>`, deliberately the same one `applyPlan` edits, so the version reported describes the
   spec that actually gets rewritten. `null` when the attribute is absent. `05`/`06` need this to
   decide canvas vs list-diff; without it their specified fallback cannot be built.

## SSE stream (`GET /jobs/:id/events`)

Hono's `streamSSE`:

```ts
app.get("/api/jobs/:id/events", c => {
  const job = registry.get(c.req.param("id"));
  if (!job) return c.notFound();
  return streamSSE(c, async stream => {
    if (job.lastProgress) await stream.writeSSE({ event: "progress", data: JSON.stringify(job.lastProgress) });
    if (job.status === "done" || job.status === "error") {
      await stream.writeSSE({ event: job.status, data: JSON.stringify(job.result ?? job.error) });
      return;
    }
    const onProgress = (pe: ProgressEvent) => stream.writeSSE({ event: "progress", data: JSON.stringify(pe) });
    const onSettled  = () => stream.writeSSE({
      event: job.status, data: JSON.stringify(job.result ?? job.error),
    }).then(() => stream.close());
    job.emitter.on("progress", onProgress);
    job.emitter.once("settled", onSettled);
    stream.onAbort(() => { job.emitter.off("progress", onProgress); job.emitter.off("settled", onSettled); });
    await new Promise<void>(r => job.emitter.once("settled", () => r()));
  });
});
```

- Events: `progress` (`ProgressEvent`), then exactly one of `done` (`OptimiseResultDTO` /
  `RecommendedNodeDTO[]`) or `error` (`JobError`), then the stream closes.
- **Late subscriber**: the handler replays `lastProgress` and, if already settled, the terminal
  event immediately — so opening the stream after the job finished still works. The UI can also
  just `GET /jobs/:id`.
- **Heartbeat**: `streamSSE` + a 15 s `: keep-alive` comment so a proxy/browser doesn't drop an
  idle connection during a long `BuildOutput`. (Localhost, so mostly belt-and-braces.)
- **Reconnect**: `Last-Event-ID` not implemented for v1 — on drop the UI re-`GET`s `/jobs/:id`
  and re-opens the stream; `lastProgress` covers the gap.

## Config (`config.ts`)

| Env | Default | Notes |
|-----|---------|-------|
| `PORT` | `8787` | binds `127.0.0.1` only |
| `POB_LUAJIT_PATH` | (bridge default) | passed to the pool |
| `POOL_SIZE` | **half the host's `availableParallelism()`**, floor 1 (16 cores → 8) | PoB's calc is CPU-bound, so oversubscribing cores buys nothing, and each LuaJIT child is ~700 MB resident (8 → ~5.6 GB). Lower it on a RAM-tight machine. |
| `MAX_ACTIVE_JOBS` | `= POOL_SIZE` | additional ceiling on running job COUNT (phase 1.5: admission is primarily slot-based now, see `01`) |
| `JOB_PARALLELISM` | **same as `POOL_SIZE`** | phase 1.5 (`01`): pool slots each "optimise" job leases. Defaulting it to the whole pool is what makes a single run fast — the point of the phase. A second optimise job then queues (strict FIFO) rather than halving both. Set below `POOL_SIZE` to trade run speed for job concurrency, or `1` for pre-phase-1.5 behaviour. Clamped to `<= POOL_SIZE`. |
| `CONTRACT_VERSION` | from `@poe2/contract` | echoed on `/health` |

## Tests

- `pob/code.ts` round-trips a corpus XML through encode→decode.
- `POST /builds` with a real ninja export code → `BuildSummary` with the right class/level; a
  0-DPS fixture → `notes` contains the flag.
- Job lifecycle with a stub core (`optimiseTree` swapped for a fn that emits 3 progress ticks
  then resolves): `POST /jobs` → SSE yields 3 `progress` then 1 `done`; `GET /jobs/:id` has the
  result.
- Cancel mid-run marks `cancelled` and the later result is dropped.
- One end-to-end against the real pool + a small `--respec-budget 2` job (slow test, tag it).
