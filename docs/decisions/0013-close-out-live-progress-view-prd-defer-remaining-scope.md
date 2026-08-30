<!-- generated-by: groundrules v1.10.0 -->
# 0013 — Close out live-progress-view PRD; defer sparkline, canvas highlight, and e2e check to a new feature

**Date**: 2026-08-30
**Status**: Accepted

## Context

The live-progress-view PRD (`docs/prd/web-ui-live-progress-view.md`) shipped per-worker rows and
the top-5 promising-nodes list, looped end-to-end. Three items remain open in PLAN.md's "Up
next": the `bestObjective` sparkline (needs an undecided state-ownership design — component-local
state vs. a new prop from the parent), the top-N canvas highlight (only a "visual check"
acceptance criterion, no test specified), and the real-bridge end-to-end screenshot check (manual
by nature, conflicts with the real-bridge-only-when-asked rule). None of the three has a settled
design or acceptance test, so keeping them under the same PRD blocks marking it complete.

## Decision

Treat worker rows + the top-N list as the complete, shipped scope of the live-progress-view PRD.
Split the sparkline, canvas highlight, and e2e check into a new PRD/feature with their own design
decisions and acceptance criteria, and update PLAN.md to reflect the split.

## Alternatives considered

- **Keep everything under the original PRD until all items ship**: rejected — blocks marking
  known-complete, validated work (worker rows + top-N list) as done, and the sparkline's
  state-ownership question isn't settled yet, so the PRD would stay in limbo indefinitely.
- **Drop the remaining items instead of deferring them**: rejected — no signal they're unwanted,
  only that they aren't designed or validated yet; cutting them would lose the acceptance-test
  gaps already identified (canvas highlight has no test beyond "visual check").

## Consequences

### Positive
- `PLAN.md` accurately reflects shipped vs. open work instead of one PRD sitting perpetually
  "in progress" for a subset of its scope.
- The new PRD can independently settle the sparkline's state-ownership decision and define a
  concrete acceptance test for the canvas highlight, instead of inheriting an unresolved
  question from the original.

### Negative / Tradeoffs
- Two PRDs must now be tracked and cross-referenced instead of one; a reader following
  `docs/ROADMAP.md` needs to land on the successor PRD, not the closed one.
- Risks already logged against the original PRD (denominator-reset UX, cross-phase `rate`
  averaging) touch the sparkline/estimate work but stay filed on the closed PRD rather than the
  new one, since they concern already-shipped bar/rate behaviour, not new scope.

### Neutral
- No code changes result from this ADR by itself — it only re-files scope and updates the map.

## Notes

Useful links, references, related discussions.
