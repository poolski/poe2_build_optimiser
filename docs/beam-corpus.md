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
| RampantlyBisexual | Ranger | 80 | 100/123 (23 spare) | 6 | 39525 | 4951 | 1168 | 57 | 81 | 7747 | 63 | 51 | 75 | 24 | evasion | ? | no |
| Blood Mage | Witch | 88 | 113/123 (10 spare) | 8 | 0 | 10971 | 2386 | 3263 | 0 | 9 | 75 | 58 | 75 | 13 | life/ES | ? | no |
| Flicker Strike Invoker | Monk | 92 | 113/123 (10 spare) | 8 | 20428 | 25664 | 1462 | 3555 | 814 | 10309 | 79 | 60 | 75 | 39 | evasion/ES hybrid | ? | no |
| Martial Artist (Shattering Palm + Flicker) | Monk | 92 | 113/123 (10 spare) | 8 | 0 | 24958 | 1462 | 3557 | 814 | 11371 | 77 | 60 | 75 | 25 | evasion/ES hybrid | ? | no |

## Known gaps / notes

- **`TotalDPS = 0` on Blood Mage and Martial Artist.** Headless produces no DPS for these (main
  skill needs config PoB's GUI supplies, or `mainActiveSkill` isn't what's expected). They're
  usable only with an EHP-only objective right now; a DPS or `dps-ehp` blend objective will
  *throw* on them (the step-6 baseline guard — `positiveFinite(0)` is null). Fixing = pinning a
  working skill/config in the XML before adding to a DPS run.
- **Spare-point spread is narrow:** one build at 23 spare, three at 10. The constraint-rejection
  work found the interesting repair behaviour only shows up at ~20+ spare, so most of the current
  corpus can't exercise repair meaningfully. Need mid-level builds (30–60 spare) and a couple of
  near-complete ones.
- **No hand-tuned vs naive pair yet.** The regression test ("repair returns ≈no change on a tuned
  build") needs at least one build a strong player has optimised and one deliberately sub-optimal
  (e.g. a real tree with 10 points spent on a dead-end cluster).
- **No held-out subset.** Once the corpus is ≥8, reserve ~⅓ and never look at them while tuning K/W/D.
