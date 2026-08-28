# Skill / support-gem optimiser — design

> **SHELVED 2026-08-28 — out of scope.** The project is passive-skill-tree only; skill gems and
> support gems are immutable calculation inputs. This document (design sketch + the completed
> PoE1-vs-PoE2 assumption audit below) is kept for reference in case scope ever reopens. Nothing
> here is on the roadmap. See `docs/status.md` §Scope.

Design sketch for a second recommender: given a loaded build and an objective (e.g. "maximise
defences and physical damage"), choose which **active skills**, **support gems**, and
**persistent/Spirit skills** to run. Distinct from the passive-tree recommender — different
decision space — but it reuses the same three primitives: the PoB-PoE2 headless calc engine as
the fitness oracle, the `constraints`/`preserveMetrics` feasibility filter from
`src/core/recommendTree.ts`, and the greedy-seed + local-repair scaffold from
`src/core/optimiseTree.ts` (the beam-search track, now complete — see `docs/beam-search-design.md`).

Nothing here is implemented yet. The [Verified against vendored source](#verified-against-vendored-source-2026-08-28)
section records the PoE2-vs-PoE1 assumption audit done before any of this gets coded — same
discipline as `docs/gotchas.md`.

## Shape of the problem

It is a **constrained assignment + knapsack problem wrapped around an expensive, non-linear
objective**. The evaluator is the whole game; everything else is search strategy around it.

### Decision variables

- **Active skills** — main damage skill, movement/travel skill, guard/defensive skill, plus any
  persistent skills (heralds/auras/buffs). In PoB terms: the `gemList` of each entry in
  `build.skillsTab.socketGroupList`, and which one is `mainActiveSkill`.
- **Support assignment** — for each active skill, which supports fill its sockets.
- **Spirit allocation** — which persistent skills to run within the Spirit budget.

### Hard constraints

All grounded in vendored code — but see [Verified against vendored source](#verified-against-vendored-source-2026-08-28):
the oracle enforces almost none of these, so most are constraints **our search** must apply.

- **≤ 5 support gems per skill.** *Self-imposed.* `CalcSetup.lua:2108-2130` only raises a
  non-blocking UI warning past 5; `gemList` is unbounded and the calc applies every support. No
  level / rarity scaling. We cap at 5.
- **A support gem family is used at most once on the character.** *Self-imposed.* The oracle
  dedups `gemFamily` only *within one socket group* (`addBestSupport`, `CalcSetup.lua:502-547`) —
  it will apply the same family to two skills and count both. `Gems.lua` groups tiers by
  `gemFamily` (`"Rapid Attacks"` = Rapid Attacks I/II/III, differ by `Tier` / stat-req). Enforcing
  "one tier of one family, once" in the assignment solver is what keeps this an *assignment*
  problem.
- **Tag applicability.** A support does nothing on a skill it cannot support. The real check is
  `calcLib.canGrantedEffectSupportActiveSkill` (`CalcTools.lua:85-110`): the support's
  `requireSkillTypes` / `excludeSkillTypes` (SkillType postfix expressions) vs the active skill's
  `skillTypes` — **not** raw `tags`. Pre-filter on that; do not spend an evaluator call to
  discover a no-op.
- **Attribute requirements.** *No equip gate.* Support gems have no minimum-stat requirement to
  socket. PoB surfaces an aggregate `output.ReqStr/ReqDex/ReqInt` (support-gem contribution ≈
  `5 × count-of-that-colour` across the whole character) and colours it red when it exceeds
  `Str/Dex/Int`, but it is display-only — never disables a gem or changes a number. At most a
  **soft** `ReqStr/Dex/Int <= Str/Dex/Int` bias in the objective, never a hard filter.
- **Weapon requirements.** Some active gems carry `weaponRequirements` (`Gems.lua`, e.g. Leap Slam
  → `"One Hand Mace, Two Hand Mace"`). Infeasible with the wrong weapon equipped.
- **Spirit budget.** Persistent skills (`skillTypes[SkillType.Persistent]` + `HasReservation`)
  reserve **flat** Spirit via `spiritReservationFlat` (`CalcDefence.lua:215-222`; the `…Percent`
  path has no data). Socketed support gems add their own `spiritReservationFlat` (`sup_*.lua`);
  skill quality can reduce it via `base_(spirit_)reservation_efficiency_+%`.
  `output.SpiritUnreserved` is set unconditionally (`CalcDefence.lua:342`) and goes negative when
  over-reserved (`BuildDisplayStats.lua:140`). `SpiritUnreserved >= 0` drops into `constraints` —
  but wire it through **`keepViolating`** from the start: real builds load already over-reserved.

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

## Verified against vendored source (2026-08-28)

Audit of the five PoE1-vs-PoE2 assumptions before any code — same discipline as `docs/gotchas.md`.
Line refs are into `pob-runtime/PathOfBuilding-PoE2/`. Bottom line: **the oracle enforces almost
none of the "rules" below — most are ours to impose in the search, and the calc will happily
evaluate an illegal gem config without complaint.**

1. **"One support gem per character" — NOT enforced.** Dedup is per-socket-group only.
   `CalcSetup.lua:1740-1748` buckets supports into `supportLists[slotName][group]`;
   `CalcSetup.lua:1908-1912` hands each active skill `appliedSupportList = copyTable(supportLists[
   group] …)`; `addBestSupport` (`CalcSetup.lua:502-547`) dedups only within the list it is passed
   (same `grantedEffect`, overlapping `gemFamily`, or `plusVersionOf`). No character-wide set;
   `GemSelectControl:FilterSupport` (`GemSelectControl.lua:113-124`) has no "already used"
   exclusion; `calcs.createActiveSkill` (`CalcActiveSkill.lua:144`) consumes whatever list it is
   given. → The same support / `gemFamily` **can** apply to two socket groups and both count. The
   "family capacity 1 globally" that makes this an assignment problem is **our** constraint; the
   solver and 2-opt must carry it explicitly, not rely on rejected candidates.

2. **≤ 5 supports per skill — no model at all.** `CalcSetup.lua:2108-2130` counts
   `socketedSupportGems` per group and, `if > 5`, appends the group label to
   `itemWarnings.socketLimitWarning` (surfaced only in the UI, `Build.lua:2210`). The calc still
   applies every socketed support. `socketGroup.gemList` is an unbounded array; no per-gem
   socket-count field is loaded or computed; `Gems.lua` skill entries have no socket count
   (`socketLimit` is item-bases only). No level / rarity scaling anywhere. → Flat 5 is a sane
   self-imposed cap but it is ours; the oracle imposes nothing.

3. **Socket colours — none; there is no equip gate either.** `color = 1|2|3` on a support
   (`sup_str/dex/int.lua`) is just the gem's attribute type. `slotSupportGemSocketsCount = {R,G,B}`
   (`CalcSetup.lua:2106-2163`) feeds only: the aggregate attribute requirement
   (`ReqStr/Dex/Int` includes a `"Support Gems"` row = `5 × count-of-that-colour` across **all**
   socket groups), the `Red/Green/BlueSupportGems` multipliers, and a few notables (Crystallised
   Immunity, Gem Studded, Gemling). That `ReqStr/Dex/Int` value **is** in `mainOutput` (probed:
   `ReqStr=75`, `Str=77` on `Fimozix-L100-ES`) and colour-codes red when unmet — but it is
   **display-only**: an unmet requirement never disables a support or changes any damage / defence
   number, and there is no minimum-stat gate to socket a support in the first place. → No
   colour-matching constraint. If we want realistic colour balance we can read
   `ReqStr/Dex/Int` vs `Str/Dex/Int` as a **soft** signal, but it is optional and the oracle will
   not self-limit ("run 20 int supports" evaluates fine). The exact in-game escalation curve is
   ours to model if we care; PoB approximates it as linear `5 / support`.

4. **Spirit reservation — flat only, confirmed in `mainOutput`.** `CalcDefence.lua:215-222` reads
   `spiritReservationFlat`; a `spiritReservationPercent` path exists but **zero** skill-data
   entries populate it (dead / future). Persistent skills carry `spiritReservationFlat` per gem
   level (`act_*.lua`; Herald of Ash = 30 flat at all levels) and **support gems carry their own
   `spiritReservationFlat`** (`sup_*.lua`; 10/15/20/30/40) that adds when socketed on a reserving
   skill, via `skillModList:Sum("BASE", skillCfg, "ExtraSpirit")`. Quality / alt-quality on some
   skills gives `base_(spirit_)reservation_efficiency_+%` — a flat-percent reduction (the "0 to
   −10% from quality" case), flowing through `SpiritReservationEfficiency` / `ReservationEfficiency`
   mods. `output.SpiritUnreserved = Spirit − reserved` is set **unconditionally**
   (`CalcDefence.lua:336-342`), unlike `TotalEHP`; probed live it reads `-80` on an over-reserved
   build. `SpiritUnreservedPercent` is only set when `Spirit > 0`. → `SpiritUnreserved >= 0` drops
   straight into `constraints` — but real builds can load **already** violating it (the probe build
   does), so it needs `keepViolating` semantics from day one, not a hard gate. "Which skills
   reserve" = `skillTypes[SkillType.Persistent]` + `SkillType.HasReservation`, not a name match.

5. **Gem level / quality — plain build-file inputs, no calc-time gate.** `SkillsTab.lua:348-349`
   reads `level` / `quality` verbatim from `<Gem>`; `calcLib.validateGemLevel`
   (`CalcTools.lua:42-58`) only clamps to `1..#grantedEffect.levels` / `naturalMaxLevel`;
   `ProcessGemLevel`'s character-level cap (`SkillsTab.lua:1197-1232`) is UI default-population
   only and never runs inside `BuildOutput()`. The bridge can set any in-range value and the
   oracle evaluates it. Realistic bounds: **quality 0-20 in steps of 5, level max 20 (21 if
   corrupted)**; corruption can also alter gem stats — **not worth modelling**. → Decision-variable
   or not is purely our scope call. **v1: treat as fixed input** (use the loaded values); revisit
   later. If varied, bound level ≤ 20 (21 corrupted) and quality ∈ {0,5,10,15,20}.

### Net changes to the plan above

- Drop the **support-socket-colour** constraint entirely (#3).
- The **≤ 5 / skill** cap (#2) and **support-family-once-per-character** rule (#1) are ours to
  enforce in the assignment solver + 2-opt — the oracle accepts illegal configs silently.
- **Attribute requirements** (#3): no equip gate; at most a soft `ReqStr/Dex/Int <= Str/Dex/Int`
  bias, not a hard filter.
- **Spirit** (#4): wire `keepViolating` for `SpiritUnreserved` from the start; remember supports
  and quality both move the reservation number.
- **Tag applicability**: the real check is `calcLib.canGrantedEffectSupportActiveSkill`
  (`CalcTools.lua:85-110`) — `requireSkillTypes` / `excludeSkillTypes` (SkillType expressions)
  against the active skill's `skillTypes`, **not** raw gem `tags`. Pre-filter on that.
