<!-- generated-by: groundrules v1.10.0 -->
# Glossary

PoE2 and build-optimisation terminology.

## Game & Build Terms

**Passive node** — a skill tree tile (Normal, Notable, Keystone, Ascendancy). Allocates one or more passive points.

**Passive point** — the resource spent to allocate a node. Different nodes cost 1–2 points.

**Skill tree / passive tree** — the ~3000-node graph of passives. Tree structure depends on class start and gem links.

**Spec / allocation** — a build's current passive tree state: which nodes are allocated. Mutable (respec).

**Ascendancy** — 8 special passive nodes (one per class) that grant unique powers. Allocating one Ascendancy blocks the others.

**Keystone** — high-impact Notable (e.g. Chaos Inoculation, Acrobatics). Often blocks bad trade-offs.

**Notable** — mid-impact passive granting a named mechanic or stat (e.g. increased life %, crit chance).

**Normal** — low-impact passive granting small stat increments (e.g. +4 Dexterity).

**Leaf / leaf node** — a Normal node at the edge of the tree. Terminal allocation (no descendants in the spec).

**Path / pathing** — the connected sequence of passives from class start to a target node. The skill tree is a graph; pathing finds shortest connected routes.

**Respec / reallocate** — move points from low-value nodes to high-value ones (keeping the same total).

**Respec budget** — the maximum number of points you're willing to free in a repair (the "up to N worst nodes").

## Optimization Terms

**Objective** — the metric to maximize: `TotalDPS` (damage), `TotalEHP` (survivability), or a blend like `dps-ehp:0.5`.

**Constraint** — a rule the optimizer must obey (e.g. minimum life, elemental resists ≥ 60, keep 5-link gem colour).

**Preserve metric** — a defensive metric the repair won't regress (e.g. `Life,Evasion`). Prevents optimizing away mandatory defenses.

**Freeze list / frozen node** — passives that repair may never deallocate, even if low-value. Used to lock mandatory pathing or stat floors.

**Candidate** — a single allocation option being scored (a specific passive node, or a multi-node plan).

**Beam search** — a width-limited search that keeps the `W` best partial plans at each depth, instead of just 1 (greedy). `W=1` is greedy.

**Extend** — add new points to a build (levelling up, item grants). Allocate up to `pointBudget` new nodes.

**Repair / respec** — reallocate existing points (the main use case). Free up to `respecBudget` worst nodes, re-spend on better ones.

**Rollback** — free an entire allocated node's downstream cascade, then re-spend those points from scratch. (Example: allocate 15 points in a branch of the tree, regret the whole branch, re-optimize those 15 points elsewhere.)

**Anchor node** — the node being rolled back. Its entire connected subtree (`DeallocNode` cascade) is freed unconditionally.

**DeallocNode cascade** — the set of passives that must be deallocated if a given node is removed (because they depend on it for pathing).

## PoB Terms

**PoB / Path of Building** — a community build calculator. We use its headless LuaJIT calc engine as the oracle.

**Build output / BuildOutput** — a snapshot of a build's stats at one point in time (one recompute). Includes DPS, life, resists, etc.

**Memoization** — caching previously-computed BuildOutput values to avoid redundant recomputes. Layer 5 (per-allocation-set) is the deepest.

**PoB code** — a compressed, portable build export (base64-encoded). Can be pasted into PoB or into our web UI.

**XML** — the build's stored format in PoB (in the `Builds/` folder). Can be uploaded to our web UI.

**Tree version** — the passive tree snapshot version (e.g. `3.24a`). PoE2 trees are tagged; mismatched trees can't be compared.

**Weapon swap** — PoB allows two weapon sets. Passive allocations can be swapped per weapon set, but the overall tree points budget is the intersection (points available in both sets).

## Development Terms

**Bridge** — the abstract interface to the LuaJIT PoB engine. Concrete implementations: single-process bridge, pool, parallel bridge.

**Bridge pool** — a `PobBridgePool`: manages multiple LuaJIT child processes, FIFO queue, crash-respawn, warm-up.

**Parallel bridge** — `ParallelBridge`: shards candidate evaluation across multiple pool slots, aggregates results. Transparent to `src/core`.

**Job registry** — in-memory tracking of ongoing optimise/recommend jobs in the API server. FIFO, admission-gated on available pool slots.

**SSE / Server-sent events** — HTTP stream for relaying progress updates to the frontend in real-time.

**Intake** — raw inputs (specs, user feedback, requirements) that are synthesized into vision and decisions.

---

**Last updated**: 2026-08-29

To add a term: define it clearly, note the context (game, optimization, PoB, development), and link to relevant code or docs if possible.
