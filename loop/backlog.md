<!-- generated-by: groundrules realize, 2026-08-30 -->
# Loop backlog

Tasks the maker/verifier loop may pick up. Each has a pre-written, red, behavioural acceptance
test committed alongside this file — the maker's job is to turn it green without editing the
test. See `docs/prd/web-ui-live-progress-view.md` for full context.

## Tasks

- [x] **Add optional `workers[]` and `topNodes[]` fields to `ProgressEvent`
      (`packages/contract/src/progress.ts`) and `OptimiseProgress`
      (`src/core/optimiseTree.ts`).** Acceptance test:
      `npx vitest run packages/contract/src/progress.test.ts` → exit 0 = green.
      Behaviour: `ProgressEvent` gains `workers: { slot: number; done: number; total: number }[]`
      (optional) and `topNodes: { id: string; name: string; scoreDelta: number }[]` (optional,
      max 5 entries), both round-tripping through `.parse()` unchanged when present, and the
      schema still parses an event that omits them entirely. Mirror the same two optional fields
      onto the `OptimiseProgress` interface in `src/core/optimiseTree.ts` (not yet populated by
      any emitter — that's a separate task). Out of scope: populating the fields from real data,
      `RecommendProgress`, the API mapper, and the frontend.

- [x] **Forward `workers[]` / `topNodes[]` through `normalizeProgress`
      (`packages/api/src/jobs/mappers.ts`).** Acceptance test:
      `npx vitest run packages/api/src/jobs/mappers.test.ts` → exit 0 = green.
      Behaviour: when the core progress object passed to `normalizeProgress` carries `workers`
      and/or `topNodes`, the returned `ProgressEvent` includes them unchanged (same pattern as
      the existing `depth`/`k`/`kTotal`/`candidatesScored` copy-through in that function); when
      absent, the returned event omits them (no `0`/`[]` sentinel). Out of scope: the contract
      schema itself (prior task), populating the fields on the core side, SSE wiring beyond this
      mapper function.

- [x] **`ParallelBridge` shard-observer: report per-shard dispatch/settle progress
      (`packages/pob-bridge/src/parallel.ts`).** Acceptance test:
      `npx vitest run packages/pob-bridge/src/parallel.test.ts` → exit 0 = green.
      Behaviour: constructor takes an optional `onShardProgress?: (u: ShardProgress) => void`;
      fired with `{slot, done: 0, total}` at dispatch and `{slot, done: total, total}` at settle
      for each shard, `slot` being the index within `ParallelBridge.slots`. Must not perturb
      recombination (results still recombined by chunk index) and a throwing observer must not
      affect the call. Out of scope: `PobBridgePool`/API wiring (separate task).

- [x] **Thread `onShardProgress` through `acquireParallel` and merge into emitted
      `ProgressEvent.workers[]` (`packages/pob-bridge/src/pool.ts`,
      `packages/api/src/jobs/runner.ts`, `packages/api/src/builds/store.ts`).** Acceptance test:
      `npx vitest run packages/api/src/jobs/registry.test.ts` → exit 0 = green.
      Behaviour: `BridgeSource.acquireParallel(n, onShardProgress?)` passes the callback to
      `ParallelBridge`; `runJob` keeps a per-slot latest-update map and merges it onto
      `pe.workers` before every emitted progress event, for jobs with `parallelism > 1`. Out of
      scope: the frontend, the canvas.

- [ ] **`RunProgress`: render one row per worker from `progress.workers[]`
      (`packages/web/src/steps/RunProgress.tsx`).** Acceptance test:
      `npx vitest run packages/web/src/steps/RunProgress.test.tsx` → exit 0 = green.
      Behaviour: when `progress.workers` is present, render one element carrying class
      `worker-row` per entry, each showing `<done> / <total>` (e.g. `3 / 7`). When `workers` is
      absent or empty, render no `worker-row` elements. Out of scope: the top-N nodes list, the
      sparkline, the canvas.

- [ ] **`RunProgress`: render the top-N candidate nodes from `progress.topNodes[]`
      (`packages/web/src/steps/RunProgress.tsx`).** Acceptance test:
      `npx vitest run packages/web/src/steps/RunProgress.test.tsx` → exit 0 = green.
      Behaviour: when `progress.topNodes` is present, render a `top-nodes` list in array order
      (already ranked most-promising first by the emitter — do not re-sort), each entry showing
      its `name` and `scoreDelta`. When `topNodes` is absent or empty, render no `top-nodes`
      element. Out of scope: the worker rows, the sparkline, the canvas.
