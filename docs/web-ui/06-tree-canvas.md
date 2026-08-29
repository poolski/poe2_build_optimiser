# Phase 3 — tree canvas (in the v1 release)

> **Current behaviour. A change is proposed in [`10-repoe-asset-source.md`](10-repoe-asset-source.md)
> (spec only — not built).** Everything in this doc — the stylised "shapes, not sprites / no GGG
> art" render — is what ships today. `10` proposes drawing real per-node icons from RePoE-fork (dot
> demoted to the low-LOD fallback), reversing only the "no art" decision; layout, diff-overlay, and
> version-mismatch behaviour would be unchanged. Until `10` is implemented, this doc is accurate as
> written.

**Part of v1**, per the user (2026-08-28). For a *respec* tool a visual tree diff is the point —
"move these points" reads far better on the tree than as a list of node names. The node-list diff
in `05` stays as the always-correct fallback view (and the view for a build whose tree version
doesn't match the shipped one), but the canvas is the headline result.

Scope is deliberately small — a stylised diff render, not a PoB replica. Nothing here is
architecturally hard; it's ~1 day of porting a tested renderer. What follows is that scope.

## Target: a stylised representation, not a replica

Agreed scope (2026-08-28):

- **Shapes, not sprites.** Normal nodes = small dots, notables = larger dots with minimal
  decoration (a ring), keystones = larger still with a bit more (ring + fill accent). No GGG art.
- **PoE2 colour scheme** for node categories (str/dex/int/hybrid tint), plus the diff overlay:
  **allocated / added / dropped / anchor**.
- **Same directionality as in-game.** Keep node/group positions as exported; **no orbit
  rotation, no group-oriented rotation** — retaining the familiar layout reduces confusion and
  drops the hairiest layout math.
- Pan + zoom, hover → node name + stat lines.

This is the "functional" canvas, now with an even smaller maths surface than first scoped.

## Reuse: `poe2-tools/poe2-build-planner`

<https://github.com/poe2-tools/poe2-build-planner> — a local-first PoE2 build planner. **Same
stack as ours** (Vite + React + TS + Zustand + Vitest + Canvas2D) and it already ships a
tested pan/zoom renderer for the ~5,100-node tree.

### Licence — OK to reuse the code

- **Its source code is MIT** (© 2026 theofbonin). GitHub shows "NOASSERTION" only because the
  `LICENSE` file appends a game-data carve-out note; the code licence itself is plain MIT. We may
  copy/adapt `src/**` freely, keeping the MIT copyright + licence text alongside the ported files
  (add `packages/web/src/render/LICENSE.upstream` with their notice and a one-line provenance
  comment in each ported file).
- **Its bundled tree data + sprite atlases are © Grinding Gear Games**, explicitly excluded from
  the MIT grant, "personal, non-commercial use only" under GGG's fan-tool policy. We take **none**
  of those — see next section.
- The one real art-licensing question (the DDS/PNG atlases) **does not apply to us** because we
  draw plain shapes.

### What to take

`src/render/` — ~40 KB, fully unit-tested, schema-light:

| File | Role |
| ------ | ------ |
| `viewport.ts` | pan/zoom → world↔screen transform |
| `spatialIndex.ts` | grid index for hover / click hit-testing |
| `lod.ts` | level-of-detail thresholds by zoom |
| `arc.ts` | connection curves between nodes |
| `draw.ts` | the Canvas2D paint loop |
| `nodeVisual.ts` | **per-node style lookup — 484 bytes; this is exactly where the "dot size by tier + PoE2 colour + minimal decoration" spec lives.** Re-skin here. |
| `TreeView.tsx` | React wrapper (canvas ref, resize, event wiring) |

**Correction 2026-08-29:** an earlier draft said "Zustand is already a candidate dep for
`packages/web` (`05`), so their store patterns port too". That was wrong about `05`, which
explicitly decides **no state library** -- one `useReducer` in `state.ts`. Zustand is
upstream's choice, not ours; port their render code, not their store wiring. The mistake
propagated into `08`, which installed the dep unnecessarily.

### What to skip

- **`src/tree/` (`source.ts`, `data.ts`)** — parses GGG's *official developer export* schema.
  We stay on **PoB's `tree.json`** (already vendored via the submodule) because our bridge
  resolves node ids against PoB's tree; mixing two tree datasets risks id drift. So: their
  **renderer**, adapted to consume a **PoB-shaped node list**. `draw.ts` / `viewport.ts` /
  `spatialIndex.ts` don't care about the schema; `nodeVisual.ts` and the data-load glue do —
  rewrite those against `tree.json`.
- **`allocation.ts`** (shortest-path auto-allocation, point-budget enforcement) — the bridge is
  our allocation oracle; we only render a result, never compute reachability client-side.

### Fixes to make on the port

- **Zoom control.** Upstream's wheel zoom jumps to min/max in a single detent — no usable
  in-between. On the port: (a) a **zoom slider** (log scale, min↔max), (b) wheel zoom as a small
  fixed multiplicative step per detent (~1.1–1.2×) anchored at the cursor, (c) `+` / `−` /
  `fit`  buttons. Slider and wheel drive the same `viewport.scale`; clamp to `[minScale,
  maxScale]` derived from the tree bounds vs the canvas size.

## Data

- `packages/pob-bridge/pob-runtime/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json` (**1.9 MB**;
  path updated for the `packages/pob-bridge/` move, `97cbe27`) has `nodes` (id, `group`,
  `orbit`, `orbitIndex`, `isNotable`/`isKeystone`/`isJewelSocket`/`isAttribute`, and
  `connections: [{id, orbit}]` — one bidirectional edge list, **not** separate `in`/`out`;
  there are no `isMastery` nodes in the PoE2 tree), `groups` (x/y), and the orbit constants.
  Node position (no rotation) = `group.pos + orbitRadius[orbit] · unit(angle)` where
  `angle = 2π · orbitIndex / skillsPerOrbit[orbit]` (every orbit is uniform — PoB's
  `orbitAnglesByOrbit` table is fully derivable and dropped from the min file).
- **`packages/web/public/tree-0_5.min.json` is a committed artifact (~407 KB), not a build
  step.** Generated by `packages/web/scripts/gen-min-tree.mjs` during fork-prep
  (`docs/web-ui/08-fork-prep.md` task 6) and re-run only on a tree-version bump. A build step
  would re-couple this track to the pob-runtime submodule, which fork-prep exists to remove.
  Shape: `{ meta, bounds, constants:{orbitRadii,skillsPerOrbit,PSSCentreInnerRadius}, strings[],
  groups:{gid:[x,y]}, nodes:{id:[group,orbit,orbitIndex,nameIdx,kind,conns[],statIdx?,ascNameIdx?]},
  nodeFlags }` — `nameIdx`/`statIdx` index into `strings[]` (the tree repeats stat lines
  heavily); `kind` 0=normal 1=notable 2=keystone 3=jewel 4=attribute. Surface `meta.treeVersion`
  on `/health`.
- `OptimiseResultDTO.allocatedNodeIds { before: number[]; after: number[] }` — both id-sorted,
  straight from `OptimiseTreeResult` (**resolved 2026-08-29, `3b7dcf6`** — see the note below).
  `after` is the connected post-plan set, path nodes included. The committed fixture
  `packages/web/fixtures/canvas-diff.R_Thor-L84-weak.json` (real `--respec-budget 3` repair run)
  now carries `afterConnected` (127 ids) as well as `afterPicksOnly` (126, picks only) for
  comparison, plus `before`, `removedCascadeIds`, `addedPickIds`, `steps`, `anchor`.
- The canvas is then a pure function of `(minTree, allocatedBefore, allocatedAfter, added,
  removed, anchor)`.

> **Resolved 2026-08-29 (`3b7dcf6`).** The plan's "read `list_allocated_nodes` on the
> still-acquired bridge for `after`" was close but incomplete: `optimiseTree` never leaves the
> bridge in the post-plan state, and a plain `list_allocated_nodes` reads the *loaded* tree.
> Fixed by teaching `list_allocated_nodes` an optional `allocSet` — allocated on top of the
> `removeIds` cascade, then `BuildAllDependsAndPaths`, list `spec.allocNodes`, restore; no
> recompute. `optimiseTree` calls it once at end of run and puts `{ before, after }` on
> `OptimiseTreeResult.allocatedNodeIds`; `after` is connected by construction. `04`'s
> `applyPlan.ts` writes `<Spec nodes="…">` straight from it. The rejected alternative
> (`optimiseTree` recording `node.path` ids through the walk) touched the hot path and was not
> taken.

## Estimate

Porting a tested renderer + re-skinning `nodeVisual.ts` + writing the `tree.json` load glue and
the diff overlay: **~1 day**, and the output matches the stylised spec instead of being a
generic force-graph. Writing the same thing from scratch was the earlier ~1–2 day estimate.

The PoB-faithful render (DDS→PNG transcode pipeline, tens of MB of atlases, skirt-orbit +
rotation maths) stays **out of scope indefinitely** — texture-pipeline project, cosmetic payoff.

## If this ever goes public

It's local-first / single-user, so mostly moot — but a hosted build would need GGG's
non-affiliation notice in a footer ("not affiliated with or endorsed by Grinding Gear Games…",
game content © GGG, personal non-commercial use), exactly as both PoB and poe2-build-planner
carry it. Note it here so it isn't a surprise.

## Prereqs (all in v1 phases 2–3)

- `OptimiseResultDTO.allocatedNodeIds { before, after }` — mirrored straight from
  `OptimiseTreeResult` (filled by `optimiseTree` since `3b7dcf6`); in the `03` schema, not a
  canvas-only add-on.
- The `public/tree-0_5.min.json` build step in `packages/api` (or `packages/web`); tree version
  pinned + surfaced on `/health`.
- Handling for a build whose `<Spec treeVersion>` ≠ the shipped one: warn and show the `05`
  list diff instead of the canvas. This is why `05` stays in v1, not just as "fallback if we run
  out of time".
- `packages/web/src/render/LICENSE.upstream` with the poe2-build-planner MIT notice + a
  one-line provenance comment in each ported file.

> **Resolved at integration 2026-08-29.** This fallback was unimplementable as specified:
> `BuildSummary` carried no `treeVersion`, nor did `OptimiseResultDTO`, and `get_tree_status`
> does not return one -- the field simply did not exist anywhere in the contract, core, or the
> bridge. `treeVersion: z.string().nullable()` was added to `BuildSummary`; the API fills it by
> reading `<Spec treeVersion>` off the XML (`parseTreeVersion`, the *first* `<Spec>`, matching
> the spec `applyPlan` edits). `Results.tsx` prefers the declared version and falls back to the
> id-overlap heuristic only when the XML declares none (`isVersionMismatch`).
