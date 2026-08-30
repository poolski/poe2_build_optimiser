<!-- generated-by: groundrules v1.10.0 -->
# 0014 — Bundle Configure-step UI ideas into one feature release

**Date**: 2026-08-30
**Status**: Accepted

## Context

`PLAN.md`'s "Ideas — to triage" backlog held three untriaged, unrelated-looking one-liners that
all turn out to touch the same surface — the Configure step's constraint/objective UI: freeze
nodes from the tree explorer (right-click context menu), a dropdown metric picker in the
constraint builder (replacing free-text metric entry), and a selectable objective metric (replacing
free-text objective entry). A fourth backlog item, dropping the `MinResist` constraint, was
considered for the same bundle but excluded — it's a scope-reduction decision, not a UI feature,
and orthogonal to the other three.

## Decision

Bundle "freeze nodes from tree explorer", "dropdown metric picker in constraint builder", and
"selectable objective metric" into a single feature release, since all three are Configure-step
UI additions that share the same surface and can reasonably ship together. `Drop MinResist
constraint` stays in the backlog as its own future decision.

## Alternatives considered

- **Option A**: why rejected
- **Option B**: why rejected

## Consequences

### Positive
- ...

### Negative / Tradeoffs
- ...

### Neutral
- ...

## Notes

Useful links, references, related discussions.
