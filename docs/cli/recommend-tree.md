# `recommend-tree`

Ranks the best individual nodes to allocate next. A single scoring pass — no planning, no
multi-step search — so it finishes in seconds to a minute rather than minutes.

```bash
npm run recommend-tree -- <path-to-build.xml> [options]
```

Use it when the question is *"what should I take with this level-up?"*. Use
[`optimise-tree`](optimise-tree.md) when the question is *"what should this whole tree look
like?"*.

## Options

### Scoring

| Flag | Default | Meaning |
|------|---------|---------|
| `--target <stat>` | `TotalDPS` | `mainOutput` key to maximise |
| `--objective <preset>` | — | `dps-ehp:W`, `blend:A,B,W`, or a bare metric name — takes precedence over `--target` |
| `--top <n>` | `10` | how many recommendations to print |

### Candidates

| Flag | Default | Meaning |
|------|---------|---------|
| `--node-types <A,B,...>` | `Notable,Keystone` | which node types to consider |
| `--all-node-types` | off | consider every node type, small passives included |
| `--damage-type <type>` | — | sorts on-type candidates to the front and tags them in the output |
| `--max-candidates <n>` | — | cap the candidate pool before scoring |

`--damage-type` **prioritises, it does not filter**. It stable-sorts nodes whose stat lines
mention the type to the front, leaving everything else in the pool behind them. On its own that
only changes the tagging and the order candidates are considered in; combined with
`--max-candidates` it becomes a selection, because the cut then falls on off-type nodes first.
For an elemental type it also matches "Elemental" stat lines.

### Constraints

| Flag | Meaning |
|------|---------|
| `--constraint <Metric>=<n>` | floor `Metric` at `n`. Repeatable. |
| `--preserve <A,B,...>` | floor each metric at its loaded-baseline value |
| `--min-resist <n>` | floor Fire, Cold, and Lightning resistance at `n` |
| `--keep-violating` | show constraint-violating candidates, flagged, instead of dropping them |

`--keep-violating` is the diagnostic setting. If a run comes back with far fewer recommendations
than expected, turn it on to see what was filtered and why — the alternative is guessing at an
empty list.

## Reading the output

```
Constraints: Life >= baseline, EnergyShield >= baseline

Top 5 passive node recommendations (ranked by TotalDPS per point):

Glaciation (Notable) -- 1 pt(s)
  delta: 16639.42  (16639.42/pt)
  - 25% increased Cold Damage
  - 10% increased Cast Speed

Heartseeker [Deadeye] (Notable) -- 1 pt(s)
  delta: 14201.88  (14201.88/pt)
  - 30% increased Critical Damage Bonus
```

- `delta` is the absolute objective gain; `/pt` divides it by the points needed to reach the
  node, including the path to get there. **Rank on `/pt`** — a big node four points away is often
  worse value than a modest one adjacent to your tree.
- A name in `[square brackets]` is an ascendancy node.
- With `--damage-type`, matching nodes get a second bracketed tag.
- With `--keep-violating`, a rejected candidate shows the metric it broke, the before and after
  values, and the floor it crossed.

## Examples

Best next node for a lightning build, defences held:

```bash
npm run recommend-tree -- "build.xml" --top 10 \
  --damage-type Lightning --preserve Life,EnergyShield
```

Look at everything, including small passives:

```bash
npm run recommend-tree -- "build.xml" --all-node-types --top 20
```

Work out why the list came back short:

```bash
npm run recommend-tree -- "build.xml" --min-resist 75 --keep-violating
```

## Limits

It scores each node **in isolation**, against your current tree. It does not know that two nodes
are on the same path and cheap together, and it cannot see a strong node that only pays off after
a weaker one. Those are exactly what `optimise-tree` is for.
