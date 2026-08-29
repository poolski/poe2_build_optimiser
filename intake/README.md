# Intake

Design specs and source documents that the curated `docs/` were synthesised from.

Files here change only when a *design* changes — not on every code change. The curated,
kept-current view of the project lives in `docs/` (`status.md` is the map).

## What's here

| Path | What |
| ---- | ---- |
| `beam-search-design.md` | The passive-tree optimiser design + implementation-status checklist + open questions. Results and validation write-ups stay in `docs/beam-search/`. |
| `web-ui/` | The web UI + bridge-service track — one file per domain (`01`–`10`), plus `README.md` as the index. `01`–`09` shipped; `10` is spec-only. |
| `skill-optimiser-design.md` | Shelved skill/support-gem optimiser sketch + its completed PoE1-vs-PoE2 assumption audit. Kept for reference (see ADR-002). |

## What goes here

- Multi-step design specs / track plans (the numbered `NN-*.md` style)
- Raw feature briefs or external contracts, before synthesis into `docs/`
- Anything that shaped a decision, in its original form

## What doesn't

- Code (`src/`, `packages/`)
- Curated documentation kept current with the code (`docs/`)
- Decisions of record — those are ADRs in `docs/decisions/`
- Results, benchmarks, repro write-ups (`docs/beam-search/`)

---

*Added by groundrules adoption 2026-08-29; populated by the design-spec reorg the same day.*
