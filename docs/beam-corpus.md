# Beam-search benchmark corpus

The set of PoB-PoE2 build XMLs the tree-planner approach benchmark (`spike/benchTreeApproaches.ts`,
design step 9) runs against. The design (`docs/beam-search-design.md` → Corpus) calls for **8–15**
builds spanning defence layers, damage types, and spare-point counts, including ≥1 hand-tuned
(repair must return ≈no change), ≥1 deliberately naive (repair must improve it), and a held-out
subset never used while tuning `K` / `W` / `D`.

**This is not there yet — 6 local builds. Blood Mage still reports `TotalDPS = 0` headless (likely
a stale `mainSocketGroup`, see below); both Monk builds were fixed 2026-08-27.** Adding builds is
a standing task: drop an XML in `D:/My Documents/Path of Building (PoE2)/Builds`, run
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
| MA-FlickerStrike | Monk | 92 | 98/123 (25 spare) | 8 | 89769 | 17584 | 1703 | 2373 | 814 | 9050 | 77 | 55 | 75 | 25 | evasion/ES hybrid | **naive** (user deliberately gutted the tree) | no |
| Martial Artist - Shattering Palm + Flicker Strike | Monk | 92 | 113/123 (10 spare) | 8 | 185998 | 24958 | 1462 | 3557 | 814 | 11371 | 77 | 60 | 75 | 25 | evasion/ES hybrid | **hand-tuned** (the strong player's build) | no |

\* `pointsMax` 123 is always the L100 endgame cap (`99 + questPoints + extra`), not the character's
real current budget — for a L37 the in-game budget is ~40-55. Always pass an explicit
`pointBudget` for this build; the 89 "spare" is not real.

Both Monk builds compute real headless DPS now (2026-08-27 s3). Two fixes were needed and are
described in the note below: (a) a stale `mainSocketGroup` on the hand-tuned build — cleared by a
fresh PoE2 re-import, now points at the Flicker Strike group; (b) no weapon in the active
`Weapon 1` slot on `MA-FlickerStrike` (the Sinister Quarterstaff sat on `Weapon 1 Swap`) — the
XML was hand-patched to move it into `Weapon 1`.

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

- **Two independent causes of headless `TotalDPS = 0` on these builds, both now fixed:**
  1. **Stale `mainSocketGroup`.** PoB's GUI lets you click a live main socket group; the *saved*
     attribute can point at a group with no damaging active skill (here group 3 — a Spirit-Vessel
     buff group). Headless honours it literally → 0 DPS. On the hand-tuned build a fresh PoE2
     re-import cleared this (`mainSocketGroup` now 6 = Flicker Strike), giving `TotalDPS ≈ 186k`.
  2. **No weapon in the active `Weapon 1` slot.** `MA-FlickerStrike` had its Sinister Quarterstaff
     ("Onslaught Song", item id 4) parked on `Weapon 1 Swap` with `useSecondWeaponSet="false"`, so
     the active weapon set was empty and Flicker Strike (an attack) produced no hits →
     `TotalDPS`/`Speed`/`AverageDamage` all *undefined*. Fix (either works, identical result
     ≈ 89.8k DPS): set `useSecondWeaponSet="true"`, or move item 4 into the `Weapon 1` slot. The
     XML was hand-patched with the latter. (The hand-tuned build has the same weapon-on-swap
     layout but still computes fine — the empty-primary fallback behaves differently there;
     didn't chase down why since both now produce DPS.)
  **Blood Mage still needs checking** — likely cause 1.
- **Validation pair ready.** `MA-FlickerStrike` (naive, gutted tree, ~90k DPS, 25 spare) vs
  `Martial Artist - Shattering Palm + Flicker Strike` (hand-tuned, ~186k DPS, 10 spare) — same
  class, so step 11 can frame it as "same character, tuned vs gutted". Both now work under a DPS
  or EHP objective.
- **Spare-point spread is narrow:** one build at 23 spare, three at 10. The constraint-rejection
  work found the interesting repair behaviour only shows up at ~20+ spare, so most of the current
  corpus can't exercise repair meaningfully. Need mid-level builds (30–60 spare) and a couple of
  near-complete ones.
- **Hand-tuned vs naive pair exists** — `Martial Artist - Shattering Palm + Flicker Strike`
  (hand-tuned) vs `MA-FlickerStrike` (naive) and, separately, the deliberately-gutted `Ranger
  (L37)`. `MA-FlickerStrike` has 31 spare so it can exercise a real re-spend; the hand-tuned Monk
  has 10. Both Monk builds need a working DPS config (see above) before the "repair returns ≈no
  change on a tuned build" regression can run on `TotalDPS`.
- **No held-out subset.** Once the corpus is ≥8, reserve ~⅓ and never look at them while tuning K/W/D.
