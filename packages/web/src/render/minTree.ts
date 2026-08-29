// Data-load glue: parse packages/web/public/tree-0_5.min.json into the MinTree the ported
// renderer consumes. This is the "rewrite the schema-facing part against PoB's tree" work
// docs/web-ui/06-tree-canvas.md calls for -- upstream's src/tree/ (GGG dev-export schema) is
// deliberately NOT ported.
//
// min-tree node tuple (see meta.nodeFields):
//   [group, orbit, orbitIndex, nameIdx, kind, conns[], statIdx[]?, ascNameIdx?]
// kind: 0 normal | 1 notable | 2 keystone | 3 jewel | 4 attribute
// A node with ascNameIdx (tuple[7]) is an ascendancy node -> excluded from the main render pass.

import { KINDS, type MinTree, type NodeKind, type RenderNode, type WorldRect } from "./types";

interface RawMinTree {
  meta: { treeVersion: string };
  bounds: WorldRect;
  constants: { orbitRadii: number[]; skillsPerOrbit: number[]; PSSCentreInnerRadius: number };
  strings: string[];
  groups: Record<string, [number, number]>;
  nodes: Record<
    string,
    [number, number, number, number, number, number[], number[]?, number?]
  >;
  nodeFlags: Record<string, { ascStart?: boolean; classesStart?: string[] }>;
}

/** world position, PoB convention: index 0 -> straight up. */
export function nodePosition(
  gx: number,
  gy: number,
  orbit: number,
  orbitIndex: number,
  orbitRadii: number[],
  skillsPerOrbit: number[],
): { x: number; y: number } {
  const r = orbitRadii[orbit] ?? 0;
  const per = skillsPerOrbit[orbit] || 1;
  const a = (2 * Math.PI * orbitIndex) / per;
  return { x: gx + r * Math.sin(a), y: gy - r * Math.cos(a) };
}

function kindOf(k: number): NodeKind {
  return KINDS[k] ?? "normal";
}

export function parseMinTree(raw: unknown): MinTree {
  const src = raw as RawMinTree;
  const { orbitRadii, skillsPerOrbit } = src.constants;

  const groups = new Map<number, { x: number; y: number }>();
  for (const [gid, xy] of Object.entries(src.groups)) {
    groups.set(Number(gid), { x: xy[0], y: xy[1] });
  }

  const nodesById = new Map<number, RenderNode>();
  for (const [nid, t] of Object.entries(src.nodes)) {
    const id = Number(nid);
    const [group, orbit, orbitIndex, nameIdx, kind, conns] = t;
    const ascNameIdx = t[7];
    if (ascNameIdx !== undefined) continue; // ascendancy node -- not in the main render pass
    const g = groups.get(group);
    if (!g) continue; // orphan-group reference; can't place it
    const statIdx = t[6] ?? [];
    const { x, y } = nodePosition(g.x, g.y, orbit, orbitIndex, orbitRadii, skillsPerOrbit);
    nodesById.set(id, {
      id,
      x,
      y,
      group,
      orbit,
      orbitIndex,
      kind: kindOf(kind),
      name: src.strings[nameIdx] ?? "",
      statLines: statIdx.map((i) => src.strings[i] ?? "").filter(Boolean),
      isAscendancy: false,
      conns: conns ?? [],
    });
  }

  // Symmetric adjacency over the rendered set only.
  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    let l = adjacency.get(a);
    if (!l) adjacency.set(a, (l = []));
    if (!l.includes(b)) l.push(b);
  };
  for (const n of nodesById.values()) {
    for (const c of n.conns) {
      if (!nodesById.has(c)) continue;
      link(n.id, c);
      link(c, n.id);
    }
  }

  // Bounds of the rendered set (the file `bounds` also spans far-flung ascendancy clusters).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodesById.values()) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = 200;
  const bounds: WorldRect =
    nodesById.size > 0
      ? { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
      : src.bounds;

  const ids = [...nodesById.keys()].sort((a, b) => a - b);
  return { treeVersion: src.meta.treeVersion, nodesById, adjacency, groups, bounds, ids };
}
