# Roadmap

Future work and long-term vision.

## Currently shipped (2026-08-29)

✅ **Phases 1–3 + 1.5 + 09 (all main features):**
- Greedy recommender (`recommend-tree`)
- Full-featured optimiser (extend / repair / rollback modes, beam search, constraints, freeze lists)
- Web UI + API + tree canvas
- Parallel candidate evaluation within a run (phase 1.5)
- Rollback tree preview in UI (phase 09)

## Planned / Next-priority

### Phase 10 — RePoE-fork asset source (spec only, not built)

Bring in passive tree geometry, node art, and stat text directly from a RePoE-fork, enabling:
- Real node artwork (circles, textures, PoE2 colours)
- Gem icons in sockets
- Raw stat text for each node

**Status:** Spec written in `docs/web-ui/10-repoe-asset-source.md`. Icon rendering would reverse the current "stylised only" design.

**Gating:** Design decision — do we want GGG art or keep the current clean stylised look? No blocker.

### Beam-width default tuning

Earlier work set `beamWidth=1` (greedy) as the proven optimum on a 25-build corpus. A bench sweep remains open:
- Does `beamWidth > 1` improve solution quality for larger builds?
- Is the runtime cost worth it?

**Effort:** Moderate (run `npm run bench-tree-approaches` with various widths, analyze results).

## Deferred / lower-priority

### Pruning layers 3, 4, 6

The beam-search design originally sketched three pruning layers to reduce candidate explosion. Greedy re-spend has been sufficient; these remain unbuilt.

### `--target-level` (point budget from character level)

Auto-derive the available passive point budget from a character level, without manual `--extra-points` entry.

**Blocker:** Requires verified quest→passive-point mapping against vendored PoE2 data (the `verify-PoE2-vs-PoE1-assumptions` discipline). Worth doing before shipping; not blocking current work.

### From-scratch mode (infinite budget + bare tree)

Optimize a completely empty tree (all points available, no fixed allocations). Requires the add-loop to spend zero-delta "pathing" steps toward distant payoff — a generalization of current greedy add that the beam framework could support but hasn't needed yet.

**Stretch goal:** useful for theory-crafting, not needed for the main respec use case.

## Out of scope (decided 2026-08-28)

### Skill / Support gem optimisation

Skill and support gems are **immutable inputs**. The optimiser never edits gem links, levels, or qualities.

**Why:** Scope focus. Gems have different balance mechanics than passives (drop rates, level gates, family uniqueness, socket colours, etc.). Optimizing gems is a separate problem. Decided with the user 2026-08-28; kept in `docs/skill-optimiser-design.md` for reference if scope reopens.

---

**Tracking:** The authoritative status and completed milestones live in `docs/status.md`. This roadmap focuses on future-looking decisions.

**Last updated:** 2026-08-29
