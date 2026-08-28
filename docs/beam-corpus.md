# Beam-search benchmark corpus

The set of PoB-PoE2 build XMLs the tree-planner approach benchmark (`spike/benchTreeApproaches.ts`,
design step 9) runs against. The design (`docs/beam-search-design.md` → Corpus) calls for **8–15**
builds spanning defence layers, damage types, and spare-point counts, including ≥1 hand-tuned
(repair must return ≈no change), ≥1 deliberately naive (repair must improve it), and a held-out
subset never used while tuning `K` / `W` / `D`.

**6 hand-authored local builds + 14 pulled off poe.ninja (2026-08-28, see §poe.ninja pull).**
Blood Mage and `BlandisThree` (poe.ninja) report `TotalDPS = 0` headless; both Monk builds were
fixed 2026-08-27. Adding local builds is a standing task: drop an XML in
`D:/My Documents/Path of Building (PoE2)/Builds`, run `npm run characterise-build -- "<path>"`,
paste the row below, fill in the last three columns by hand. To refresh the poe.ninja set, edit
the `TARGETS` array in `spike/fetchNinjaBuilds.ts` and `npm run fetch-ninja-builds`.

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

## poe.ninja pull (Runes of Aldur, latest snapshot, 2026-08-28)

`spike/fetchNinjaBuilds.ts` (`npm run fetch-ninja-builds`) hits poe.ninja's per-character endpoint
(`/poe2/api/builds/<version>/character?account=…&name=…`), whose `pathOfBuildingExport` field is a
plain PoB import code (`base64(zlib(xml))`), decodes it, and writes the XML into
`D:/My Documents/Path of Building (PoE2)/Builds/ninja/`. The 14 characters were hand-picked from
the ladder table to span optimisation tiers and (the little) level range the ladder offers.

**The ladder only tracks level 80+**, so there is no true low-level build here — the "weak" tier
is level-80-100 characters with bad trees/gear instead (low DPS and/or low EHP), which is the
naive-build analogue the design wants.

Rows below are `npm run characterise-build` output (headless, vendored PoB). `class` is the
ascendancy; base class in parens.

| build (file in `ninja/`) | class | lvl | points | asc | TotalDPS | TotalEHP | Life | ES | Armour | Evasion | Fire | Cold | Light | Chaos | defence layer | tier | held-out |
|---|---|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|---|---|
| stillAengus-L100-46M | Pathfinder (Ranger) | 100 | 155/129 (−26) | 8 | 46,035,274 | 26,324 | 1516 | 4427 | 0 | 8596 | 57 | 75 | 75 | 44 | evasion/ES, thin | **strong** | no |
| TechnoIceShot-L100-28M | Pathfinder (Ranger) | 100 | 154/129 (−25) | 8 | 28,320,252 | 66,053 | 1523 | 4253 | 2079 | 29328 | 75 | 75 | 76 | 65 | evasion | **strong** | yes |
| Venereable-L100-13M | Gemling Legion. (Merc) | 100 | 124/123 (−1) | 8 | 13,631,739 | 33,864 | 1718 | 0 | 228 | 242 | 75 | 75 | 75 | 35 | life only, thin | **strong** | no |
| HuntressTank-L100-5.8M | Spirit Walker (Huntress) | 100 | 150/123 (−27) | 8 | 5,753,051 | 156,083 | 1623 | 7263 | 0 | 27350 | 75 | 75 | 75 | 75 | evasion, huge EHP | **strong** | yes |
| Fimozix-L100-ES | Gemling Legion. (Merc) | 100 | 144/123 (−21) | 8 | 2,477,047 | 103,956 | 1 | 11031 | 1787 | 14868 | 75 | 75 | 75 | 37 | ES/evasion (CI) | **strong** | no |
| KinkyDommyMommy-L92-glass | Infernalist (Witch) | 92 | 140/123 (−17) | 8 | 1,166,933 | 11,728 | 1504 | 4237 | 768 | 9 | 75 | 71 | 74 | 69 | ES, thin | mid | no |
| TheTradie-L84-400k | Martial Artist (Monk) | 84 | 108/123 (15) | 8 | 400,862 | 28,030 | 1437 | 4755 | 0 | 13832 | 50 | 43 | 46 | 5 | evasion | mid (decent for lvl) | no |
| JiduQiuliang-L100-glass | Spirit Walker (Huntress) | 100 | 148/123 (−25) | 8 | 77,651 | 5,218 | 1535 | 2443 | 75 | 114 | 77 | 52 | 77 | 0 | none — pure glass | **weak** | no |
| QingCum-L100-nodmg | Witchhunter (Merc) | 100 | 128/123 (−5) | 8 | 57,242 | 75,924 | 1741 | 53 | 17313 | 91 | 74 | 74 | 74 | 75 | armour tank | **weak** (no dmg) | no |
| dosesondoses-L84-ES | Lich (Witch) | 84 | 115/123 (8) | 8 | 36,786 | 26,679 | 1443 | 9940 | 0 | 10 | 75 | 75 | 75 | 29 | ES | mid | yes |
| furufuru-L100-weak | Titan (Warrior) | 100 | 116/123 (7) | 8 | 5,018 | 22,691 | 2858 | 0 | 20707 | 10 | 75 | 75 | 75 | 75 | armour | **weak** | no |
| R_Thor-L84-weak | Smith of Kitava (Warrior) | 84 | 121/123 (2) | 6 | 5,514 | 20,947 | 2687 | 0 | 10328 | 444 | 75 | 75 | 75 | 75 | armour | **weak** | no |
| SnusInMyBlood-L100-weak | Spirit Walker (Huntress) | 100 | 147/123 (−24) | 8 | 4,339 | 8,520 | 1836 | 694 | 172 | 6375 | 70 | 37 | 37 | 36 | evasion, bad res | **weak** | yes |
| BlandisThree-L92-tank | Spirit Walker (Huntress) | 92 | 115/123 (8) | 8 | **0** | 185,566 | 2461 | 1429 | 309 | 8125 | 75 | 75 | 75 | 73 | evasion, huge EHP | 0-DPS headless | no |

