<!-- generated-by: groundrules v1.10.0 -->
# 0012 — RePoE-fork is the web render layer's asset source

**Date**: 2026-08-29
**Status**: Accepted — supersedes ADR-0010's "stylised only, no GGG art" clause; the node-list diff
half of ADR-0010 stands unchanged

## Context

The web canvas sources its tree from whatever PoB vendors: `gen-min-tree.mjs` reads the submodule's
`TreeData/0_5/tree.json`. That costs two things. Regenerating the canvas needs the submodule checked
out, so a fresh `git worktree` (which skips submodules) cannot rebuild the tree. And there is no
art — ADR-0010 cut it deliberately, so a normal node and a notable are the same dot at different
sizes and the tree reads poorly against the in-game one.

[RePoE-fork](https://repoe-fork.github.io/poe2/) publishes the same GGG data, auto-updated per
patch, and its node ids **are** GGG hashes — the ids PoB uses and the API already returns. A
2026-08-29 feasibility probe confirmed the fit: 1623 groups, 5152 passives, 578 unique icon paths,
and `orbit_radii` / `skills_per_orbit` matching the canvas's existing constants.

## Decision

The **web render layer** sources tree geometry, node metadata, node art, stat text, and the gem
asset layer from RePoE-fork, and the canvas draws real per-node icons. The stylised dot demotes to
the low-LOD and not-yet-loaded fallback; the diff overlay (allocated / added / dropped / anchor)
draws on top of the icon. Assets are fetched by hand on a version bump and committed — no fetch at
build time.

The calc engine is untouched: `src/core` and the bridge keep running against PoB's own `tree.json`.
PoB remains the fitness oracle (ADR-0001).

## Alternatives considered

- **Stay on PoB's vendored `tree.json` (the status quo, ADR-0010)** — rejected: it keeps the
  submodule coupling for the web tree and structurally cannot supply art or stat text.
- **The sibling repo's approach (a manually-pinned GGG export)** —
  rejected: `poe2-build-planner` pins a hand-downloaded `data.json` with no auto-fetch. RePoE-fork
  auto-publishes per patch, so a fetch script gets genuine currency.
- **Fetch assets at `vite build` time** — rejected: it makes the build network-dependent and
  non-reproducible; committed artifacts keep the canvas buildable offline.
- **A PoB-faithful DDS pipeline with sprite atlases** — rejected: 578 unique PNGs and `drawImage`
  are enough; no runtime DDS decode, no atlas packing unless profiling demands it.

## Consequences

### Positive
- The web tree fully decouples from the submodule — stat tooltips come from RePoE
  `stat_translations`, not PoB, with a raw `id: value` fallback.
- Icons land in `draw.ts` / `TreeCanvas` only — one shared render path, so every tree view inherits
  the styling and none re-implements drawing.

### Negative / Tradeoffs
- **GGG art now lives in the repo** (`public/icons/tree/`, `public/icons/gems/`), reversing
  ADR-0010. `© Grinding Gear Games`; keep an attribution note beside the assets.
- New dependency on a community project's publishing cadence, in exchange for genuine per-patch
  currency instead of a manual pin.
- Gem data + icons ship as an asset layer with no consumer yet (deliberate front-run); a gem UI is
  a separate track.

### Neutral
- `tree-0_5.min.json` gains an `iconIdx` tuple field; `parseMinTree` stays tolerant of a tuple
  without it so an old committed file still parses. `gen-min-tree.mjs` is deleted.
- No id mapping table, and no contract change: node ids stay GGG hashes, so
  `Results.isVersionMismatch` and the id-overlap fallback are unaffected.

## Notes

Design of record, incl. the four-phase sequencing, the `stat_translations` coverage spike, and the
risk list: [`intake/web-ui/10-repoe-asset-source.md`](../../intake/web-ui/10-repoe-asset-source.md).
