# Vision

**poe2-build-optimiser** — Find the best passive tree allocations for a Path of Exile 2 build, fast and accurate.

## The problem

Building a strong character in PoE2 means optimizing passive tree allocations alongside gear. Manual respeccing is slow and error-prone — there are hundreds of passives, complex interactions, and the math is unintuitive. Existing tools guess at damage; they don't actually calculate it the way PoE2 does.

## The solution

Harness **Path of Building's own calculation engine** to score candidate trees with precision. Every node is evaluated by the real PoB simulator, not an approximation. Combined with beam-search optimization and constraint support, the tool finds the best respec strategy in minutes, not hours of trial-and-error.

## What it does

- **Recommend** — the single best next node to allocate
- **Extend** — find the best N nodes to spend newly available points on
- **Repair** — reallocate existing points to higher-value nodes (the classic respec use case)
- **Rollback** — free an entire branch of the tree and re-spend those points optimally
- **Composite objectives** — blend DPS with survivability metrics, or optimize any combination
- **Constraints** — ensure minimum resists, life floors, damage types; skip breaking mandatory gem links

## Scope

**Passive tree only.** Skill and support gems are fixed inputs; the tool never edits them. The focus is tree optimization, leaving gear and gem choices to the player.

## Architecture

Three layers:

1. **Core engine** (`src/core`) — the optimization algorithms (recommend, extend, repair) and scoring logic. Pure business logic; takes a bridge and never constructs one.
2. **Bridge to PoB** (`packages/pob-bridge`) — a long-lived LuaJIT process that loads builds and evaluates candidate allocations. Pooled for parallelism.
3. **Interfaces** — two CLIs (`recommend-tree`, `optimise-tree`) for scripts, and a web UI (Vite + React) for exploration.

## Key traits

- **Accurate** — uses PoB's real calc engine as the oracle
- **Fast** — parallel candidate evaluation within a single run; defaults scale to your machine
- **Flexible** — composite objectives, freeze lists, constraint filters, beam-search width/depth tuning
- **Open** — all 11 optimization phases designed, tested, and documented in `docs/beam-search/`

## See also

- **`docs/status.md`** — the authoritative status and roadmap
- **`docs/web-ui/README.md`** — the active development track (phases 1–3 shipped, phase 1.5 parallel eval shipped)
- **`docs/beam-search/design.md`** — full design and implementation checklist
- **`CLAUDE.md`** — working guidance on tests, dependencies, and the repo layout
