# Live constraint-rejection repro

The constraint-aware ranking in `src/core/recommendTree.ts` (commit `3487106`) had unit coverage
only -- its reject branch (`firstConstraintViolation`) had never been observed firing against real
PoB-PoE2 calc output. This is that observation, end to end through the CLI.

## Build

`RampantlyBisexual.xml` -- Ranger / Deadeye, level 80, **23 unspent passive points**, baseline:

| metric | value |
|---|---|
| TotalDPS | 39525.48 |
| Evasion | 7747 |
| Life | 1168 |
| Mana | 588 |
| FireResist / ColdResist / LightningResist | 63 / 51 / 75 |

The spare-point count matters: a distant keystone drags ~8-23 path nodes in via `AllocNode`, and
`recommendTree` skips any candidate whose real `pointsSpent` exceeds points available *before* the
constraint check runs. The Blood Mage / Flicker Invoker samples only have 10 spare points, which
is why earlier hunts on them surfaced no violator -- the interesting keystones were point-skipped,
not constraint-clean.

## The canonical case: Iron Reflexes vs. `--preserve Evasion`

Iron Reflexes ("Converts all Evasion Rating to Armour"), 8 path points.

```bash
B="D:/My Documents/Path of Building (PoE2)/Builds/RampantlyBisexual.xml"

# RUN 1 -- no constraints
npx ts-node src/cli.ts "$B" --node-types Keystone --target TotalDPS --top 12

# RUN 2 -- floor Evasion at its current value, keep violators visible
npx ts-node src/cli.ts "$B" --node-types Keystone --target TotalDPS --top 12 --preserve Evasion --keep-violating

# RUN 3 -- same floor, default drop behaviour
npx ts-node src/cli.ts "$B" --node-types Keystone --target TotalDPS --top 12 --preserve Evasion
```

`--node-types Keystone` restricts the pool so the run finishes in seconds. The full default
Notable+Keystone pool on this build does not finish inside two minutes (matches the perf note in
`gotchas.md`); the violation surfaces identically either way, the keystone-only pool is just the
fast reproducible slice.

### Observed output

**RUN 1** -- Iron Reflexes is the **#1 recommendation**:

```
Iron Reflexes (Keystone) -- 8 pt(s)
  delta: 1260.51  (157.56/pt)
  - Converts all Evasion Rating to Armour
```

**RUN 2** -- still ranked #1, now flagged (the `constraintViolation` field is populated):

```
Iron Reflexes (Keystone) -- 8 pt(s)
  delta: 1260.51  (157.56/pt)
  ! violates Evasion: 7747.00 -> 0.00 (floor 7747)
  - Converts all Evasion Rating to Armour
```

`metric = Evasion`, `floor = 7747` (baseline-derived, from `--preserve`), `baseline = 7747`,
`candidate = 0`. This is the `brokeCap` branch: `base >= floor && cand < floor`.

**RUN 3** -- Iron Reflexes is dropped entirely. Giant's Blood (same +1260.51 delta, 15 pt, no
evasion downside) takes #1, and Wildsurge Incantation is pulled up into the bottom of the top-12
to backfill the dropped row.

### Cross-check against the raw calc

Direct `evaluate_candidate_nodes` on Iron Reflexes reports `Evasion 7747 -> 0`,
`Armour 81 -> 1137`, `TotalEHP 4950.6 -> 2639.0` -- consistent with the node's own text
("all Evasion Rating to Armour"). The metric moved for the reason the code assumes, and it landed
on an exact `0.0` (no float dust -- exact comparison held, no epsilon needed here).

## Other live violators on the same build

All via `--node-types Keystone --keep-violating`:

| keystone | pts | constraint | movement | branch |
|---|---|---|---|---|
| Iron Reflexes | 8 | `--preserve Evasion` | 7747 -> 0 | brokeCap |
| Chaos Inoculation | 10 | `--preserve Life` | 1168 -> 1 | brokeCap |
| Blood Magic | 23 | `--preserve Mana` | 588 -> 0 | brokeCap (also ranks #3 on DPS) |
| Giant's Blood | 15 | `--preserve Life` | 1168 -> 1148 | brokeCap (small margin: "Inherent Life granted by Strength is halved" nets -20 against the +life from path nodes) |
| Resolute Technique | 20 | `--preserve CritChance` | 11.2 -> 0 | brokeCap |
| Eldritch Battery | 10 | `--preserve EnergyShield` | 57 -> 0 | brokeCap |

Giant's Blood is the most interesting of the extras: the net Life delta is only -20 (the keystone
halves strength-life while the ~15 path nodes add life back), so it's a case where the constraint
filter catches something a human eyeballing the node text might not price correctly.

## Still not exercised on real data

`firstConstraintViolation`'s **`worsenedDeficit`** branch (`base < floor && cand < base` -- a
metric already under its floor being dragged lower). This build carries FireResist 63 / ColdResist
51, both under a 75 cap, but no reachable keystone or notable *reduces* your own elemental
resistances, so `--min-resist 75` never trips on them. Unit tests cover the branch; a live hit
would still be worth catching if a resist-shredding node (e.g. a future keystone, or a jewel
socket path) ever turns up in a candidate pool.

## Observation for the recommender itself (not a bug)

RUN 1's top three -- Iron Reflexes, Giant's Blood, Blood Magic -- all report the *identical*
`delta: 1260.51`. `AllocNode` auto-paths to that whole keystone cluster through the same corridor
of damage notables, and the bundle's entire DPS delta is attributed to each keystone at the end of
it. So the ranking's #1 pick is really "cheapest keystone at the end of a damage-notable
corridor," and each keystone's own effect (and its own downside) contributes nothing to the score.
That is the delta-per-point design plus path-node cost accounting working as documented -- and it
is precisely why the constraint filter earns its place: the ranking alone cannot see that Iron
Reflexes zeroes your evasion. See the matching note in `gotchas.md`.
