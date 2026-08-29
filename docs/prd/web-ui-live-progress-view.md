<!-- generated-by: groundrules v1.10.0 -->
# PRD — Live progress view in the web UI

> Product Requirements Document for a single feature. Written **before** building, so the agent
> builds the right thing — not a coherent surprise. Validate it (and answer the open questions)
> before any code. Update it if the scope shifts.

**Date**: 2026-08-29 · **Status**: draft — on [`docs/ROADMAP.md`](../ROADMAP.md) § Next up

## Problem

An optimise run is minutes of opaque work. Today's progress screen
([`RunProgress.tsx`](../../packages/web/src/steps/RunProgress.tsx)) shows a rising recompute
counter, elapsed time, and a rate — plus `bestObjective` when present. That is enough to know the
job is *alive*, but not enough to see it *working*: a user can't tell a slow-but-healthy run from
a stuck one, can't see the parallel candidate-evaluators (phase 1.5, now on `main`) doing their
work, and can't see which passive nodes the search currently favours. The developer debugging a
bad config wants the same visibility.

**For whom**: the web-UI user watching a run they submitted, and the developer diagnosing a run
that looks wrong.

## Success criteria

<!-- Where you can, phrase a criterion so it's expressible as an acceptance test — its executable form. -->

- **Live per-worker view** — while a run is in the `add-loop` / `k-sweep` phase, the progress
  screen renders one row per parallel candidate-evaluator, each showing what that worker is
  currently doing (candidate node name / id, or "idle"/"in flight"), refreshed at each
  phase-boundary tick. Acceptance: with pool size 2, a running optimise job shows 2 worker rows
  whose contents change across ticks.
- **Top-N promising nodes** — the screen shows the current best candidate nodes for the active
  add-step, each with name and score-delta-per-point, re-sorted each add-step. Acceptance: the
  list is non-empty by the second `add-loop` tick and its ordering matches the core's own
  ranking for that step.
- **Objective sparkline** — a small chart of `bestObjective` over tick sequence, so
  "climbing vs flat" is visible at a glance. Acceptance: the sparkline has one point per tick
  that carried a `bestObjective`, and is omitted entirely for recommend jobs (no objective).
- **No behavioural change to the search** — a bench run
  ([`docs/beam-search/repro.md`](../beam-search/repro.md)) is byte-for-byte identical with and
  without a UI attached. Acceptance: existing determinism test stays green; new test asserts
  byte-equal results with vs without `onProgress`.
- **Contract back-compat** — a web/API build from before this change still parses the SSE stream
  (all new fields optional). Acceptance: `packages/contract` schema test round-trips an event
  with and without the new fields.

## Scope

**In scope**

- Extend `OptimiseProgress` (core) and `ProgressEvent` (contract) with **optional** fields:
  `workers[]` (per-evaluator snapshot) and `topNodes[]` (ranked candidate list for the current
  add-step). Fields are populated only when `onProgress` was passed.
- Wire the parallel candidate-evaluator (phase 1.5) to expose a **snapshot** of each worker's
  current candidate at tick time — via a new read-only bridge RPC **if** the state isn't
  reachable from `beamAddLoop` / the evaluator without one (decide in build step 1).
- API server: relay the new fields through the existing SSE plumbing (`04`), copying fields it
  forwards (progress object is reused).
- Frontend `RunProgress.tsx`: worker rows, top-N nodes list, `bestObjective` sparkline. Keep the
  existing counter / rate / elapsed / bar.
- **Canvas highlight**: the stylised tree canvas (spec `06`) is shipped and wired into the result
  view, so highlighting the top-N nodes on it is in scope — additive over the existing
  before/after diff colouring.

**Out of scope** (explicit)

- **Any change to search order, pruning, or the beam algorithm.** Progress reporting only.
- A dedicated progress-only tree canvas. The highlight reuses the shipped `06` canvas as-is; no
  new renderer, no progress-specific geometry.
- `recommendTree` parity — recommend keeps its coarse `candidatesScored / candidatesTotal` tick
  for v1. (Not hard-locked; revisit if cheap.)
- Historical run replay / persisting progress after the run ends.

## Constraints

- **Determinism unchanged.** Progress reporting stays fire-and-forget: not `await`ed in a way
  that gates a branch or reorders candidate evaluation, runs after the reported state is
  committed, wrapped in `try { onProgress?.(ev) } catch {}`. Byte-for-byte bench reproducibility
  ([`docs/beam-search/repro.md`](../beam-search/repro.md)) must not shift. A new bridge RPC, if
  added, is called at phase-boundary ticks only and must not perturb the calc state.
- **Contract back-compat.** All new `ProgressEvent` fields are optional; the Zod schema still
  accepts a pre-change event, and old consumers ignore unknown fields.
- **CLIs stay silent.** `optimiseCli.ts` / `cli.ts` pass no `onProgress`; no new cost or output
  for CLI / bench users. Extra RPCs and snapshot work happen only when a UI is attached.
