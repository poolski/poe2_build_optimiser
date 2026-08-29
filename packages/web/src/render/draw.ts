// Adapted from poe2-build-planner src/render/draw.ts (MIT -- see ./LICENSE.upstream). Upstream
// blits sprite atlases + a DDS ascendancy overlay; this is the stylised-shapes rewrite
// (docs/web-ui/06-tree-canvas.md): plain arcs for nodes, category tint + diff overlay, no art.

import { edgeGeometry } from "./arc";
import { lodFor } from "./lod";
import { nodeVisual } from "./nodeVisual";
import { queryRect, type SpatialIndex } from "./spatialIndex";
import { diffStateOf, type DiffSets, type MinTree } from "./types";
import { visibleWorldRect, worldToScreen, type Size, type Viewport } from "./viewport";

const BG = "#0a0806";
const EDGE_DIM = "rgba(122,108,78,0.16)";
const EDGE_ALLOC = "rgba(200,168,106,0.85)"; // both endpoints allocated after the plan -- gold
const EDGE_DROPPED = "rgba(215,96,80,0.55)"; // both endpoints in `before` only -- blood

export interface DrawParams {
  tree: MinTree;
  index: SpatialIndex;
  vp: Viewport;
  size: Size;
  diff: DiffSets;
  hover: number | null;
}

export function drawTree(ctx: CanvasRenderingContext2D, p: DrawParams): void {
  const { tree, index, vp, size, diff, hover } = p;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size.width, size.height);

  const world = visibleWorldRect(vp, size);
  const pad = 400;
  const visible = queryRect(index, {
    minX: world.minX - pad,
    minY: world.minY - pad,
    maxX: world.maxX + pad,
    maxY: world.maxY + pad,
  });
  const lod = lodFor(vp.zoom);

  // Edges -- skipped at the dots LOD. Dedup by only drawing nb > id.
  if (lod !== "dots") {
    ctx.lineWidth = Math.max(0.5, 3 * vp.zoom);
    for (const id of visible) {
      const a = tree.nodesById.get(id);
      if (!a) continue;
      for (const nb of tree.adjacency.get(id) ?? []) {
        if (nb <= id) continue;
        const b = tree.nodesById.get(nb);
        if (!b) continue;
        const bothAfter = diff.after.has(id) && diff.after.has(nb);
        const bothBefore = diff.before.has(id) && diff.before.has(nb);
        ctx.strokeStyle = bothAfter ? EDGE_ALLOC : bothBefore ? EDGE_DROPPED : EDGE_DIM;
        const geom = edgeGeometry(a, b, tree.groups);
        ctx.beginPath();
        if (geom.kind === "arc") {
          const c = worldToScreen(vp, size, geom.cx, geom.cy);
          ctx.arc(c.sx, c.sy, geom.r * vp.zoom, geom.a0, geom.a1, geom.anticlockwise);
        } else {
          const pa = worldToScreen(vp, size, a.x, a.y);
          const pb = worldToScreen(vp, size, b.x, b.y);
          ctx.moveTo(pa.sx, pa.sy);
          ctx.lineTo(pb.sx, pb.sy);
        }
        ctx.stroke();
      }
    }
  }

  // Nodes.
  for (const id of visible) {
    const n = tree.nodesById.get(id);
    if (!n) continue;
    const state = diffStateOf(id, diff);
    const s = worldToScreen(vp, size, n.x, n.y);

    if (lod === "dots") {
      // Only allocated / diff nodes carry ink when fully zoomed out -- keeps the shape readable.
      const v = nodeVisual(n, state);
      const r = Math.max(state === "unallocated" ? 0.6 : 1.4, v.radius * vp.zoom * 0.5);
      ctx.fillStyle = v.fill;
      ctx.globalAlpha = state === "unallocated" ? 0.5 : 1;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }

    const v = nodeVisual(n, state);
    const r = Math.max(1, v.radius * vp.zoom);
    ctx.fillStyle = v.fill;
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
    ctx.fill();

    if (v.ring || v.stroke) {
      ctx.strokeStyle = v.stroke ?? "#ecd49a";
      ctx.lineWidth = Math.max(1, v.strokeWidth * vp.zoom);
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, r + Math.max(1.5, r * 0.28), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Hover ring.
  if (hover != null) {
    const n = tree.nodesById.get(hover);
    if (n) {
      const s = worldToScreen(vp, size, n.x, n.y);
      const v = nodeVisual(n, diffStateOf(hover, diff));
      const r = Math.max(2, v.radius * vp.zoom);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