### Caveats before these go into `benchTreeApproaches.ts` CORPUS

- **`pointsUsed` > `pointsMax` on 9 of 14** (e.g. `155/129`, `150/123`). poe.ninja's export
  allocates more tree nodes than the L100 endgame budget the optimiser assumes, so "spare" comes
  out negative and extend mode has no room. Likely the two **weapon-set passive trees** (PoE2 has
  a separate ~20-node tree per weapon set — `passiveSelectionSet1/2` in the ninja JSON) being
  summed into `pointsUsed`, and/or ascendancy/anoint nodes double-counted; `pointsMax` also
  wandering (123 vs 129) points the same way. **Must reconcile point accounting before extend-mode
  numbers on these mean anything.** Repair mode (free N leaves, re-spend) and any run with an
  explicit `--point-budget` are unaffected. The 5 builds with real positive spare —
  `TheTradie` (15), `dosesondoses` (8), `BlandisThree` (8), `furufuru` (7), `R_Thor` (2) — are
  usable as-is but none has the ≥20 spare the constraint-repro needed.
- **`BlandisThree` = 0 DPS headless** (ladder shows 70k). Same class/skill family as the other
  Spirit Walkers here that *do* compute, so likely a stale `mainSocketGroup` or weapon-slot issue
  like the Monk builds had (see note above) — not yet chased down. Skip under a DPS objective.
- **DPS otherwise tracks the ladder well** — 13 of 14 land within rounding of the poe.ninja DPS
  column, so the headless calc + vendored data are behaving on real-world builds.
- **Held-out subset** (marked `yes` above): `TechnoIceShot`, `HuntressTank`, `dosesondoses`,
  `SnusInMyBlood` — one strong evasion, one strong tank, one mid ES, one weak. Never tune
  `K`/`W`/`D` against these.

## Synthetic gutting (`spike/gutBuild.ts`, `npm run gut-build`)

Takes a strong source XML and deallocates N passive-tree leaves, producing a build with real
spare points **and a ground-truth recovery target** (the original). The benchmark can then score
repair/extend as *fraction of the lost objective recovered* —
`(repaired − gutted) / (original − gutted)` — rather than an open-ended lift %.

```
npm run gut-build -- "<source.xml>" [--points N] [--policy random|low|high] [--seed S] [--objective SPEC] [--out DIR]
```

- Only **leaf** `Normal`/`Notable`/`Keystone` nodes are pulled (a leaf frees exactly 1 point;
  `DeallocNode` cascades otherwise). Sockets, masteries, ascendancy are never touched.
