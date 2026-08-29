# `optimise-tree`

Plans a set of passive-tree changes for a build and prints them. It never writes to your build
file — the output is a plan for you to apply.

```bash
npm run optimise-tree -- <path-to-build.xml> [options]
```

`--help` / `-h` prints the built-in usage summary.

## Modes

Mode is inferred, not usually stated: **repair** if `--respec-budget > 0` or `--rollback-to` is
given, otherwise **extend**. `--mode <extend|repair>` states it explicitly and turns a
contradiction into an error rather than a surprise.

### Extend — spend points you have or will have

```bash
npm run optimise-tree -- "build.xml" --extra-points 8
```

Walks outward from the current tree, adding the best-value nodes until the budget runs out.

Extend mode needs a budget. Without `--point-budget` or `--extra-points` the budget defaults to
the points already spent, so there is nothing to add and the command tells you so.

| Flag | Meaning |
|------|---------|
| `--extra-points <n>` | budget = current points used + `n` |
| `--point-budget <n>` | absolute cap on total regular points the plan may occupy |

The two are mutually exclusive.

### Repair — relocate points

```bash
npm run optimise-tree -- "build.xml" --respec-budget 6
```

Scores every removable allocated node by what removing it costs, frees up to `--respec-budget`
points' worth of the cheapest ones, and re-spends them.

The budget is a **points** ceiling, not a node count. One removal can cascade several points off
the tree if other nodes depended on it for connectivity; a cascade too large for the remaining
budget is skipped in favour of a smaller one.

The search sweeps *k* = 1…N freed prefixes and keeps the best result, so a smaller respec that
scores better wins over a larger one that doesn't. If nothing beats the tree you already have,
it says so and recommends no change — a real and useful answer for a well-tuned build.

| Flag | Meaning |
|------|---------|
| `--respec-budget <n>` | free up to `n` points of low-value nodes and re-spend them |
| `--repair-nodes <n>` | alias for `--respec-budget` |
| `--freeze <id,id,...>` | allocated node ids the search may never free |

Ascendancy nodes are always frozen — their points cannot be re-spent elsewhere, so there is no
flag for it. Freezing every removable node stops the run with `nothing-removable`.

### Rollback — undo a branch

```bash
npm run optimise-tree -- "build.xml" --rollback-to 34015
```

Force-frees the anchor node **and its entire downstream cascade**, unconditionally — not scored,
not subject to the respec budget — then re-spends those points from scratch.

Use it when you know a whole direction was wrong and you want the points back regardless of what
the scoring says about them individually.

- Selects repair mode on its own; no `--respec-budget` needed.
- Adding `--respec-budget <n>` *also* sweeps up to `n` further points from the surviving nodes.
- The anchor must be an allocated, non-ascendancy node, and cannot also appear in `--freeze`.
- **Mid-to-late anchors only.** An anchor that would leave fewer than 3 surviving points is
  rejected: that is from-scratch tree building, which this tool does not do.

## Scoring

| Flag | Default | Meaning |
|------|---------|---------|
| `--objective <spec>` | — | `dps-ehp:W`, `blend:A,B,W`, or a bare metric name |
| `--target <metric>` | `TotalDPS` | single `mainOutput` key to maximise |

