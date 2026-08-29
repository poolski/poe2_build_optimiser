// Shared shapes for the ported renderer. Upstream keyed everything off its GGG-schema
// `TreeData`; we key off PoB's tree instead (see minTree.ts), so the ported maths files
// (viewport / spatialIndex / arc) depend only on these minimal structural types.

/** kind index in tree-0_5.min.json: 0 normal | 1 notable | 2 keystone | 3 jewel | 4 attribute */
export type NodeKind = "normal" | "notable" | "keystone" | "jewel" | "attribute";

export const KINDS: readonly NodeKind[] = ["normal", "notable", "keystone", "jewel", "attribute"];

export interface RenderNode {
  id: number;
  /** world-space position, PoB convention: x = gx + r*sin(a), y = gy - r*cos(a) */
  x: number;
  y: number;
  group: number;
  orbit: number;
  orbitIndex: number;
  kind: NodeKind;
  name: string;
  statLines: string[];
  /** ascendancy nodes are excluded from the main render pass; kept for completeness */
  isAscendancy: boolean;
  conns: number[];
}

export type GroupMap = Map<number, { x: number; y: number }>;

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MinTree {
  treeVersion: string;
  nodesById: Map<number, RenderNode>;
  /** symmetric neighbour lists over the rendered (non-ascendancy) set */
  adjacency: Map<number, number[]>;
  groups: GroupMap;
  /** bounds of the rendered set (not the raw file bounds, which include far-flung ascendancy clusters) */
  bounds: WorldRect;
  /** rendered ids, ascending */
  ids: number[];
}

/** Per-node diff state for the result overlay. `added` = in `after` only; `dropped` = in
 * `before` only (covers both explicit `removed[]` picks and path nodes that cascaded off);
 * `anchor` = the rollback anchor id. Precedence: anchor > dropped > added > allocated. */
export type DiffState = "unallocated" | "allocated" | "added" | "dropped" | "anchor";

export interface DiffSets {
  before: Set<number>;
  after: Set<number>;
  /** the `--rollback-to` anchor, if this was a rollback run */
  anchor: number | null;
}

export function diffStateOf(id: number, d: DiffSets): DiffState {
  if (d.anchor === id) return "anchor";
  const inBefore = d.before.has(id);
  const inAfter = d.after.has(id);
  if (inBefore && !inAfter) return "dropped";
  if (!inBefore && inAfter) return "added";
  if (inAfter) return "allocated";
  return "unallocated";
}
