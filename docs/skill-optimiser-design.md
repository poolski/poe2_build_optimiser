# Skill / support-gem optimiser — design

Design sketch for a second recommender: given a loaded build and an objective (e.g. "maximise
defences and physical damage"), choose which **active skills**, **support gems**, and
**persistent/Spirit skills** to run. Distinct from the passive-tree recommender — different
decision space — but it reuses the same three primitives: the PoB-PoE2 headless calc engine as
the fitness oracle, the `constraints`/`preserveMetrics` feasibility filter from
`src/core/recommendTree.ts`, and the greedy-seed + local-repair scaffold from
`src/core/optimiseTree.ts` (the beam-search track, now complete — see `docs/beam-search-design.md`).

Nothing here is implemented yet. The [Must verify first](#must-verify-first) section lists the
PoE2-vs-PoE1 assumptions that have to be checked against vendored data before any of this gets
coded — same discipline as `docs/gotchas.md`.

## Shape of the problem

It is a **constrained assignment + knapsack problem wrapped around an expensive, non-linear
objective**. The evaluator is the whole game; everything else is search strategy around it.

### Decision variables

- **Active skills** — main damage skill, movement/travel skill, guard/defensive skill, plus any
  persistent skills (heralds/auras/buffs). In PoB terms: the `gemList` of each entry in
  `build.skillsTab.socketGroupList`, and which one is `mainActiveSkill`.
- **Support assignment** — for each active skill, which supports fill its sockets.
- **Spirit allocation** — which persistent skills to run within the Spirit budget.

### Hard constraints (all grounded in vendored code)

- **≤ 5 support gems per skill.** `pob-runtime/PathOfBuilding-PoE2/src/Modules/CalcSetup.lua:2125`
  (`if socketedSupportGems > 5 then` … warn). Verify whether PoE2 skill gems have a *lower* innate
  cap that scales with gem level — `CalcSetup` is counting gear sockets there, which may be
  leftover model (see Must verify).
- **A support gem family is used at most once on the character.** `src/Data/Gems.lua` groups
  supports by `gemFamily` (e.g. `"Rapid Attacks"` covers Rapid Attacks I/II/III, which differ only
  by `Tier` and stat-req). You pick at most one tier of one family, and — assuming the PoE1 "one
  support per character" rule still holds in this fork — not on two skills at once. This
  uniqueness is what makes it a genuine *assignment* problem, not N independent choices.
- **Tag applicability.** A support does nothing on a skill it does not tag-match. `Gems.lua`
  `tags` on the support (`attack`, `projectile`, `physical`, `melee`, …) vs the active skill's
  `tags`. Pre-filter on this; do not spend an evaluator call to discover a no-op.
- **Attribute requirements.** `reqStr` / `reqDex` / `reqInt` per gem in `Gems.lua`. Higher-tier
  supports in a family cost more attribute. The candidate build must actually meet them.
- **Weapon requirements.** Some active gems carry `weaponRequirements` (`Gems.lua`, e.g. Leap Slam
  → `"One Hand Mace, Two Hand Mace"`). Infeasible with the wrong weapon equipped.
- **Spirit budget.** Persistent skills reserve Spirit via `spiritReservationFlat` /
  `spiritReservationPercent` (`src/Modules/CalcDefence.lua:216-221`). `SpiritUnreserved` /
  `SpiritUnreservedPercent` are output stats and go negative when over-reserved
  (`src/Modules/BuildDisplayStats.lua:140`, with a `warnFunc`). So `SpiritUnreserved >= 0` drops
  straight into the existing `constraints` map — no new feasibility code.
- **Support socket colour**, if this fork still colours skill-gem sockets
  (`slotSupportGemSocketsCount = { R, G, B }`, `CalcSetup.lua:2106`). See Must verify.

## Objective

"Defences + physical damage" is multi-objective, and "defences" is itself a vector (life,
armour/evasion, capped resistances, block). Two moves make it tractable:

1. **Collapse defences to a single EHP number** for an assumed incoming-damage profile
   (phys / elemental / chaos hit split + DoT). `TotalEHP` from `CalcDefence.lua` (~L3385) is the
   basis; the recommender already treats it as possibly-absent and skips rather than zeroing
   (per `feedback-verify-poe2-vs-poe1-assumptions`). Now you are optimising a 2-vector
   `(EHP, phys_dps)` instead of a 6-vector.
2. **Then either:**
   - **weighted scalar** `w·log(phys_dps) + (1-w)·log(EHP)` with the hard constraints above as a
     feasibility gate — reuses `constraints` / `preserveMetrics` / `keepViolating` verbatim; or
   - **Pareto front** of non-dominated `(EHP, phys_dps)` feasible builds, with a weight slider in
     the UI. Preferred: the phys-vs-defence trade is exactly the call a human should make, and the
     front is small once candidates are pruned.

Log-space matters: PoB "more" multipliers stack multiplicatively, so `log` makes support
contributions roughly additive and lets step 2 of the search below be solved near-exactly.

## The evaluator

Reuse the bridge (`pob-runtime/bridge.lua`, `src/core/bridge.ts`). **Unlike beam search, this
needs new bridge RPCs** — the existing three only mutate the passive tree. Expected additions:

- `list_socket_groups` — dump `socketGroupList`: per group, the active gem(s), socketed supports,
  free socket count, `mainActiveSkill` flag.
- `evaluate_gem_changes` — batched: apply a set of gem-list edits to one or more socket groups,
  `BuildOutput()`, read stats, roll back. Rollback primitive is the open question: the tree side
  uses `PassiveSpec:CreateUndoState()` / `RestoreUndoState()`; the skills tab may need a
  deep-copy-and-restore of `socketGroupList` instead. Watch for a stale-cache trap analogous to
  the `node.path` one in `docs/gotchas.md` — after restoring, force whatever rebuilds
  `displaySkillList` / the mod DB before the next candidate.

Cache evaluations keyed on a canonical hash of the full gem config; local search re-hits
near-duplicates constantly.

## Search pipeline

1. **Prune the candidate pools first.** Biggest single win, same as the tree recommender
   defaulting to Notable+Keystone. For "phys + defence": keep only supports whose `tags` match the
   main skill's delivery *and* are phys/defence-relevant; drop elemental/chaos/minion/curse
   /conversion-away-from-phys supports and every gem family whose best tier the build can't meet
   the attribute req for. `Gems.lua` has ~566 `gemFamily` entries; this should cut the branching
   factor by an order of magnitude.
2. **Fast assignment pass (near-exact).** Measure each surviving support's marginal
   `Δlog(objective)` by adding it *alone* to each candidate skill. Because log-values are roughly
   additive, solve the bipartite assignment (supports ↔ skill sockets; support-family capacity 1,
   skill capacity = free sockets) exactly with min-cost max-flow / Hungarian. Milliseconds, and a
   strong starting config.
3. **Local search with the real evaluator.** 2-opt: try swapping each placed support for each
   unplaced one; keep improvements; iterate to a fixed point. Catches what the log approximation
   misses — downside supports ("less X, more Y"), breakpoints, conversions.
4. **Spirit as a coordinate-descent step.** With supports fixed, 0/1-knapsack the persistent
   skills over the Spirit budget (values from the evaluator with the rest of the build fixed),
   then re-run step 3. Alternate until stable.
5. **Beam search over assignment order** (optional, to escape local optima) — share the scaffold
   with the tree re-optimisation task once it exists.

## Reuse map

| Need | Existing piece |
|------|----------------|
| Fitness oracle | PoB-PoE2 calc engine via `pob-runtime/bridge.lua` + `src/core/bridge.ts` |
| Feasibility gate | `constraints` / `preserveMetrics` / `keepViolating` in `src/core/recommendTree.ts` (incl. absent-metric = skip, not zero) |
| Marginal-gain ranking idiom | `deltaPerPoint` ranking in `recommendTree.ts` |
| Multi-step search scaffold | greedy-seed + local repair in `src/core/optimiseTree.ts` (beam-search track complete — `docs/beam-search-design.md`) |
| CLI shape | `src/cli.ts` flag conventions (`--constraint Metric=n`, `--preserve A,B`, …) |

New code: the two bridge RPCs above, the pool-pruning filter, the assignment solver, the 2-opt +
coordinate-descent driver, and the Pareto-front collector.

## Must verify first

Check against vendored data before writing code — the fork carries live PoE1 leftovers
(`docs/gotchas.md`: `maxWeaponSets`, masteries, `node.path`):

- **The "one support gem per character" rule.** PoE1 forbids the same support on two skills. Grep
  the skills-tab / `CalcSetup` code for a global used-support set before assuming it.
- **Support sockets per skill.** Is it a flat 5 (`CalcSetup.lua:2125`), or does it scale with
  skill-gem level / rarity in PoE2? The `> 5` check may be counting gear sockets from PoE1's
  model.
- **Socket colours.** Do PoE2 skill-gem support sockets have R/G/B colours
  (`slotSupportGemSocketsCount`, `CalcSetup.lua:2106`), or is that dead gear-socket code? If
  colourless, drop the colour constraint entirely.
- **Spirit reservation semantics.** Confirm `spiritReservationFlat` / `spiritReservationPercent`
  are the fields actually populated for PoE2 auras/heralds, and that `SpiritUnreserved` is present
  in `mainOutput` (like `TotalEHP`, it may sit behind a conditional block).
- **Gem levels / quality as decision variables.** In scope or not? If gem level is free to choose,
  it multiplies the search space; if it is fixed by character level / available uncut gems, treat
  it as input.
