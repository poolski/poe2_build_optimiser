# 10 — RePoE-fork asset source (tree geometry, node art, gems)

Design of record. Added 2026-08-29.

## Status

**Spec only — no implementation yet.** Feasibility probing against RePoE-fork is **done** and its
findings are baked into this doc (verified 2026-08-29):

- `passive_skill_trees/Default.min.json` exists and auto-publishes per patch — a real fetch source,
  unlike the sibling repo's manually-pinned GGG export.
- RePoE node ids **are** GGG hashes → they match PoB / the API contract; no id mapping needed
  (spot-checked: node `4` present in both RePoE and the committed `tree-0_5.min.json`).
- Shape mapping worked out: 1623 groups, 5152 passives (1305 notable / 33 keystone), **578 unique
  icon paths**; `orbit_radii` / `skills_per_orbit` match the canvas's existing constants.
- Icons serve from `image.ggpk.exposed/poe2/<path>` (200 OK), same host the sibling repo uses.
- `stat_translations` format confirmed (condition / `index_handlers` / `format`) — the passive
  description file(s) are the one open item, deferred to the phase-1 spike below.

Not started: the four sequenced phases (fetch/transform scripts, icons, renderer, gems). This track
was pulled onto its own branch off `main` for the implementation work.

## Problem

The web canvas is pinned to **PoB's** tree. `packages/web/scripts/gen-min-tree.mjs` reads
`packages/pob-bridge/pob-runtime/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json` (the vendored
submodule) and emits `packages/web/public/tree-0_5.min.json`. That has two costs:

1. **Regenerating the canvas needs the submodule checked out** — the one coupling `08-fork-prep.md`
   task 6 tried to keep to a single committed artifact. `git worktree add` skips submodules, so a
   fresh web worktree cannot regenerate the tree without an extra `submodule update`.
2. **No art.** `06-tree-canvas.md` deliberately dropped all GGG art and renders stylised dots. The
   layout is faithful but a normal node and a notable are the same dot in different sizes; the tree
   is hard to read against the in-game one.