- Re-loads the XML each round so the leaf set is recomputed against the shrinking tree.
- **`--policy`** picks *which* leaf each round: `random` (seeded — realistic "player drifted"),
  `low` (removal costs the objective least — easy recovery / dead points to relocate),
  `high` (removal costs the objective most — hard recovery, honest ceiling).
- Writes `<name>-gut<N>-<policy>.xml` + a `.json` sidecar (source, `removedNodes`, per-step
  objective, `original` vs `gutted` baseline, `gapToRecover`) into `<source-dir>/gutted/`.
- **Don't gut with `low` and then benchmark "fraction recovered"** — `low` leaves the objective
  ~unchanged (`gapToRecover ≈ 0`) and the optimiser can legitimately *beat* the original by
  relocating the dead points, so "original" isn't a ceiling. Use `random`/`high` for the
  recovery-fraction framing; `low` is a separate "does it relocate wasted points" case.
- **On the over-allocated ninja builds, pass a bigger `--points`.** `stillAengus` at `155/129`
  needs `--points ~45` to reach ~15 spare; `Venereable` at `124/123` only needs ~25. `low` on
  `TheTradie` already showed it carries ~8 objective-dead notables (a Daze package the calc
  config doesn't credit) — `low` will happily pull those first on any build.

### First batch (2026-08-28, `--objective dps-ehp:0.5`)

In `…/Builds/ninja/gutted/`. All re-`characterise-build` cleanly (round-trip verified).

| gutted file | source | policy | pts | spare | score | gap | TotalDPS | TotalEHP |
|---|---|---|---|--:|--:|--:|--:|--:|
| — (source) | TheTradie-L84-400k | — | 108/123 | 15 | 11.571 | — | 400,862 | 28,030 |
| TheTradie-L84-400k-gut8-low | ″ | low | 100/123 | 23 | 11.571 | **0.00** | 400,862 | 28,030 |
| TheTradie-L84-400k-gut25-random | ″ | random s1 | 83/123 | 40 | 11.089 | **0.48** | 241,280 | 17,757 |
| TheTradie-L84-400k-gut25-high | ″ | high | 83/123 | 40 | 10.800 | **0.77** | 157,936 | 15,229 |
| — (source) | Venereable-L100-13M | — | 124/123 | −1 | 13.429 | — | 13,631,739 | 33,864 |
| Venereable-L100-13M-gut25-random | ″ | random s1 | 99/123 | 24 | 12.234 | **1.19** | 4,798,094 | 8,819 |
| Venereable-L100-13M-gut25-high | ″ | high | 99/123 | 24 | 12.077 | **1.35** | 5,784,729 | 5,345 |

`gap` is `original.score − gutted.score` in blend units — the amount repair/extend has to claw
back. `low` on TheTradie confirmed it: 8 objective-dead notables gone, build otherwise identical
(a Daze package the calc config doesn't credit). `random`/`high` produce real gaps with 24–40
spare. Note `high` on Venereable *keeps more DPS* than `random` (5.78M vs 4.80M) while gutting EHP
harder (5.3k vs 8.8k) — `high` maximises the *blend*-score drop, and here that's cheaper via EHP.
`random` round 1 on Venereable pulled the Eldritch Battery keystone (−0.22).

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
- **Spare-point spread is still narrow.** Local builds: one at 23 spare, three at 10. The
  poe.ninja pull did *not* fix this — its exports over-allocate (negative spare, see that section's
  caveats), and the 5 with positive spare top out at 15. The constraint-rejection work found the
  interesting repair behaviour only shows up at ~20+ spare. Still need genuine mid-level builds
  (30–60 spare); the ladder can't supply them (level 80+ only). Best remaining source is
  hand-levelled local characters or reconciling the poe.ninja point accounting.
- **Hand-tuned vs naive pair exists** — `Martial Artist - Shattering Palm + Flicker Strike`
  (hand-tuned) vs `MA-FlickerStrike` (naive) and, separately, the deliberately-gutted `Ranger
  (L37)`. `MA-FlickerStrike` has 31 spare so it can exercise a real re-spend; the hand-tuned Monk
  has 10. Both Monk builds need a working DPS config (see above) before the "repair returns ≈no
  change on a tuned build" regression can run on `TotalDPS`.
- **Held-out subset** now marked in the poe.ninja table: `TechnoIceShot`, `HuntressTank`,
  `dosesondoses`, `SnusInMyBlood`. Never look at them while tuning K/W/D. The local builds are all
  in-play (they predate this split).