- Follows the existing `onProgress` / `shouldContinue` design in
  [`intake/web-ui/02-core-progress.md`](../../intake/web-ui/02-core-progress.md) — same tick
  sites, `buildOutputs` still sourced from `get_metrics`, not a TS-side counter.

## Build plan

Ordered steps, each with a validation point.

1. **Reachability spike** — determine whether per-worker current-candidate state is readable
   from `beamAddLoop` / the phase-1.5 parallel evaluator without a new bridge RPC. Decide:
   extend `ProgressEvent` only, or add one read-only bridge method.
   *Validation*: a written finding in this PRD's "Open questions" resolved, with the call sites
   named.
2. **Contract + core types** — add optional `workers[]` and `topNodes[]` to `OptimiseProgress`
   and `ProgressEvent` (Zod). Populate them at the existing `add-loop` / `k-sweep` tick sites
   from data the core already holds (plus the step-1 mechanism for worker state).
   *Validation*: `npm test` (contract schema round-trip test for old + new event shapes);
   `npx tsc --noEmit`.
3. **Determinism guard** — test: `optimiseTree` with vs without an `onProgress` that reads the
   new fields is byte-equal; a throwing `onProgress` doesn't reject or change the result.
   *Validation*: `npm test` green; on request, one bench run per
   [`docs/beam-search/repro.md`](../beam-search/repro.md) to confirm no drift.
4. **API relay** — forward the new fields through the SSE mapper (`04`), copying forwarded
   fields. *Validation*: `npm test` for the API package; manual SSE capture shows the fields.
5. **Frontend** — `RunProgress.tsx`: worker rows, top-N nodes list, `bestObjective` sparkline;
   coalesce rendering to tick cadence. *Validation*: `RunProgress.test.tsx` covers render from
   an event with workers + topNodes + a multi-point objective series, and from a bare recommend
   event (no sparkline, no workers).
6. **Canvas highlight** — highlight the top-N nodes on the shipped `06` canvas, additive over the
   before/after diff colouring. *Validation*: visual check.
7. **End-to-end check** — run a real optimise job via the web UI against a local bridge, pool
   size 2; confirm worker rows change, top-N re-sorts per add-step, sparkline climbs.
   *Validation*: manual, screenshot in the PR.

## Risks

<!-- Premortem: assume this shipped and FAILED — why? Ranked by probability × impact. -->

- **Tick chattiness floods SSE.** Per-worker updates at high frequency swamp the stream and the
  React render loop; the UI stutters and the "live" view feels worse than the counter it
  replaced. *Early signal*: SSE event rate >~2/s in step 4's capture, or dropped frames in
  step 5. *Mitigation*: emit only at existing phase-boundary / per-depth tick sites (no new tick
  cadence); frontend renders from the latest event only, no queue.
- **Worker-state races yield torn / stale rows.** Reading the parallel evaluator mid-flight
  shows candidates that were already superseded, or a mix from two add-steps; users lose trust
  when a "current" node was clearly not current. *Early signal*: step 7 shows worker rows
  referencing nodes not in the current `topNodes`. *Mitigation*: take a single snapshot at the
  tick, after the add-step's state is committed; tag rows explicitly as `in-flight` /
  `settled`; never interpolate between snapshots.
- **Denominator dishonesty.** A progress bar backed by a `P·W·D·(1+Ksweep)` estimate that jumps
  or exceeds 100% erodes trust more than having no bar. *Mitigation*: keep the existing rule —
  bar only once `estimatedTotal` is known for the depth; clamp to 100; label "estimate".
- **Scope creep into canvas / tree viz.** "Show promising nodes" quietly grows into reworking the
  tree renderer. *Mitigation*: the highlight is a layer over the shipped `06` canvas — no renderer
  changes — enforced at review; the list stays the source of truth if the highlight is cut.
- **Determinism regression slips through.** A convenience `await` on the new bridge RPC subtly
  reorders evaluation; the fast suite still passes because it uses fake bridges.
  *Mitigation*: step 3's byte-equal test plus an explicit "no `await` gates a branch" review
  check; run the real-bridge bench once before calling it done.

## Open questions

<!-- Resolve before building. -->

- **Step 1 outcome** — *answered, 2026-08-30.* Option (a): instrument `ParallelBridge`
  (`packages/pob-bridge/src/parallel.ts`) with an observer callback at dispatch/settle, reporting
  per-shard progress. Keeps `src/core` clean (zero new bridge RPC); a "worker row" means a leased
  pool slot working a chunk, not a single candidate.
- **Worker identity** — *answered, 2026-08-30.* A row shows "slot N · done/total candidates"
  (chunk progress), not a single current candidate — honest about what a shard observer can
  report.
- **`topNodes` size** — *answered, 2026-08-30.* Fixed at 5. No config surface added.
- **recommendTree**: confirm it stays on the coarse tick for v1, or fold in a trimmed
  `topNodes` if step 2 makes it near-free.
- **Canvas trigger** — *answered*: spec `06`'s stylised diff canvas is shipped on `main` and
  wired into the web result view (see `PLAN.md` § Shipped, `packages/web`), so step 6 is live, not
  conditional. Confirm the highlight is additive over the existing before/after diff colouring.
