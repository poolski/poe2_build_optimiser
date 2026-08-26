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

## Performance reality, not just theory

A real endgame tree can have 3,000+ currently-reachable, unallocated candidate nodes,
each costing one real `AllocNode` + `BuildOutput()` recompute to evaluate -- batching many
candidates into one `evaluate_candidate_nodes` JSON-RPC round trip (see architecture.md) cuts
round-trip *count*, not the underlying recompute cost. Evaluating the full reachable set on a
real build has been observed to take well over ten minutes; `recommendTree`'s `maxCandidates`
option (and the spike script's default cap of 20) exists specifically so development/testing
doesn't have to pay that cost on every run. A pre-filter to Notables/Keystones/Masteries only
(skipping small stat nodes, which rarely rank highly anyway) is the likely next step before this
is fast enough for routine use against a full tree.
