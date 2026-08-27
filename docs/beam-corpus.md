# Beam-search benchmark corpus

The set of PoB-PoE2 build XMLs the tree-planner approach benchmark (`spike/benchTreeApproaches.ts`,
design step 9) runs against. The design (`docs/beam-search-design.md` → Corpus) calls for **8–15**
builds spanning defence layers, damage types, and spare-point counts, including ≥1 hand-tuned
(repair must return ≈no change), ≥1 deliberately naive (repair must improve it), and a held-out
subset never used while tuning `K` / `W` / `D`.

**This is not there yet — 4 local builds, and 2 of them report `TotalDPS = 0` headless.** Adding
builds is a standing task: drop an XML in `D:/My Documents/Path of Building (PoE2)/Builds`, run
`npm run characterise-build -- "<path>"`, paste the row below, and fill in the last three columns
by hand.

## Manifest

Metric columns are the loaded-baseline values (rounded). `spare` = `pointsMax − pointsUsed`.

| build | class | lvl | points | asc | TotalDPS | TotalEHP | Life | ES | Armour | Evasion | Fire | Cold | Light | Chaos | defence layer | tuned/naive | held-out |
|---|---|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|---|---|
| Ranger (L37) | Huntress | 37 | 34/123 (89 spare*) | 2 | 662 | 556 | 651 | 67 | 261 | 427 | -60 | -36 | -36 | 18 | evasion/armour | **naive** (nodes deliberately pulled) | no |
| RampantlyBisexual | Ranger | 80 | 100/123 (23 spare) | 6 | 39525 | 4951 | 1168 | 57 | 81 | 7747 | 63 | 51 | 75 | 24 | evasion | ? | no |
| Blood Mage | Witch | 88 | 113/123 (10 spare) | 8 | 0 | 10971 | 2386 | 3263 | 0 | 9 | 75 | 58 | 75 | 13 | life/ES | ? | no |
| Flicker Strike Invoker | Monk | 92 | 113/123 (10 spare) | 8 | 20428 | 25664 | 1462 | 3555 | 814 | 10309 | 79 | 60 | 75 | 39 | evasion/ES hybrid | ? | no |
| MA-FlickerStrike | Monk | 92 | 113/123 (10 spare) | 8 | 185998 | 24958 | 1462 | 3557 | 814 | 11371 | 77 | 60 | 75 | 25 | evasion/ES hybrid | **hand-tuned** (strong player's build) | no |
| ~~Martial Artist (Shattering Palm + Flicker)~~ | Monk | 92 | 113/123 | 8 | 0 | 24958 | — | — | — | — | — | — | — | — | — | superseded by MA-FlickerStrike | — |

\* `pointsMax` 123 is always the L100 endgame cap (`99 + questPoints + extra`), not the character's
real current budget — for a L37 the in-game budget is ~40-55. Always pass an explicit
`pointBudget` for this build; the 89 "spare" is not real.

## Extend-mode observation (Ranger L37, `optimise-tree-spike`)

The gutted L37 Ranger is a clean extend-mode demo — a deliberately sub-optimal tree with big-value
notables sitting just outside the current frontier. Greedy walk on `TotalDPS`:

| proximity K | plan | DPS | recomputes | wall |
|--:|---|--:|--:|--:|
| 2 (budget +8) | Catalysis, Eagle Eye, Stalk and Leap (6 pts) | 662 → 860 (+30%) | 57 | 11s |
| 4 (budget +12) | Stand and Deliver, Catalysis, Cooked, Eagle Eye (11 pts) | 662 → 1385 (+109%) | 255 | 52s |

Quality is very K-sensitive here: the top pick at K=4 ("Stand and Deliver", +89.7/pt) is 3
path-points out and invisible at K=2. Cost scales ~K². Note K=4 step 3 ("Cooked": +60% crit
bonus, −25% armour/evasion/ES) — a defence-blind `TotalDPS` objective takes the downside happily;
a `dps-ehp` blend or a `--preserve Evasion` floor would reject it. Good constraint/blend demo build.

## Known gaps / notes

- **`TotalDPS = 0` was a stale `mainSocketGroup` pointer, not a headless limitation.** The
  original "Shattering Palm + Flicker Strike" XML saved `mainSocketGroup="3"` / `mainActiveSkill="1"`,
  and group 3 is a persistent-buff group (Spirit Vessel + minion supports) with *no damaging
  active skill* — so headless correctly computes 0. PoB's GUI lets you click a live main group;
  the saved pointer goes stale. Fix: repoint `mainSocketGroup` at the real attack group and move
  `mainActiveSkill="1"` onto that group's `<Skill>` header. `MA-FlickerStrike.xml` (group 6) does
  this → `TotalDPS ≈ 186k`. Group 10 (Shattering Palm, a debuff-applier) only gives ≈ 7.1k.
  **Blood Mage still needs checking** — likely the same stale-pointer issue.
- **Spare-point spread is narrow:** one build at 23 spare, three at 10. The constraint-rejection
  work found the interesting repair behaviour only shows up at ~20+ spare, so most of the current
  corpus can't exercise repair meaningfully. Need mid-level builds (30–60 spare) and a couple of
  near-complete ones.
- **Hand-tuned vs naive pair now exists** — `MA-FlickerStrike` (hand-tuned, ~186k DPS) pairs with
  the deliberately-gutted `Ranger (L37)`. Both are low-spare (10 / needs explicit budget), so the
  pair proves direction of change, not big-headroom repair behaviour.
- **No held-out subset.** Once the corpus is ≥8, reserve ~⅓ and never look at them while tuning K/W/D.
