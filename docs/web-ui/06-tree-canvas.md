# Phase 4 (deferred) — tree canvas

**Deferred until there's a real need.** The node-list diff in `05` is the v1 deliverable. This
file scopes what a visual canvas would cost so the decision is informed.

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
|------|------|
| `viewport.ts` | pan/zoom → world↔screen transform |
| `spatialIndex.ts` | grid index for hover / click hit-testing |
| `lod.ts` | level-of-detail thresholds by zoom |
| `arc.ts` | connection curves between nodes |
| `draw.ts` | the Canvas2D paint loop |
| `nodeVisual.ts` | **per-node style lookup — 484 bytes; this is exactly where the "dot size by tier + PoE2 colour + minimal decoration" spec lives.** Re-skin here. |
| `TreeView.tsx` | React wrapper (canvas ref, resize, event wiring) |

Zustand is already a candidate dep for `packages/web` (`05`), so their store patterns port too.

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

- `pob-runtime/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json` (**1.9 MB**) has `nodes` (id,
  `group`, `orbit`, `orbitIndex`, `isNotable`/`isKeystone`/`isMastery`, `in`/`out`), `groups`
  (x/y), and the orbit-radius constants. Node position (no rotation) =
  `group.pos + orbitRadius[orbit] · unit(baseAngle(orbitIndex))`.
- A `packages/api` build step writes `public/tree-0_5.min.json` — geometry + node
  type/name/stat only (drop `sprites`, `imageZoomLevels`, flavour) → well under 500 KB. Pin the
  tree version; surface it on `/health`.
- `OptimiseResultDTO` gains `allocatedNodeIds: { before: number[]; after: number[] }`, from the
  same `get_allocated_node_ids` RPC `04` already wants for `updatedPobCode`.
- The canvas is then a pure function of `(minTree, allocatedBefore, allocatedAfter, added,
  removed, anchor)`.

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

## Prereqs when picked up

- `OptimiseResultDTO.allocatedNodeIds { before, after }` + the `get_allocated_node_ids` RPC.
- The `public/tree-0_5.min.json` build step; tree version pinned + on `/health`.
- Handling for a build whose `<Spec treeVersion>` ≠ the shipped one (warn + fall back to the
  list diff).
- `packages/web/src/render/LICENSE.upstream` with the poe2-build-planner MIT notice.
