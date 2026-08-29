---
paths:
  - "PLAN.md"
  - "docs/**"
  - "intake/**"
---
<!-- generated-by: groundrules v1.10.0 -->

# Where documentation goes

- **`PLAN.md`** (repo root) — the plan *and* the map. Active worklist (In progress / Up next /
  Ideas / Waiting) on top, then Shipped / Out of scope. A MAP, not a changelog: no commit
  hashes, no test counts, no "step N done", no phase/step numbering.
- **`docs/ROADMAP.md`** — forward-looking candidate work. PLAN.md does not duplicate it.
- **`docs/`** — curated, kept-current synthesis docs (`VISION.md`, `ARCHITECTURE.md`,
  `PROCESS.md`, `LEARNINGS.md`, `GLOSSARY.md`), plus `gotchas.md` and the `beam-search/` and
  `cli/` references.
- **`docs/decisions/`** — ADR-0001 … ADR-0012, the decisions of record. When you make a
  load-bearing choice, add an ADR and trim the prose that carried it to a pointer.
- **`intake/`** — design specs the curated docs were synthesised from. Change these **only when
  the design changes**, not on every code edit.
- Absolute dates only (YYYY-MM-DD).