Neither is fatal, but both trace back to the same root: the web tree's only source is whatever PoB
happens to vendor. This track moves the **web** tree — geometry, node metadata, node art, and the
gem asset layer — onto [RePoE-fork](https://repoe-fork.github.io/poe2/), a community data project
that publishes the same data GGG exports, keyed the same way, and updated per patch.

**Scope boundary that makes this safe:** the **calc engine is untouched.** `src/core` keeps running
`optimiseTree` / `recommendTree` against PoB's own `tree.json` via the LuaJIT bridge — PoB stays the
fitness oracle (`07-performance.md`, README decision 5). This track only changes where the **web
render layer** sources its layout and art. The two stay consistent for free because RePoE-fork's
node ids **are GGG node hashes**, which are exactly the ids PoB uses and the ids the API already
returns (`OptimiseResultDTO.allocatedNodeIds`, `BuildSummary.allocatedNodeIds`). No id mapping
table.

## Decisions of record (2026-08-29, with the user)

1. **Source the web tree from RePoE-fork, not the sibling repo's approach.** `poe2-build-planner`
   pins a *manually downloaded* GGG export (`Skill Trees/0.5.2/data.json`, "no auto-fetch script").
   RePoE-fork instead **auto-publishes** `passive_skill_trees/Default.min.json` per patch, so a
   fetch script gets genuine currency, not a manual pin. We mirror the sibling repo's *gem* pattern
   (`fetch-data.mjs` pulls `skill_gems.json` from RePoE-fork), not its *tree* pattern.
2. **Full node-art rendering** — reverses `06-tree-canvas.md`'s "shapes, not sprites". The canvas
   draws real per-node icons; the stylised dot becomes the low-LOD / fallback tier, and the diff
   overlay (allocated / added / dropped / anchor) is kept and drawn *on top* of the icon.
3. **Stat tooltip text comes from RePoE-fork too** (`stat_translations`), not PoB — so the web tree
   is fully decoupled from the submodule. A stat that can't be translated falls back to raw
   `id: value`.
4. **Include the gem asset layer now**, even though no web consumer exists yet: `skill_gems.json` +
   gem icons as committed artifacts, mirroring the sibling repo. Deliberate front-run (the user
   asked for it); flagged as a non-goal for *rendering* — see Non-goals.
5. **Committed artifacts, not a build step** — unchanged from `08-fork-prep.md` task 6. The fetch
   scripts are run by hand on a version bump; their outputs (`tree-0_5.min.json`, icons, gem data)
   are committed. No fetch at `vite build` time.
6. **Node ids stay GGG hashes.** The contract (`03-shared-contract.md`) and the calc engine are
   untouched; `Results.isVersionMismatch` / the id-overlap fallback keep working unchanged.
7. **One shared render path — icons land in `draw.ts` / `TreeCanvas`, nowhere else.** Every tree
   render already goes through the single `TreeCanvas` component and its `draw.ts` (Results
   before/after diff *and* the Configure / rollback `TreePreview`, per `09`). Icon rendering,
   the LOD threshold, and the icon cache go there, so **every** render inherits the styling — there
   is no second, un-styled draw path. Any future tree view reuses `TreeCanvas`; it must not
   re-implement drawing.

## Sources (all under `https://repoe-fork.github.io/poe2/`)

| Asset | URL | Notes |
| --- | --- | --- |
| Passive tree | `passive_skill_trees/Default.min.json` | ~3 MB. `groups`, `passives`, `orbit_radii`, `skills_per_orbit`, `art`, `roots`. |
| Stat text | `stat_translations/<file>.min.json` | Split by domain; the passive-relevant file(s) resolved in phase 1 (see Risks). |
| Gems | `skill_gems.json` | Same file the sibling repo pulls. |
| Icons (nodes + gems) | `https://image.ggpk.exposed/poe2/<icon_path>` | `.dds` source → served as `.png`; same host + pattern as the sibling repo's gem-icon fetch. |

RePoE-fork also publishes `Atlas` / `EndgameMap` / `Royale` trees and `base_items` / `uniques` /
`mods` etc. — out of scope here (see Non-goals).

### RePoE-fork tree shape → our tuple

RePoE stores geometry per **group**, not per node:

```jsonc
// groups["0"]
{ "x": -22597.4, "y": -2727.5, "passives": [
  { "hash": 42761, "radius": 0, "position_clockwise": 0,
    "connections": [11335, 21284, ...], "splines": [...] }
]}
// passives["4"]  (keyed by hash as a string)
{ "hash": 4, "id": "lightning14", "name": "Shock Chance",
  "is_notable": false, "is_keystone": false, "is_jewel_socket": false,
  "icon": "Art/2DArt/SkillIcons/passives/LightningDamagenode.dds",
  "stats": { "shock_chance_+%": 15 } }
```

Mapping onto the existing min-tree tuple (see `minTree.ts` `RawMinTree` and
`gen-min-tree.mjs` `meta.nodeFields`):

| Tuple field | Source | Note |
| --- | --- | --- |
| `group` | the group id the passive appears under | inverted from `groups[].passives[]` |
| `orbit` | `passive.radius` | RePoE names the orbit index `radius` |
| `orbitIndex` | `passive.position_clockwise` | |
| `nameIdx` | intern `passive.name` | |
| `kind` | `is_keystone` / `is_notable` / `is_jewel_socket` / (attribute heuristic) / normal | same `KIND` map |
| `conns` | `group passive.connections` | ids, as today |
| `statIdx?` | intern translated stat lines | via `stat_translations` (decision 3) |
| `ascNameIdx?` | `passive.ascendancy` name if present | preserves the ascendancy exclusion in `parseMinTree` |

**New field: `iconIdx`** appended to the tuple (interned icon path), so the renderer can resolve a
node's PNG. `minTree.ts` `RawMinTree` + `parseMinTree` gain it; `RenderNode` gains `icon: string`.

Verified facts (probed 2026-08-29): `Default.min.json` has 1623 groups, 5152 passives (1305
notable, 33 keystone), **578 unique icon paths** (416 notable) — so icon rendering dedupes to <600
images, no sprite atlas required. `orbit_radii` / `skills_per_orbit` match the constants the canvas
already uses, so `nodePosition` in `minTree.ts` is unchanged.

## Components

### 1. `packages/web/scripts/fetch-tree.mjs` (replaces `gen-min-tree.mjs`)

Fetches `Default.min.json` + the passive `stat_translations` file(s), transforms to the **same
`tree-0_5.min.json` shape** (plus `iconIdx`), writes to `packages/web/public/`. Pins a
`TREE_SOURCE_VERSION` (the RePoE `title` / a dated tag) into `meta` alongside the existing
`treeVersion: "0_5"`. `gen-min-tree.mjs` is deleted; its header rationale moves here.

Structure mirrors the sibling repo's `fetch-data.mjs`: an exported `fetchTree(destRoot, fetchImpl)`
plus a `import.meta.url === process.argv[1]` runner, so the transform is unit-testable with a
fixture and a fake `fetchImpl`.

### 2. Stat translator (`packages/web/scripts/statTranslate.mjs`)

Pure function: `(statMap, translations) -> string[]`. Implements the RePoE
`{ ids, English: [{ condition, format, index_handlers, string }] }` format — match the entry whose
`condition` bounds contain the value(s), apply `index_handlers` (e.g. `divide_by_*`,
`per_minute_to_per_second`, `negate`) and the `format` (`#`, `+#`, `ignore`), substitute into
`string`. Missing id ⇒ raw `"<id>: <value>"`. Unit-tested against a handful of representative ids
(a plain `#`, a `+#`, a negate/divide, a multi-id line, and a deliberate miss).

### 3. `packages/web/scripts/fetch-icons.mjs`

Ported from the sibling repo: dedupe icon paths, concurrency pool, skip-existing, `.dds` → `.png`
under `packages/web/public/icons/tree/<path>.png`. Fed the unique node-icon set from the tree
transform (write the set to a sidecar, or re-derive from `tree-0_5.min.json`). Reports
downloaded / skipped / failed.

### 4. Renderer: real node icons (`nodeVisual.ts`, `draw.ts`, `lod.ts`, an icon cache)

- **Icon cache** (`packages/web/src/render/iconCache.ts`): `Map<path, HTMLImageElement>`, load on
  demand, trigger a redraw on load (`onload -> requestDraw()`), never block the frame.
- **`draw.ts`**: at icon-visible LOD, `drawImage` the node's icon centred at `(sx, sy)` sized by
  kind; keep the current arc-dot path for the lowest LOD and as the fallback when an image hasn't
  loaded. The diff overlay (ring / tint from `nodeVisual`) draws on top so allocated / added /
  dropped / anchor still read.
- **`nodeVisual.ts`**: gains the icon path + a flag for "draw icon vs dot"; the tint/ring/diff
  logic is retained for the overlay.
- **`lod.ts`**: an icon-visibility zoom threshold (dots below it — 5k `drawImage`s at min zoom is
  wasteful and unreadable).

The `RenderNode.icon` comes from `parseMinTree` (field 2 above).

### 5. Gem asset layer (`fetch-gems.mjs` + gem icons)

`fetch-gems.mjs` pulls `skill_gems.json` → `packages/web/public/data/gems.json`; gem icons reuse
the phase-3 fetch-icons machinery (the sibling repo's `collectIconPaths` filter for hidden/dev
gems is ported as-is) → `packages/web/public/icons/gems/`. **Data + icons only — no gem UI**
(Non-goals).

## Testing (fast suite only, per `CLAUDE.md`)

- **transform** — `fetch-tree.mjs`'s pure transform over a small fixture slice of `Default.min.json`
  (2–3 groups incl. a notable, a keystone, a jewel socket, an ascendancy node) → expected tuples,
  incl. `iconIdx` interning and the group→node geometry inversion.
- **statTranslate** — the representative-ids table above, incl. the raw-value fallback.
- **`parseMinTree`** — accepts the new `iconIdx`, populates `RenderNode.icon`, and stays
  backward-tolerant of a tuple without it (so an old committed file still parses during the
  transition).
- **iconCache** — returns a cached image on the second call; a load error doesn't throw into the
  draw loop.
- **renderer** — extend the existing canvas draw tests: an icon-visible LOD calls `drawImage` for a
  node with a loaded icon and falls back to the arc for one without; diff overlay still drawn.
- No integration test — nothing here boots a bridge or pool. The fetch scripts hit the network by
  hand on a version bump, not in CI.

## Risks

- **Which `stat_translations` file(s).** `character_panel_stat_descriptions.min.json` has only 27
  entries; passives use **1420 distinct stat ids**, so the right file (likely a general
  `stat_descriptions` + possibly `passive_skill` / `specific_skill` files merged) must be resolved
  first. **Phase 1 opens with a 30-min spike**: enumerate the passive stat-id set, find the
  file(s) that cover it, and confirm coverage % before building the translator. The raw-value
  fallback bounds the downside.
- **Node-id coverage vs PoB.** RePoE `Default` (5152) is a near-superset of the committed min-tree
  (4914); the delta is proxy / class-start / ascendancy nodes. Phase 1 asserts every id the API can
  return (allocatable nodes) exists in the RePoE set. If any allocatable id is missing, that id
  keeps its PoB-sourced entry (hybrid) — but coverage is expected to be complete.
- **Icon licensing.** Node/gem art is `© Grinding Gear Games`, fetched from `image.ggpk.exposed`
  and committed under `public/`. Same posture the sibling repo already takes for gem icons; keep
  the attribution note next to the assets.
- **Reversing `06`.** Icon rendering undoes a deliberate scope cut. `06` and `08` get superseding
  pointers to this doc (done in this track).

## Non-goals

- **Replacing PoB as the calc/tree oracle.** `src/core` + the bridge keep using PoB's `tree.json`
  (README decision 5, `07`). This is a render-layer source change only.
- **A gem UI** (picker, links, support-gem display). This track ships gem *data + icons* as an
  asset layer; the consumer is a later track.
- **Atlas / EndgameMap / Royale trees**, and the wider RePoE catalogue (`base_items`, `uniques`,
  `mods`, `ascendancies` beyond names). Fetch them when a consumer needs them.
- **Fetch at build time.** Committed artifacts only (decision 5).
- **A PoB-faithful DDS pipeline / sprite atlases.** We fetch the ~578 unique PNGs and `drawImage`;
  no runtime DDS decode, no atlas packing unless profiling later demands it.

## Sequencing

Each phase is independently shippable; the canvas keeps working (dots) until phase 4.

1. **Tree data** — the `stat_translations` spike, then `fetch-tree.mjs` + `statTranslate.mjs`;
   regenerate `tree-0_5.min.json` from RePoE (with `iconIdx`); `parseMinTree` + `RenderNode.icon`.
   Canvas still renders dots. Delete `gen-min-tree.mjs`.
2. **Node icons** — `fetch-icons.mjs`; commit `public/icons/tree/`.
3. **Renderer** — `iconCache`, `draw.ts` / `nodeVisual.ts` / `lod.ts` icon path + LOD threshold.
   This is the visible change.
4. **Gems** — `fetch-gems.mjs` + gem icons as committed assets. No UI.

Docs updated in this track: `README.md` (index row + decisions 6 & the non-goal), `06-tree-canvas.md`
and `08-fork-prep.md` (superseding pointers), `docs/ROADMAP.md` (track entry).
