# The command line

Two commands, both taking a Path of Building 2 build `.xml` and printing plain text.

| Command | What it does | Runtime |
|---------|--------------|---------|
| [`optimise-tree`](optimise-tree.md) | plans a whole set of changes — extend, repair, or roll back a branch | minutes |
| [`recommend-tree`](recommend-tree.md) | ranks the best single next node to allocate | seconds to a minute |

Both are run through npm, which needs `--` before the arguments:

```bash
npm run optimise-tree -- "path/to/build.xml" --respec-budget 6
```

## Getting a build `.xml`

The CLIs take a **file path**, not a PoB export code. (The web UI accepts either.)

Path of Building 2 saves builds as `.xml` in its `Builds` folder — point the CLI at one of those.
If all you have is an export code, import it into PoB first and save it.

Quote the path. Build names routinely contain spaces.

## Which mode do I want?

- **I have spare points to spend** (or I'm planning ahead for levelling) → `optimise-tree` with
  `--extra-points <n>`. This is *extend* mode.
- **My tree is fully spent and I want it to be better** → `optimise-tree` with
  `--respec-budget <n>`. This is *repair* mode, and it is the main event.
- **This whole branch was a mistake** → `optimise-tree --rollback-to <node id>`.
- **I just want to know the single best next node** → `recommend-tree`.

## Objectives

What "better" means. Both commands take `--objective <spec>` in three forms:

| Form | Example | Meaning |
|------|---------|---------|
| bare metric | `TotalDPS` | maximise that one `mainOutput` metric |
| DPS/EHP blend | `dps-ehp:0.7` | log-blend `TotalDPS` and `TotalEHP`, weight `0.7` on DPS |
| arbitrary blend | `blend:TotalDPS,Life,0.5` | log-blend any two metrics |

The weight is always the weight on the **first** metric.

Default is `TotalDPS`. `--target <metric>` is the older, simpler flag for a single metric;
`--objective` takes precedence, and passing both to `optimise-tree` is an error.

**A note from benchmarking, worth heeding:** raw `TotalDPS` combined with `--preserve` on
tree-sourced defensive layers separates good trees from bad ones. The `dps-ehp:0.5` blend does
*not* — it scored a hand-tuned tree and a deliberately naive one about the same. If you want a
tree that does not throw away survivability, prefer:

```bash
--objective TotalDPS --preserve Life,Evasion,EnergyShield
```

over a blended objective. The reasoning is in `docs/beam-search/repro.md`.

## Constraints

Floors on any `mainOutput` metric. A candidate that would push a floored metric below its floor
is rejected.

| Flag | Effect |
|------|--------|
| `--constraint <Metric>=<n>` | floor `Metric` at `n`. Repeatable. |
| `--preserve <A,B,...>` | floor each metric at the **loaded build's own current value** — no regression |
| `--min-resist <n>` | shorthand for floors on Fire, Cold, and Lightning resistance |

`--preserve` is usually what you want: you rarely know the right absolute number, but you almost
always know you don't want to go backwards.

Resistances are a poor thing to floor from the tree — they come mostly from gear, and Chaos
Inoculation sidesteps them entirely. Prefer flooring `Life`, `EnergyShield`, `Evasion`, or
`TotalEHP`.

## Builds that don't work headless

Some builds score nothing when PoB runs without a UI — a handful of ascendancies and skill setups
report 0 DPS. If the baseline scores 0, every candidate ties and the output is meaningless. This
is a known limitation of headless evaluation, not a bug in the search. Check the baseline figure
in the first line of output before trusting a run.

## Speed

Every evaluation is a real PoB recompute at roughly 250–310 ms. The commands print how many they
did, plus the memo cache hit rate, so you can see where the time went.

If a run is taking longer than you want, the levers are `--proximity` (how far afield to look),
`--max-candidates` (a hard cap per step), and keeping `--beam-width` at 1. Widening the beam
multiplies the work.
