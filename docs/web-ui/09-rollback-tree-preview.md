# 09 — Rollback tree preview + click-to-select anchor

Design of record. Added 2026-08-29.

## Problem

In the Configure step, Rollback mode asks for an **anchor node id** as a bare number input
(`RunConfig.tsx`). A user has no way to know which id corresponds to which node on their tree —
they'd have to cross-reference PoB by hand. The whole point of rollback ("free this node's
downstream subtree") is spatial, so the picker should be spatial too.

We already ship a passive-tree canvas, but only on the **Results** screen, and only as a
read-only *before/after diff*. This track reuses that renderer in the Configure step: draw the
loaded build's current tree, let the user click the node to roll back to, and preview which
nodes that would free.

## Decisions of record (2026-08-29, with the user)

1. **Preview in all modes; clickable only in rollback.** The current tree is drawn in Configure
   for extend / repair / rollback alike as a "here's your build" affordance. Only rollback makes
   nodes pickable.
2. **Freed-subtree preview.** Picking an anchor highlights the whole downstream cascade that
   rolling back would free, not just the anchor. This needs PoB's `DeallocNode` path logic, so
   the server computes it (see §API). Fetched on **click only** — not hover (too chatty).
3. **The anchor number input is removed**, replaced entirely by canvas click-to-select.
4. **Version mismatch disables rollback.** A build whose tree can't be rendered (declared
   `treeVersion` ≠ the shipped `min.json`, or the id-overlap fallback fails — reuse
   `Results.isVersionMismatch`) cannot pick an anchor, so rollback mode is disabled for it with
   the existing mismatch warning. No manual-entry fallback. Rare in practice: the app ships
   `0_5` and PoB works in its bundled `0_5`, so allocated ids always land in the rendered layout;
   the mismatch guard only bites XML that *declares* a different version.
5. **No "points freed" count.** The cascade result is node ids only. A true freed-*points* count
   has weapon-set subtleties (`docs/status.md` "Blocker (a)") not worth faking for a preview; the
   UI shows `freedNodeIds.length` labelled as nodes.

## Why the XML can't render the tree itself

A PoB `<Spec>` carries `treeVersion` + a flat list of allocated node **ids** — no coordinates,
groups, orbits, connections, or names. All geometry lives in PoB's `tree.json`, of which
`packages/web/public/tree-0_5.min.json` is a pinned snapshot. Rendering is always
`layout (from the snapshot) + allocated ids (from the XML)`. Sourcing the layout from the bridge
per build was considered and rejected: it re-couples the web track to the LuaJIT submodule that
fork-prep (`08`) deliberately severed, adds a ~400 KB payload per build, and PoB only bundles the
version it ships anyway. Not worth it while everything is `0_5`.

## Contract changes (`packages/contract`)

### `BuildSummary` gains `allocatedNodeIds`

```ts
allocatedNodeIds: z.array(z.number().int()), // id-sorted; same node filter as list_allocated_nodes
```

Lets the canvas draw the current tree with no extra client round-trip. Same sanitisation and
id-filter semantics as `OptimiseResultDTO.allocatedNodeIds` (class/ascendancy-start + item-granted
nodes excluded). Parse + reject tests alongside the existing `BuildSummary` tests.

### New `CascadeResult`

```ts
export const CascadeResult = z.object({
  anchorNodeId: z.number().int(),
  freedNodeIds: z.array(z.number().int()), // id-sorted; the anchor's downstream DeallocNode cascade
});
export type CascadeResult = z.infer<typeof CascadeResult>;
```

Exported from `index.ts`. The request body is `{ anchorNodeId: number }` — small enough to inline
in the route with `z.object({ anchorNodeId: z.number().int() })` rather than name a schema, unless
symmetry with the other request types reads better at implementation time.

## API changes (`packages/api`)

### `store.ingest` includes `allocatedNodeIds`

One extra bridge call on the already-acquired lease, before `release()`:

```ts
const allocatedNodeIds = await bridge.call<number[]>("list_allocated_nodes");
```

No `recomputeBuild` — the no-arg `list_allocated_nodes` path adds zero BuildOutputs
(`docs/status.md` "RESOLVED — allocatedNodeIds.{before,after}"). Feed it into the
`BuildSummarySchema.parse({...})`.

### New route `POST /api/builds/:id/cascade`

Body `{ anchorNodeId }` → `CascadeResult`. Stateless: it re-parses the stored XML on a fresh
lease and diffs.

```text
build = store.get(id)                        // 404 if unknown
bridge = source.acquire()
try:
  load_build_xml(build.xml)                  // parse only, no recompute
  before = list_allocated_nodes()
  if anchorNodeId not in before: 400         // anchor must be allocated
  after  = list_allocated_nodes({ removeIds: [anchorNodeId] })
  freedNodeIds = sort(before \ after)
  return { anchorNodeId, freedNodeIds }
finally: bridge.release()
```

