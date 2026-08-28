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
  no job ever waits inside `pool.acquire()`.
- **Cancellation.** `abort.abort()`; `runner` passes `abort.signal` down and checks it in the
  `onProgress` callback boundary (between add-loop depths / k-sweep steps — the only safe yield
  points). Core itself doesn't take an `AbortSignal` in v1; the runner throwing a
  `CancelledError` from inside `onProgress`… no — `onProgress` must not throw (see `02`). Instead
  the runner wraps: it can't interrupt a single `BuildOutput`, but it *can* stop the job at the
  next phase boundary by having `optimiseTree` accept an optional `shouldContinue?: () => boolean`
  checked at the same points as `onProgress`. Add that alongside `onProgress` in `02` if cancel
  needs to be prompt; otherwise cancel just marks the job and discards the result when it lands.
  **Decision for v1: discard-on-completion cancel** (simpler, worst case wastes one job's
  compute). Revisit if runs get long enough that it matters.
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

No bridge round-trip needed. The `<Spec>` element's `nodes="12,34,56,…"` attribute is the
allocated-node id list. Given `result.removed[].id` (+ their cascades — use
`result.pointsFreed` cross-check) and `result.addedNodeIds` + the path nodes each step dragged
in:

- The **authoritative** post-plan allocation is what the bridge holds after the run. Cheapest
  correct route: add a `get_allocated_node_ids` RPC (or reuse `list_allocated_nodes` → map to
  ids) **on the still-acquired bridge before `release()`**, then string-replace the `nodes="…"`
  attribute in the original XML and `encodePobCode`.
- Doing the set arithmetic in TS from `removed`/`added` is possible but has to replay AllocNode's
  path-node drag-in and DeallocNode's cascade exactly — the bridge already knows. **Use the RPC.**
  This is the only bridge-side addition the API needs, and it's a 5-line read-only method.

Weapon-set nodes: PoB stores those in `<WeaponSet1 nodes>` / `<WeaponSet2 nodes>`. The optimiser
only touches the base spec, so leave those attributes untouched.

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
| `POOL_SIZE` | `max(1, min(8, cpus-2))` | LuaJIT children = RAM cost |
| `MAX_ACTIVE_JOBS` | `= POOL_SIZE` | keep ≤ pool so acquire never blocks |
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