`--objective` takes precedence; passing both is an error. See
[the objectives section](README.md#objectives) for the forms and for why raw `TotalDPS` plus
`--preserve` tends to beat a blend.

## Constraints

| Flag | Meaning |
|------|---------|
| `--constraint <Metric>=<n>` | floor `Metric` at `n`. Repeatable. |
| `--preserve <A,B,...>` | floor each metric at its loaded-baseline value |
| `--min-resist <n>` | floor Fire, Cold, and Lightning resistance at `n` |

## Search

| Flag | Default | Meaning |
|------|---------|---------|
| `--proximity <k>` | `3` | maximum path length per step — how far off the current tree a candidate may sit |
| `--node-types <A,B,...>` | `Notable,Keystone` | which node types are candidates |
| `--all-node-types` | off | consider every node type, small passives included |
| `--keywords <a,b,...>` | — | keep only candidates whose stat lines mention one of these |
| `--exclude-keywords <a,b,...>` | — | drop candidates mentioning one of these |
| `--max-candidates <n>` | — | hard cap per step after the screens. A development knob; it can cut off good candidates |
| `--beam-width <n>` | `1` | how many partial plans to carry in parallel |
| `--beam-depth <n>` | unbounded | hard cap on the number of add-steps |
| `--parallelism <n>` | `1` | evaluate each step's candidate batch across `n` warm LuaJIT children instead of one. Wall time only — the plan is identical |

**On `--parallelism`:** this is the single biggest wall-time lever. Each add-step scores hundreds
of candidates, and at `n > 1` that batch is split across `n` LuaJIT children and recombined in a
fixed order, so **the plan is byte-identical to `--parallelism 1`** no matter what `n` is. Only
the waiting changes.

Two caveats worth knowing:

- **RAM.** Each child is roughly 700 MB resident, so `n` is bounded by memory, not cores — 8 is a
  sane ceiling on a 32 GB machine. Half your core count is a good starting point.
- **`buildOutputs` goes up slightly.** Sharding a batch into `n` calls costs `n - 1` extra
  recomputes per add-step, because each call ends with one bookkeeping recompute. It does not
  affect the result, but it means the recompute counts in `docs/beam-search/repro.md` only
  reproduce at the default of 1 — which is why the default stays 1 here even though the web UI
  defaults to using the whole pool.

**On `--beam-width`:** at 1 the search is a greedy walk — it takes the best move at each step and
never reconsiders. Above 1 it keeps several partial plans alive, which lets it survive a step
whose locally best move turns out to be a dead end. It also multiplies the number of PoB
recomputes, and 1 remains the default because no benchmark has yet justified otherwise.

The keyword screens are cheap text filters applied before any node is scored, so they are the
most effective way to cut runtime when you know what you are looking for — `--keywords
lightning,shock` on a lightning build, for instance.

## Reading the output

```
mode: repair   baseline objective 412,905   points 107/123   respec budget 6

Freed 4 point(s) by removing 2 node(s):
  - Heavy Draw (Notable)   frees 3 pts (cascade)   value lost 1,204   [objective 412,905 -> 411,701 without it]
  - Sharp Edge (Notable)   value lost 890   [objective 412,905 -> 412,015 without it]

4 re-spend step(s):
  1. Glaciation (Notable, 1 pt, path 2)   objective 411,701 -> 428,340  (+16,639/pt)
       - 25% increased Cold Damage
  ...
Stopped: budget-reached

objective 412,905 -> 461,220   (net +0 pts (freed 4 / re-spent 4))
BuildOutput recomputes: 1,284   cache hit rate: 38%   wall 312.4s
```

- **Freed** lists what came off, what it cost you, and — in brackets — what the build would score
  *without that node*, which is the number that justifies the removal.
- `frees N pts (cascade)` means removing one node also disconnected others.
- **Steps** are the anchor nodes chosen. Path nodes the engine allocates automatically to connect
  them are not listed individually, which is why `pts` in the summary can exceed the step count.
- The last line is your cost check: recomputes × ~280 ms is roughly the wall time.

### Why it stopped

| `Stopped:` | Meaning |
|------------|---------|
| `budget-reached` | spent the whole budget — the normal ending |
| `no-positive-candidate` | nothing left that improves the objective |
| `no-candidates` | nothing in range at all; try raising `--proximity` |
| `nothing-to-do` | extend mode with no budget to spend |
| `nothing-removable` | repair mode, but everything is frozen or non-removable |
| `repair-not-worthwhile` | **your existing tree won that comparison.** No change recommended |
| `cancelled` | stopped early by a caller — only reachable from the web UI |

`repair-not-worthwhile` is a result, not a failure. On a well-tuned build it is the expected one.

## Worked examples

Relocate 6 points for DPS without losing survivability:

```bash
npm run optimise-tree -- "build.xml" --respec-budget 6 \
  --objective TotalDPS --preserve Life,EnergyShield
```

Plan the next 10 levels, keeping resistances capped:

```bash
npm run optimise-tree -- "build.xml" --extra-points 10 --min-resist 75
```

Abandon a branch and rebuild it, protecting two nodes you want kept:

```bash
npm run optimise-tree -- "build.xml" --rollback-to 34015 --freeze 12345,54321
```

Search a lightning build harder, only in relevant territory:

```bash
npm run optimise-tree -- "build.xml" --respec-budget 8 \
  --keywords lightning,shock --proximity 4 --beam-width 3
```
