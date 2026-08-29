# ADR-002 — Scope is the passive tree only

**Status:** Accepted (2026-08-28)

## Context

A build has passive-tree allocations, gear, and skill + support gems. An early design sketched a
skill/support-gem optimiser (`intake/skill-optimiser-design.md`). A PoE1-vs-PoE2 assumption audit
found the calc engine enforces almost none of the gem rules — one-support-per-character,
≤5-per-skill, family-uniqueness, socket colours would all be ours to impose — and gems carry their
own balance mechanics (drop rates, level gates).

## Decision

The optimiser only edits passive-tree allocations. Skill gems and support gems are immutable
calculation inputs; `socketGroupList` is never touched. The skill/support-gem optimiser is shelved
indefinitely, not "next". Its design sketch and completed audit are kept in
`intake/skill-optimiser-design.md` in case scope reopens.

## Consequences

- The bridge → shared-package extraction (ADR-005) loses its original trigger (a second consumer
  of gem rules) and is justified instead by the web UI.
- Constraint handling only reasons about tree-sourced stats.
- If scope reopens, the audit headline still holds and is preserved in the intake doc.
