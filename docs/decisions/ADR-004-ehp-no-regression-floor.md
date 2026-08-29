# ADR-004 — The no-regression floor is `TotalEHP`, not elemental resists

**Status:** Accepted (2026-08-28) — supersedes the original three-resist floor

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

## Consequences

- The validated repair recipe is raw `TotalDPS` + `--preserve` on the tree-sourced defensive
  layers (e.g. `Life,Evasion,EnergyShield` for the Monk pair): exact no-change on tuned builds,
  real gains on naive ones. Repro: `docs/beam-search/repro.md`.
- The `dps-ehp:0.5` blend does **not** separate tuned from naive (both ≈ +1.3%) and a preserve
  floor is inert on top of it. Raw `TotalDPS` + preserve is the recommended default, not the blend.
