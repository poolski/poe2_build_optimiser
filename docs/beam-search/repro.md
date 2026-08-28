# Live validation: greedy-seed + leaf-only repair

Design step 11. The tree planner's **repair mode** (`optimiseTree`, `respecBudget > 0` — free the
lowest-value allocated leaves and re-spend them at net-zero points) had unit coverage and a
corpus-wide *cost* benchmark (`docs/beam-search/bench-*.md`), but its central *quality* claim had never
been shown end to end:

> Repair **improves a naive build** and returns **≈no change on a hand-tuned one** — provided the
> objective and the preserve floor capture what the build was actually tuned for.

That last clause is the whole result. A single scalar objective with no floors does **not** leave a
hand-tuned build alone; it trades the build's defence away for the metric you named. This doc shows
both halves, end to end through `optimise-tree` and the CORE bench.

## The pair

Same character family, two states — the naive build is the hand-tuned one with 15 tree leaves
gutted (`Builds/Monk/`, both fixed 2026-08-27 so `TotalDPS` computes; see `docs/beam-search/corpus.md`):

| | `MA-Shattering` (tuned) | `MA-FlickerStrike` (naive) |
|---|--:|--:|
| Monk, level | 92 | 92 |
| tree points | 113 / 123 (10 spare) | 98 / 123 (25 spare) |
| **TotalDPS** | **185,998** | **89,769** |
| TotalEHP | 24,958 | 17,584 |
| Life | 1,462 | 1,703 |
| Evasion | 11,371 | 9,050 |
| EnergyShield | 3,557 | 2,373 |

The tuned build spent points into a hybrid evasion/ES defensive core (and had 10 points still
unspent); the naive build kept a little more life but gutted the evasion/ES investment and sits on
25 idle points.

## The recipe

