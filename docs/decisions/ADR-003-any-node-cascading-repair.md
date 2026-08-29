# ADR-003 — Any-node cascading repair, not leaf-only

**Status:** Accepted (2026-08-28) — supersedes the original leaf-only repair

## Context

The first repair implementation only freed terminal (leaf) allocated nodes, then greedily
re-spent. A cascade-verification spike (`spike/verifyDeallocCascade.ts`) found ~80% of allocated
regular nodes are interior — leaf-only sees the other ~20% — and 25–55% of interior removals move
the objective < 5% or help it (dead cross-build pathing, long attribute chains, unused jewel
sockets).

## Decision

Repair may free any removable regular node, leaf or interior, via PoB's `DeallocNode` cascade.
Candidates are ranked by objective value lost, greedy-knapsacked to a `respecBudget` *points*
ceiling (an over-budget cascade is skipped for a smaller one), and the driver sweeps `k = 1..N`
points freed, keeping the best.

## Consequences

- The `k`-sweep counts *points* freed (variable per removal), not leaves.
- `stoppedBecause: "no-leaves"` became `"nothing-removable"`.
- `removeIds` on the bridge was already cascade-safe, so no bridge change was needed.
- Ascendancy nodes stay unconditionally frozen — their point pool cannot be re-spent.
- Design detail: `intake/beam-search-design.md` §7.