Deeper validity (ascendancy anchor, too-near-start per `MIN_ANCHOR_SPINE_POINTS`) is **not**
re-checked here — the existing run-time rejection in `optimiseTree` still guards the actual run.
The canvas already prevents most bad picks by only making allocated, rendered nodes pickable
(ascendancy nodes aren't in the render pass).

Wire the route into the app router next to the other `builds` routes.

## Web changes (`packages/web`)

### `OptimiserClient` gains `getCascade`

```ts
getCascade(buildId: string, anchorNodeId: number): Promise<CascadeResult>;
```

Implemented in `httpClient` (`POST /builds/:id/cascade`) and `mockClient` (derive a plausible
freed set from the canvas fixture — e.g. the fixture's `removedCascadeIds` for its anchor, or a
small deterministic subset — so the mock path exercises the highlight without a server).

### `TreeCanvas` gains click-to-select

New optional props; existing Results usage unchanged when they're omitted:

- `onPick?: (id: number) => void` — fired on a genuine click (`pointerup` with
  `drag.moved < CLICK_SLOP_PX`) when the hit node is pickable.
- `pickable?: Set<number>` — only nodes in this set fire `onPick` (and get a "pickable" cursor /
  hover affordance). Omitted ⇒ nothing is pickable (Results behaviour).
- Legend variant: relabel "dropped" → "freed" and hide "added" when in select context. A small
  `legend?: "diff" | "select"` prop, or pass the label strings in.

**`draw.ts` is untouched.** The freed overlay reuses `diffStateOf` by choosing the diff sets:

| Canvas state | `before` | `after` | `anchor` |
| --- | --- | --- | --- |
| preview, no pick | `allocatedNodeIds` | `allocatedNodeIds` | `null` |
| preview, anchor picked | `allocatedNodeIds` | `allocatedNodeIds − freedNodeIds` | picked id |

`diffStateOf` then renders the anchor blue, the freed cascade red ("dropped"), everything else
gold ("allocated") — the exact visual we want.

### New `TreePreview` component

Owns the canvas + cascade state for the Configure step. Props: `build`, `mode`, current
`anchorNodeId`, `onPickAnchor`, and the `client` (for `getCascade`).

- Uses `useMinTree`; computes `isVersionMismatch` (reuse the `Results` export or lift it to a
  shared module).
- **Mismatch** ⇒ render the warning, no canvas. In rollback mode this is what disables the
  picker (see `RunConfig` gating below).
- Renders `TreeCanvas` with `before = after = allocatedNodeIds` and `pickable` = the allocated ∩
  rendered id set **only in rollback mode**.
- On pick: call `onPickAnchor(id)` (sets `anchorNodeId` in the request) and `client.getCascade` →
  store `freedNodeIds` → recompute `after`. A fetch error shows an inline note and leaves the
  anchor set (the run still guards validity).

### `RunConfig` wiring

- Remove the anchor `<input type="number">` and the "respec budget" stays.
- Render `<TreePreview>` (all modes). In rollback mode it's the anchor picker; otherwise it's a
  read-only current-tree view.
- `canRun` gating for rollback: require `anchorNodeId !== undefined` **and** the tree is
  renderable (not a version mismatch). On mismatch, rollback mode shows the warning and Run stays
  disabled — effectively disabling rollback for that build.
- `App` passes the `client` down to `RunConfig` (it already holds it for job submission).

## Testing (fast suite only)

- **contract** — `BuildSummary` accepts/round-trips `allocatedNodeIds`, rejects a non-int / NaN
  entry; `CascadeResult` parse + reject.
- **api** — `store.ingest` puts `list_allocated_nodes` output on the summary (fake bridge);
  cascade route: happy path diff, unknown build → 404, non-allocated anchor → 400 (fake bridge
  returning canned allocated sets).
- **web** — `TreeCanvas`: `onPick` fires on click but **not** after a drag, and only for
  `pickable` ids; `TreePreview`: pick sets the anchor, requests the cascade, and renders the freed
  set (mock client); `RunConfig`: rollback `canRun` false until an anchor is picked, and false on
  a version mismatch.
- **integration** (`*.integration.test.ts`, not run routinely per `CLAUDE.md`) — one real-bridge
  cascade check: load a corpus build, pick a known interior anchor, assert `freedNodeIds` matches
  the `optimiseTree --rollback-to` cascade for that anchor.

## Non-goals

- Cascade on hover (click only).
- A precise freed-*points* number.
- Preview for the recommend job type.
- Sourcing tree geometry from the bridge per build (keep the pinned snapshot).

## Sequencing

Contract first (both additions), then API (store field + cascade route), then web (client →
`TreeCanvas` props → `TreePreview` → `RunConfig`). Contract and API are small and independent of
the canvas work; the web changes are the bulk.
