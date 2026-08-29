# Phase 1 — `onProgress` + `shouldContinue` in the core

The **two** changes to `src/core/*` in v1 of the web-UI track (phase 1.5 adds a third — the
parallel evaluator, see `01`). An optimise run is minutes of opaque work: the UI needs a progress
signal (`onProgress`) and a way to stop a wrong job promptly (`shouldContinue`). Both are
optional, side-effect-free, checked at the *same* points, and invisible to the CLIs and the bench
harness.

Lives in phase 1 because the API server (phase 2) needs `onProgress` to relay SSE and
`shouldContinue` to make Cancel free a pool slot instead of leaving a 15-minute zombie.

## The addition

`src/core/optimiseTree.ts`:

```ts
export interface OptimiseProgress {
  /** Coarse stage of the run. */
  phase:
    | "baseline"          // measuring the loaded tree
    | "regret-probe"      // repair: scoring dealloc candidates
    | "add-loop"          // extend walk / repair re-spend (the long part)
    | "k-sweep"           // repair: re-running the add-loop for k = 1..N freed prefixes
    | "finalising";
  /** Real BuildOutput recomputes so far (from the memo evaluator's counter). The honest
   *  progress denominator is unknown up front, so the UI shows a rate + elapsed, not a bar,
   *  unless `estimatedTotal` is set. */
  buildOutputs: number;
  estimatedTotal?: number;   // set once the add-loop knows its candidate-pool size for a depth
  /** Best objective value found so far on any live plan (baseline before the first improving
   *  step). Lets the UI show "climbing". */
  bestObjective: number;
  /** add-loop / k-sweep only. */
  depth?: number;            // current add-step index
  k?: number;                // current k-sweep index, 1-based
  kTotal?: number;
  /** A short human line, e.g. "re-spend step 3: Glaciation (+1240/pt)". Optional; the UI can
   *  build its own from the fields above. */
  note?: string;
}

export interface OptimiseTreeOptions {
  // …existing fields…
  /** Called synchronously at phase boundaries and once per add-loop depth / k-sweep iteration.
   *  Must not throw and must not touch its arguments after returning (the object is reused).
   *  Never affects search order or results. Undefined = no callback (CLI default). */
  onProgress?: (ev: OptimiseProgress) => void;
  /** Checked at the *same* boundaries as onProgress (never mid-BuildOutput). Returning false
   *  makes optimiseTree stop after the current add-step and return its best plan so far with
   *  `stoppedBecause: "cancelled"`. Undefined = never cancels (CLI default). Must not throw. */
  shouldContinue?: () => boolean;
}
```

`shouldContinue` returning false is a clean early return, not an exception: the partial result is
still valid (best plan found so far), just flagged. The API runner (`04`) discards it anyway on a
user cancel, but a clean return is what frees the bridge slot immediately.

`recommendTree` gets the same optional `onProgress` with a trimmed event (`phase: "scoring" |
"finalising"`, `buildOutputs`, `candidatesTotal`, `candidatesScored`). It is a single fast pass,
so a coarse "scored 120 / 400 candidates" tick per batch is enough.

## Where the calls go

- **`optimiseTree`** top: emit `baseline` after `get_stats` / `get_tree_status`.
- **Repair path**, before `evaluate_dealloc_candidates`: emit `regret-probe`.
- **`beamAddLoop`** (`optimiseTree.ts`, shared by extend + repair): emit `add-loop` once per
  depth, with `depth`, `buildOutputs` from `memo`, `bestObjective` = best live plan's objective,
  and `estimatedTotal` once the depth's pooled candidate count is known.
- **k-sweep** (repair driver): emit `k-sweep` with `k` / `kTotal` before each re-spend.
- **`withMetrics`** wrap-up: emit `finalising`.

At each of those `onProgress` sites, also check `shouldContinue?.() ?? true` immediately after
the emit; if false, break out of the loop / short-circuit to `finalising` and set
`stoppedBecause: "cancelled"`.

### Where `buildOutputs` comes from — read it from the bridge, not from the memo

**Corrected 2026-08-29** (design pass by the phase-1 session; verified against the source). An
earlier draft of this file said to expose a `memo.buildOutputs` getter from `MemoEvaluator`. That
is wrong on two counts:

- `MemoEvaluator` counts *evaluator calls* (for `cacheHitRate`). It has no BuildOutput counter.
- Evaluator calls ≠ `BuildOutput()` invocations. `bridge.lua` fires `recomputeBuild()` **twice**
  per `get_stats_from` and **N+1** times per dealloc probe (see the seven `recomputeBuild()` call
  sites and the comment at `bridge.lua:1043`). A TS-side counter cannot mirror that without
  hard-coding Lua internals, and would drift the moment `bridge.lua` changes.

The authoritative counter is Lua-side: `buildOutputCount`, incremented inside `recomputeBuild()`
(`bridge.lua:98`) and already surfaced by `get_metrics`, which `optimiseTree.ts:735` reads once at
end of run.

**So: source the progress `buildOutputs` from `get_metrics` too** — called at phase-boundary ticks
only, and only when `onProgress` was actually passed. No new bridge RPC. Cost is one cheap RPC per
*tick* (not per candidate), incurred only when a UI is attached; the CLIs pay nothing.

This is also what makes the test assertion below ("last `buildOutputs` == `result.buildOutputCount`")
exact rather than approximate — with a TS-side counter it is unsatisfiable.

**Consequence for the interface:** the tick site must `await` that RPC, so `onProgress` is no
longer emitted purely synchronously. That is fine at phase boundaries (already async contexts),
but keep the hard rule intact: the awaited read must not gate a branch or reorder candidate
evaluation. Reword the `onProgress` doc comment from "called synchronously" to "called at phase
boundaries" when implementing.

## Constraints on the implementation

- **Determinism unchanged.** The callback is fire-and-forget. It must not be `await`ed, must not
  gate a branch, and must run after the state it reports is already committed. The bench harness
  compares byte-for-byte across runs (`docs/beam-search/repro.md`); a progress call that
  reordered anything would break that.
- **No throw propagation.** Wrap the user callback: `try { onProgress?.(ev) } catch {}`. A
  broken UI callback must not fail a job.
- **Object reuse is fine** but documented — the API relay copies the fields it forwards, so a
  reused object is not a problem in practice; still, say "don't retain the argument".
- **CLIs stay silent.** `optimiseCli.ts` / `cli.ts` don't pass `onProgress`. Optionally add a
  `--progress` flag later that prints a `.` per `add-loop` tick to stderr — not in this phase.

## Tests

- `optimiseTree` with an `onProgress` spy: assert the phase sequence for extend
  (`baseline → add-loop* → finalising`) and repair
  (`baseline → regret-probe → k-sweep×N (each with add-loop* inside) → finalising`).
- `buildOutputs` is monotonic non-decreasing across ticks and its last value equals
  `result.buildOutputCount`.
- A callback that throws does not change the result vs the same options without it (byte-equal),
  and does not reject the promise. Same for a `shouldContinue` that throws.
- `shouldContinue` that returns false after the 2nd `add-loop` tick: result has
  `stoppedBecause: "cancelled"`, `steps.length` matches what was committed by then, and the
  result is still internally consistent (`final` reflects exactly those steps).
- `shouldContinue` always true is byte-identical to not passing it.