- **Objective:** raw `TotalDPS` (maximise one metric). The `dps-ehp:0.5` log-blend was tried first
  and does not separate the pair — see [Why not the blend](#why-not-the-blend).
- **Floor:** a no-regression floor (`--preserve`) on the **tree-sourced defensive layers** —
  `Life,Evasion,EnergyShield` for this Monk pair. `optimiseTree` pins each named metric at its
  loaded-baseline value and rejects any step that would drop it.
- **Elemental resists are deliberately *not* floored.** Resists come from gear, not the passive
  tree; pinning them steers the planner toward a target it should not be chasing. The CORE bench
  (below) confirms nothing trades resist away even without the floor (`res ok` = y on all 27 runs).

The bench harness carries this as its default: `DEFAULT_PRESERVE = ["TotalEHP"]` on every build
(PoB's combined effective-HP number — guards life/ES/evasion/armour/block as one aggregate without
assuming a layer), plus a per-build `preserve` override for hand-picked defence
(`MA-Shattering` → `Life,Evasion,EnergyShield`).

## Headline: the 2×2

`optimise-tree --mode repair --respec-budget 6`, objective `TotalDPS`:

| build | floor | result | Δ |
|---|---|---|--:|
| **`MA-Shattering`** (tuned) | resists only (`--min-resist 75`) | frees an `Evasion and Energy Shield` node, allocates **Chaos Inoculation** (`Maximum Life is 1`) | **+39.7 %** |
| **`MA-Shattering`** (tuned) | `Life,Evasion,EnergyShield` | **`repair-not-worthwhile`** — frees nothing, recommends no change | **0.00 %** (exact `185998.36 → 185998.36`) |
| **`MA-FlickerStrike`** (naive) | `Life,Evasion,EnergyShield` | frees 2 dead notables, allocates **Glaciation** (cold pen + extra cold) | **+11.4 %** |

The tuned build with only a resist floor "gains" 40 % DPS by zeroing its life pool (Chaos
Inoculation touches no resist, so `--min-resist` never fires) and respeccing a defensive node —
exactly the trade the preserve mechanism exists to forbid, and exactly why resists are the wrong
thing to floor. Add a floor on the layers the build actually invested in and repair correctly finds
nothing it can do at net-zero points. The naive build, under the
*same* objective and *same* floor, still gains 11 % — its dead notables (`Sniper`,
`Power Conduction`) carry no DPS or defence, so trading them for `Glaciation` breaks no floor.

### Transcripts (trimmed)

**Tuned, resists only** — `--objective TotalDPS --min-resist 75`:

```
Freed 4 leaf point(s):
  - One with the Storm (Notable)       value lost 0.00
  - Evasion and Energy Shield (Normal) value lost 0.00
  - Immaterial (Notable)               value lost 0.00
  - The Power Within (Notable)         value lost 0.00
2 re-spend step(s):
  1. Chaos Inoculation (Keystone, 1 pt)   185998.36 -> 215923.35  (+29924.98/pt)
       - Maximum Life is 1
       - Immune to Chaos Damage and Bleeding
  2. Throatseeker (Notable, 3 pt)         215923.35 -> 259901.62  (+14659.42/pt)
objective 185998.36 -> 259901.62   (net +0 pts, freed 4 / re-spent 4)
```

**Tuned, `--preserve Life,Evasion,EnergyShield`:**

```
mode: repair   baseline objective 185998.36   points 113/123   respec budget 6
Freed 0 leaf point(s):
  - One with the Storm (Notable)             value lost 0.00   [185998.36 -> 185998.36 without it]
  - Evasion and Energy Shield (Normal)       value lost 0.00
  - Immaterial (Notable)                     value lost 0.00
  - The Power Within (Notable)               value lost 0.00
  - Spectral Ward (Notable)                  value lost 0.00
  - First Principle of the Hollow (Notable)  value lost 0.00
No re-spend steps. Stopped: repair-not-worthwhile
objective 185998.36 -> 185998.36   (net +0 pts, freed 0 / re-spent 0)
(repair could not beat the loaded tree -- recommending no change)
```

Repair *identifies* six leaves whose removal costs nothing in isolation, but every re-spend that
would use the freed points has to path through a node that drops Life, Evasion or EnergyShield
below baseline, so all are rejected and the sweep keeps `k = 0`.

**Naive, `--preserve Life,Evasion,EnergyShield`:**

```
Freed 2 leaf point(s):
  - Sniper (Notable)           value lost 0.00
  - Power Conduction (Notable) value lost 0.00
1 re-spend step(s):
  1. Glaciation (Notable, 2 pt)   89769.44 -> 99967.82  (+5099.19/pt)
       - Damage Penetrates 18% Cold Resistance
       - Gain 6% of Elemental Damage as Extra Cold Damage
objective 89769.44 -> 99967.82   (net +0 pts, freed 2 / re-spent 2)
```

The CORE bench reproduces `99967.82` exactly with only the default `TotalEHP` floor (no
`Life/Evasion/EnergyShield` override) — `Glaciation` is pure cold damage, so the result is robust
to which defensive floor is applied.

## Corpus-wide (CORE bench, `docs/beam-search/bench-totaldps.md`)

`npm run bench-tree-approaches -- TotalDPS 8` — 9 builds × {extend +8 fresh pts, repair-r3,
repair-r6}, `TotalEHP` no-regression floor (+ the `MA-Shattering` override), 54 min at
`--concurrency=4`. Repair lift %, same loaded baseline:

| build | tier | extend | repair-r3 | repair-r6 |
|---|---|--:|--:|--:|
| `MA-FlickerStrike` | naive | +43.30 | **+11.36** | +11.36 |
| `MA-Shattering` | tuned | +39.85 | **0.00** | 0.00 |
| `TechnoIceShot` \* | strong (held-out) | +17.72 | **0.00** | 0.00 |
| `dosesondoses` \* | mid (held-out) | +15.86 | +2.47 | +2.47 |
| `SnusInMyBlood` \* | weak (held-out) | +101.45 | 0.00 | +91.43 |
| `R_Thor` | weak (armour) | +63.93 | +93.12 | +129.92 |
| `TheTradie-gut8-low` | gutted (policy low) | +59.45 | 0.00 | 0.00 |
| `TheTradie-gut25-high` | gutted | +288.31 | +5.04 | +5.04 |
| `Venereable-gut25-high` | gutted | +162.58 | +78.18 | +82.95 |

Reading it:

- **Exact no-change is not a fluke of the hand-picked pair.** `TechnoIceShot` — a strong,
  *held-out* build (never seen while tuning K/W/D) — also lands `repair-not-worthwhile` at exactly
  `28320252.31 → 28320252.31`. So does `TheTradie-gut8-low`, whose "low" gutting policy only
  removed objective-dead notables (nothing to reclaim).
- **Repair moves hard where there is slack.** The weak builds (`R_Thor` +130 %, `SnusInMyBlood`
  +91 %) and the honestly-gutted builds (`Venereable-gut25-high` +83 %) recover large amounts at
  net-zero points without regressing `TotalEHP`.
- **`SnusInMyBlood`: r3 = 0.00, r6 = +91.43.** Not a monotonicity break (r6 ≥ r3 holds). Freeing
  ≤ 3 leaves opens no worthwhile re-spend; the k-sweep only finds the big plan once it may free
  ~6. The driver keeps the best swept `k`, so the larger budget wins cleanly.
- **Repair monotonic (r6 ≥ r3) on all 9 builds.** `res ok` = y on all 27 runs — no plan traded an
  elemental resist away even though resists are not floored.
- **`extend` gains are large everywhere** (e.g. tuned `MA-Shattering` +39.85 % on 8 fresh points):
  fresh points are a real budget increase, and the tuned build was defensively — not offensively —
  optimised, so there is DPS on the table for *added* points. That is `extend` doing its job; it is
  not the net-zero repair path and not what this validation turns on.

## The "no change" assertion

`repair-not-worthwhile` lands on **exact equality** — `185998.36 → 185998.36`,
`28320252.31 → 28320252.31` — with no float dust, matching what `docs/constraint-rejection-repro.md`
saw on the constraint filter. The regression check for "repair leaves a tuned build alone" uses
exact `final.objective === baseline.objective`; no relative ε is needed unless a future run surfaces
neutral-node noise.

## Why not the blend

The design plan expected `dps-ehp:0.5` (`0.5·log(DPS) + 0.5·log(EHP)`) plus a preserve floor to
separate tuned from naive. It does not. From the committed 25-build `dps-ehp:0.5` run
(`docs/beam-search/bench-dps-ehp-0-5.md`) and a follow-up with the defensive floor applied:

| build | extend +8 | repair-r3 | repair-r6 |
|---|--:|--:|--:|
| `MA-Shattering` (tuned) | +1.82 % | +0.57 % | +1.33 % |
| `MA-FlickerStrike` (naive) | +1.75 % | +0.63 % | +1.30 % |
| `MA-Shattering` + `preserve Evasion,EnergyShield,TotalEHP` | +1.53 % | +0.84 % | +1.33 % |

Two problems:

1. **No contrast.** Tuned and naive land within 0.03 % of each other on every approach. The blend
   already suppresses the defence-cannibalising the raw metric invites (Chaos Inoculation tanks
   `TotalEHP`, so the blend won't take it), which is good — but it also flattens the tuned/naive
   gap the validation needs.
2. **The preserve floor is inert on top of the blend.** Adding `Evasion,EnergyShield,TotalEHP`
   barely moves the tuned numbers, because the blend was not touching those layers anyway. Repair
   still finds ~1.3 % by freeing notables the blend *cannot price* — `Immaterial`,
   `One with the Storm`, `The Power Within`, `Killer Instinct`, `Overflowing Power`, `Stupefy`
   (spell suppression, ailment threshold, utility) — and buying `Throatseeker` / `Agile
   Succession`. That is a real limitation of any scalar objective: a hand-tuner optimises against a
   richer target than DPS-and-EHP, so a two-term blend will always see some of their picks as free
   points.

Raw `TotalDPS` + a floor on the specific defensive layers is the sharper tool: it forbids the bad
trade outright instead of hoping a blended term outweighs it, and it preserves the tuned/naive
contrast.

## Not covered

- **Any-node (cascading) repair.** Both modes only free true leaves; non-leaf removal (with
  downstream cascade-off) is a post-v1 opt-in (design doc §7).
- **A build tuned against something `TotalEHP` *does* price but a raw metric doesn't** (e.g. a pure
  block/spell-suppression tank under a `TotalDPS` objective). The floor set would need those metric
  names; the mechanism is the same.
