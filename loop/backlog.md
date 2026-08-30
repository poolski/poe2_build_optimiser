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

- [x] **`RunProgress`: render one row per worker from `progress.workers[]`
      (`packages/web/src/steps/RunProgress.tsx`).** Acceptance test:
      `npx vitest run packages/web/src/steps/RunProgress.test.tsx` → exit 0 = green.
      Behaviour: when `progress.workers` is present, render one element carrying class
      `worker-row` per entry, each showing `<done> / <total>` (e.g. `3 / 7`). When `workers` is
      absent or empty, render no `worker-row` elements. Out of scope: the top-N nodes list, the
      sparkline, the canvas.

- [x] **`RunProgress`: render the top-N candidate nodes from `progress.topNodes[]`
      (`packages/web/src/steps/RunProgress.tsx`).** Acceptance test:
      `npx vitest run packages/web/src/steps/RunProgress.test.tsx` → exit 0 = green.
      Behaviour: when `progress.topNodes` is present, render a `top-nodes` list in array order
      (already ranked most-promising first by the emitter — do not re-sort), each entry showing
      its `name` and `scoreDelta`. When `topNodes` is absent or empty, render no `top-nodes`
      element. Out of scope: the worker rows, the sparkline, the canvas.

- [ ] **Add a shared known-metrics module (`packages/web/src/metrics/knownMetrics.ts`).**
      Acceptance test: `npx vitest run packages/web/src/metrics/knownMetrics.test.ts` → exit 0 =
      green. Behaviour: export `KNOWN_METRICS: string[]` — exactly
      `["TotalDPS", "TotalEHP", "Life", "Mana", "EnergyShield", "FireResist"]` (real names already
      referenced elsewhere in this repo; do not add any name not already attested in the
      codebase) — and `mergeMetricOptions(buildStatsKeys?: string[]): string[]`, which returns
      `KNOWN_METRICS` unchanged when called with no argument or `[]`, and otherwise appends any
      `buildStatsKeys` entries not already present, preserving `KNOWN_METRICS`'s order and case-
      sensitive de-duping. Out of scope: wiring this into any component (separate tasks below).

- [ ] **Wire `ConstraintsEditor`'s metric field to the shared known-metrics list
      (`packages/web/src/components/ConstraintsEditor.tsx`).** Acceptance test:
      `npx vitest run packages/web/src/components/ConstraintsEditor.test.tsx` → exit 0 = green.
      Behaviour: each constraint row's metric `<input>` gets a `list="<id>"` attribute pointing
      at a `<datalist>` (rendered once, not per-row) whose `<option>` values equal
      `mergeMetricOptions()` from `../metrics/knownMetrics` — a plain call with no build-stats
      argument. The field must still accept and emit an arbitrary free-text value not in that
      list, unchanged from today (`rowsToConstraints` output identical for the same typed
      string). Out of scope: `ObjectiveBuilder`, sourcing build-specific stat keys into
      `mergeMetricOptions`'s argument, the freeze/anchor context menu, `TreeCanvas`.

- [ ] **Refactor `ObjectiveBuilder`'s single-metric datalist onto the shared known-metrics list,
      dropping the invented names (`packages/web/src/components/ObjectiveBuilder.tsx`).**
      Acceptance test: `npx vitest run packages/web/src/components/ObjectiveBuilder.test.tsx` →
      exit 0 = green. Behaviour: the existing `list="metric-suggestions"` `<datalist>` (currently
      hand-rolled with `TotalDPS, TotalEHP, Life, EnergyShield, CombinedDPS, FullDPS`) must have
      its `<option>` values replaced with exactly `KNOWN_METRICS` from `../metrics/knownMetrics`
      (drops `CombinedDPS` and `FullDPS`, adds `Mana` and `FireResist`) — same `list`/`datalist`
      wiring pattern, just sourced from the shared module instead of a local array. The field
      must still accept and emit an arbitrary free-text value, and `buildObjectiveSpec` output
      must be unchanged for any given value. Out of scope: `ConstraintsEditor`, the `dps-ehp` /
      `blend` kinds, the freeze/anchor context menu, `TreeCanvas`.
