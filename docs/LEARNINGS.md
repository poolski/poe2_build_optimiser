<!-- generated-by: groundrules v1.10.0 -->
# Learnings

Non-obvious insights, patterns, and gotchas discovered during development. A living record of what works and what doesn't.

## PoB-PoE2 compatibility

- **PoB has PoE1 leftovers.** The PoE2 fork vendored data from an older PoE1 build. Always verify assumptions against real PoB behaviour before shipping.
- **Weapon-swap points matter.** Builds can allocate different passive nodes per weapon set. The "spare points" calculation must account for `min(weaponSet1PointsUsed, weaponSet2PointsUsed)` — the intersection, not the union.
- See `docs/gotchas.md` for the full list of known quirks.

## Optimization strategy

- **Leaf-only repair was too narrow.** Initial design only freed terminal (leaf) nodes. Real optimization needs any-node removal (interior nodes often hold long dead-path chains). Cascading deallocation (`DeallocNode`) safely frees connected subtrees.
- **Greedy is sufficient for passive trees.** Despite early beam-search planning, the default `beamWidth=1` (greedy) has been proven optimal on a 25-build corpus. Beam width > 1 remains open but non-blocking.
- **Defense floor prevents overfitting.** Without a floor on defensive metrics (life, evasion, energy shield), repair can "fix" a build by enabling Chaos Inoculation (no life cap) and reallocating life nodes. Always preserve at least one defensive metric.

## Performance insights

- **LuaJIT children are expensive.** Each process holds ~700 MB resident. The default pool size is half the system's available cores (floor 1), not all cores.
- **Parallel evaluation is a win.** Phase 1.5 parallelizes candidate evaluation across the pool within a single run. This is the real wall-time win for large repair budgets.
- **Memoization is not the bottleneck.** Layer-5 (per-allocation-set) cache hit rates are ~0% in greedy search — greedy never reconverges to the same allocation. Cache is still there for future algorithm variants.

## Testing discipline

- **Integration tests are expensive.** `npm test` runs fast unit tests against fake bridges (no LuaJIT). `npm run test:integration` runs against real bridges — slow (~4 min), high memory. Keep integration tests in `*.integration.test.ts` files so they stay out of the default suite.
- **Any new test that boots a real bridge goes in the integration suite.** This split was introduced after end-to-end optimiser runs leaked into the fast suite.

## Design patterns

- **Core receives a bridge, never constructs one.** `src/core` is pure business logic; bridge construction lives at the edges (CLIs, API server).
- **Source-level aliases over build steps.** Cross-package imports resolve through `tsconfig.base.json` `paths` and vitest aliases — no build step, no TypeScript project references.

## Documentation

- Living status is in `PLAN.md` — it's the authoritative map. Keep it current.
- Design + implementation checklist lives in `intake/beam-search-design.md`.
- Phase-by-phase development specs are in `intake/web-ui/` (01 through 10).
- Decisions of record are in `docs/decisions/` (ADR-001 … ADR-011).

---

**Last updated**: 2026-08-29

To add a learning: describe the non-obvious insight, link relevant code or docs, and explain the consequence (what we do differently now).
