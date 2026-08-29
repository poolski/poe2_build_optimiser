<!-- generated-by: groundrules v1.10.0 -->
# 0004 — The no-regression floor is `TotalEHP`, not elemental resists

**Date**: 2026-08-28
**Status**: Accepted — supersedes the original three-resist floor

## Context

Without a defensive floor, raw-`TotalDPS` repair "improves" a hand-tuned build by ~+40% by
enabling Chaos Inoculation (`Maximum Life is 1`) and reallocating life nodes — the exact failure a
floor exists to prevent. The original floor pinned the three elemental resists, but resists come
from gear, not the tree, so the tree optimiser cannot regress them anyway, and `--min-resist`
alone does not stop the CI trade (CI touches no resist).

## Decision

The default no-regression floor is `DEFAULT_PRESERVE = ["TotalEHP"]`. `res ok` stays as a
diagnostic that resists did not regress. `--preserve=A,B` adds corpus-wide; each build may carry a
per-build `preserve` override.

## Alternatives considered

- **Keep the three-resist floor** — rejected: inert for a tree-only optimiser (resists are gear
  stats) and blind to the Chaos Inoculation trade.
- **Score on the `dps-ehp:0.5` blend instead of a floor** — rejected: measured on the corpus, the
  blend does **not** separate tuned from naive builds (both ≈ +1.3%) and a preserve floor is inert
  on top of it.

## Consequences

### Positive
- The validated repair recipe is raw `TotalDPS` + `--preserve` on the tree-sourced defensive
  layers (e.g. `Life,Evasion,EnergyShield` for the Monk pair): exact no-change on tuned builds,
  real gains on naive ones.

### Negative / Tradeoffs
- The right `--preserve` set is build-dependent — the default covers `TotalEHP` only, and a build
  whose defence sits in a layer outside it needs the per-build override.

## Notes

Repro: `docs/beam-search/repro.md`. Backing run: `docs/beam-search/bench-totaldps.md`.
