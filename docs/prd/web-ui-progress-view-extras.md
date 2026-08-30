<!-- generated-by: groundrules v1.10.0 -->
# PRD — Progress view extras: objective sparkline, canvas highlight, e2e check

> Product Requirements Document for a single feature. Written **before** building, so the agent
> builds the right thing — not a coherent surprise. Validate it (and answer the open questions)
> before any code. Update it if the scope shifts.

**Date**: 2026-08-30 · **Status**: draft — split from
[`docs/prd/web-ui-live-progress-view.md`](web-ui-live-progress-view.md) per
[ADR-0013](../decisions/0013-close-out-live-progress-view-prd-defer-remaining-scope.md), which
closed that PRD once per-worker rows and the top-N node list shipped.

## Problem

The live-progress-view PRD shipped its core: `RunProgress.tsx` renders one row per parallel
candidate-evaluator (worker slot) and a top-5 promising-nodes list, both looped end-to-end
(`PLAN.md`, 2026-08-30). Three capabilities from that PRD's original scope didn't ship with it:

- A `bestObjective` sparkline, so "climbing vs. flat" is visible at a glance instead of only the
  current number.
- Highlighting the top-N nodes on the shipped `06` stylised tree canvas, so the promising-nodes
  list has a visual anchor instead of being text-only.
- A real-bridge end-to-end validation pass tying worker rows, top-N, and the sparkline together
  in one live run.

None of the three had a settled design or acceptance test at the time the original PRD closed —
that's exactly why they were split out rather than shipped alongside the rest.

**For whom**: the web-UI user watching a run they submitted, and the developer diagnosing a run
that looks wrong.

## Success criteria

<!-- Where you can, phrase a criterion so it's expressible as an acceptance test — its executable form. -->

- **Objective sparkline** — a small chart of `bestObjective` over tick sequence, so "climbing vs.
  flat" is visible at a glance. Acceptance: the sparkline has one point per tick that carried a
  `bestObjective`, and is omitted entirely for recommend jobs (no objective).
- **Canvas top-N highlight** — the top-N candidate nodes are visually distinguished on the
  shipped `06` canvas, additive over the existing before/after diff colouring. Acceptance: a
  concrete, non-manual check (not just "visual check" — see Open questions) confirms the
  highlighted node set matches the current `topNodes` list.
- **End-to-end check** — a real optimise job run via the web UI against a local bridge, pool
  size 2, shows worker rows changing, top-N re-sorting per add-step, and the sparkline climbing,
  all in the same run. Acceptance: manual, screenshot in the PR.

## Scope

**In scope**

- `RunProgress.tsx`: `bestObjective` sparkline, rendered from the existing `ProgressEvent` stream
  (no new contract fields expected — `bestObjective` is already present per tick).
- Canvas highlight: layer the top-N nodes onto the shipped `06` canvas
  (`packages/web/src/...` result view), additive over the existing before/after diff colouring.
- The real-bridge end-to-end validation run and its screenshot.

**Out of scope** (explicit, carried over from the closed PRD)

- **Any change to search order, pruning, or the beam algorithm.** Progress reporting only.
- A dedicated progress-only tree canvas. The highlight reuses the shipped `06` canvas as-is; no
  new renderer, no progress-specific geometry.
- `recommendTree` parity — recommend keeps its coarse `candidatesScored / candidatesTotal` tick.
- Historical run replay / persisting progress after the run ends.
- Progress-bar / rate honesty (per-depth denominator resets, cross-phase `rate` averaging) —
  those are pre-existing `RunProgress.tsx` behaviours, not new scope here; tracked as risks on
  the closed PRD (`docs/prd/web-ui-live-progress-view.md` § Risks), not as a build item.

## Constraints

Carried over from the closed PRD — still binding:

- **Determinism unchanged.** Progress reporting stays fire-and-forget, wrapped in
  `try { onProgress?.(ev) } catch {}`. Byte-for-byte bench reproducibility
  ([`docs/beam-search/repro.md`](../beam-search/repro.md)) must not shift.
- **Contract back-compat.** Any new `ProgressEvent` fields are optional.
- **CLIs stay silent.** No new cost or output for CLI / bench users; extra rendering work happens
  only in the web UI.

## Build plan

Ordered steps, each with a validation point.

1. **Sparkline state-ownership decision** — resolve whether the tick history backing the
   sparkline lives as component-local state in `RunProgress.tsx` or is threaded down as a new
   prop from the parent (the SSE-consuming component). *Validation*: a written decision in this
   PRD's Open questions, with the call sites named.
2. **Sparkline implementation** — `RunProgress.tsx` renders the sparkline per the chosen
   ownership model; coalesced to tick cadence like the existing fields.
   *Validation*: `RunProgress.test.tsx` covers render from a multi-point `bestObjective` series
   and from a bare recommend event (no sparkline).
3. **Canvas highlight** — highlight the top-N nodes on the shipped `06` canvas, additive over the
   before/after diff colouring. *Validation*: a concrete acceptance test defined in step 1's
   sibling open question below — not just "visual check".
4. **End-to-end check** — run a real optimise job via the web UI against a local bridge, pool
   size 2; confirm worker rows change, top-N re-sorts per add-step, sparkline climbs.
   *Validation*: manual, screenshot in the PR.

## Risks

<!-- Premortem: assume this shipped and FAILED — why? Ranked by probability × impact. -->

- **Scope creep into canvas / tree viz.** "Highlight promising nodes" quietly grows into
  reworking the tree renderer. *Mitigation*: the highlight is a layer over the shipped `06`
  canvas — no renderer changes — enforced at review; the list stays the source of truth if the
  highlight is cut.
- **Canvas highlight ships with no regression test.** "Visual check" was flagged in `PLAN.md` as
  an unspecified acceptance criterion before this split; if step 3 ships without resolving the
  open question below, the same gap reappears. *Early signal*: PR review finds no automated
  assertion tying highlighted nodes to `topNodes`. *Mitigation*: resolve the open question before
  starting step 3, not after.

## Open questions

<!-- Resolve before building. -->

- **Sparkline state ownership** — component-local state in `RunProgress.tsx`, or a new prop from
  the parent that already accumulates the SSE event history? Blocks build step 1.
- **Canvas highlight acceptance test** — what does "matches the current `topNodes` list" mean as
  an executable check, given the canvas is a rendered/stylised view? A DOM query for
  highlighted-node data attributes, a snapshot test, or something else? Blocks build step 3.
