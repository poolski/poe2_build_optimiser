// Ported from poe2-build-planner src/render/spatialIndex.ts (MIT -- see ./LICENSE.upstream).
// Same grid-bucket index; adapted to iterate our MinTree (nodesById + ids) instead of
// upstream's `tree.mainSkills` / `nodesBySkill`.

import type { MinTree, WorldRect } from "./types";

export interface SpatialIndex {
  cellSize: number;
  cells: Map<string, number[]>; // "cx,cy" -> node ids
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function buildSpatialIndex(tree: MinTree, cellSize = 400): SpatialIndex {
  const cells = new Map<string, number[]>();
  for (const id of tree.ids) {
    const n = tree.nodesById.get(id);
    if (!n) continue;
    const key = cellKey(Math.floor(n.x / cellSize), Math.floor(n.y / cellSize));
    const bucket = cells.get(key);
    if (bucket) bucket.push(id);
    else cells.set(key, [id]);
  }
  return { cellSize, cells };
}

export function queryRect(index: SpatialIndex, rect: WorldRect): number[] {
  const { cellSize, cells } = index;
  const minCx = Math.floor(rect.minX / cellSize);
  const maxCx = Math.floor(rect.maxX / cellSize);
  const minCy = Math.floor(rect.minY / cellSize);
  const maxCy = Math.floor(rect.maxY / cellSize);
  const out: number[] = [];
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const bucket = cells.get(cellKey(cx, cy));
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

/** Nearest node to (wx, wy) within `radius` world units, or null. */
export function nodeAt(
  index: SpatialIndex,
  tree: MinTree,
  wx: number,
  wy: number,
  radius: number,
): number | null {
  const candidates = queryRect(index, {
    minX: wx - radius,
    minY: wy - radius,
    maxX: wx + radius,
    maxY: wy + radius,
  });
  let best: number | null = null;
  let bestDist = radius * radius;
  for (const id of candidates) {
    const n = tree.nodesById.get(id);
    if (!n) continue;
    const dx = n.x - wx;
    const dy = n.y - wy;
    const d = dx * dx + dy * dy;
    if (d <= bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}
