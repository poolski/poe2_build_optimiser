<!-- generated-by: groundrules v1.10.0 -->
# 0002 — Scope is the passive tree only

**Date**: 2026-08-28
**Status**: Accepted

## Context

A build has passive-tree allocations, gear, and skill + support gems. An early design sketched a
skill/support-gem optimiser (`intake/skill-optimiser-design.md`). A PoE1-vs-PoE2 assumption audit
found the calc engine enforces almost none of the gem rules — one-support-per-character,
≤5-per-skill, family-uniqueness, socket colours would all be ours to impose — and gems carry their
own balance mechanics (drop rates, level gates).

## Decision

The optimiser only edits passive-tree allocations. Skill gems and support gems are immutable
calculation inputs; `socketGroupList` is never touched.

## Alternatives considered

- **Ship the gem optimiser next** — rejected: every gem legality rule would have to be
  reimplemented on our side, and the search space multiplies without the calc engine catching an
  illegal configuration.
- **Drop the gem design entirely** — rejected: the sketch and its completed audit are cheap to
  keep and still accurate if scope reopens; they live in `intake/skill-optimiser-design.md`.

## Consequences

### Positive
- Constraint handling only has to reason about tree-sourced stats.

### Negative / Tradeoffs
- The bridge → shared-package extraction (ADR-0005) loses its original trigger (a second consumer
  of gem rules) and is justified instead by the web UI.

### Neutral
- If scope reopens, the audit headline still holds and is preserved in the intake doc.
