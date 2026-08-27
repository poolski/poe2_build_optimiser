# Gotchas

Non-obvious PoB-PoE2 behaviors worth knowing before touching `bridge.lua`'s tree-evaluation
methods again. Each cost real debugging/verification time once; the goal is to spend it once.

## PoB-PoE2 internals

**`build.maxWeaponSets` does not hold a weapon-swap-set count in this fork -- it holds the
cumulative total of quest-reward passive points across every act.** `Modules/Build.lua:98`:
`self.maxWeaponSets = self.acts[self.maxActs].questPoints`, itself a running sum built from each
quest's `questPoints` entry in `Data/QuestRewards.lua`. The real passive-point cap formula
(`Build.lua`'s own `EstimatePlayerProgress`, which drives its actual points-used display) is
`usedMax = 99 + maxWeaponSets + ExtraPoints` -- dropping the `maxWeaponSets` term because the
name looks irrelevant looks exactly like "this build is over its point budget" when it isn't.
Confirmed live: all three of this project's own sample builds showed `pointsUsed` exceeding a
naive `99 + ExtraPoints` cap by roughly their real quest-point total, until this term was
included (`get_tree_status` in `bridge.lua`).

**`node.path` is a shared, mutable cache field on each tree node table, not something
recomputed on read.** It's last written by whichever `PassiveSpec:BuildAllDependsAndPaths()`
call ran most recently, which `AllocNode` calls internally at the end of allocating any node --
overwriting `.path` on *every* node in the tree, not just the one just allocated. In a loop that
evaluates candidate node N, rolls back via `RestoreUndoState`, then evaluates candidate N+1: the
rollback correctly restores `allocNodes`/`node.alloc`, but `node.path` on every node (including
candidate N+1) is left stale, reflecting a tree state that still includes candidate N. Without
an explicit `spec:BuildAllDependsAndPaths()` call right after every `RestoreUndoState`, candidate
N+1 would allocate along a path computed against the wrong baseline. `evaluate_candidate_nodes`
does this rebuild after every restore for exactly this reason.

**Rolling back a temporary node allocation via `DeallocNode(node)` alone is not safe for
repeated candidate evaluation.** `DeallocNode` only cascades to *dependent* (downstream) nodes --
it does not undo the upstream path nodes `AllocNode` may have silently pulled in to connect a
distant candidate. Repeatedly evaluating candidates this way would leak those stray path nodes
into every subsequent candidate's baseline. `PassiveSpec:CreateUndoState()` /
`RestoreUndoState()` -- the same mechanism PoB's own GUI uses for Ctrl+Z -- is the correct
primitive instead, and is what `evaluate_candidate_nodes` uses. Verified live: baseline
`TotalDPS` and `get_tree_status` output matched byte-for-byte before and after a 10-candidate
evaluate-and-rollback batch.

**`RestoreUndoState` reverts the passive spec but NOT `build.calcsTab.mainOutput`.** After
`spec:RestoreUndoState(undo)` the `allocNodes`/`node.alloc` state is back to the snapshot, but
`mainOutput` still holds whatever the last `BuildOutput()` computed (i.e. the last candidate's
stats). `evaluate_candidate_nodes` gets away with this because its only caller reads `get_stats`
*before* evaluating -- but `evaluate_candidate_nodes_from`, which the beam driver calls
repeatedly, must leave a clean baseline so the *next* call's `CreateUndoState` snapshots correct
stats. Fix: an explicit `build.buildFlag/modFlag = true` + `runCallback("OnFrame")` +
`build.calcsTab:BuildOutput()` after the outer `RestoreUndoState`. Caught live: a `get_stats`
immediately after `evaluate_candidate_nodes_from(allocSet=[…])` returned the allocSet+candidate
stats (TotalDPS 41715 vs baseline 39525) until the recompute was added.

**Masteries are a PoE1-only mechanic -- no node in PoE2's vendored tree data ever has
`type == "Mastery"`.** `PassiveSpec.lua` still carries a full `masterySelections`/mastery-effect
code path (leftover from this codebase's PoE1 ancestry, like the "Labyrinth" progress-panel text
and the `maxWeaponSets` misnomer above), but it's dead code against real PoE2 data -- confirmed
by grepping the entire vendored `TreeData/` for any `"Mastery"` type entry (zero matches). Don't
design around masteries ever showing up in `list_allocatable_nodes`'s output.

**A keystone can top the delta-per-point ranking purely on the damage notables `AllocNode`
pathed through to reach it -- its own effect never enters the score.** Observed live on
`RampantlyBisexual.xml`: Iron Reflexes, Giant's Blood, and Blood Magic all reported the exact
same `delta: 1260.51`, because `AllocNode` auto-paths to that whole keystone cluster through one
shared corridor of damage notables and the bundle's full DPS delta is attributed to each keystone
at the end of it. This is delta-per-point + path-node cost accounting behaving as designed (both
already documented), but the practical upshot is worth stating outright: the ranking cannot see
that Iron Reflexes zeroes your evasion, so the `constraints`/`preserveMetrics` filter is not
optional polish -- it is the only thing standing between the recommender and a confident "allocate
Iron Reflexes" on an evasion-stacking build. Full repro in `constraint-rejection-repro.md`.

## Performance reality, not just theory

A real endgame tree can have 3,000+ currently-reachable, unallocated candidate nodes, each
costing one real `AllocNode` + `BuildOutput()` recompute to evaluate -- batching many candidates
into one `evaluate_candidate_nodes` JSON-RPC round trip cuts round-trip *count*, not the
underlying recompute cost. Evaluating the full reachable set on a real build has been observed
to take well over ten minutes. Two things now keep a normal run fast: `recommendTree` defaults to
Notable+Keystone candidates only (skipping the thousands of small stat nodes, which rarely rank
highly anyway -- override via `nodeTypes`/`includeAllNodeTypes`), and its `maxCandidates` option
(plus the spike script's dev-time cap of 20) bounds cost further while iterating.
