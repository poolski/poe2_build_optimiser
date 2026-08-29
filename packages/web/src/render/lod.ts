// Ported from poe2-build-planner src/render/lod.ts (MIT -- see ./LICENSE.upstream).
// Re-skinned: our node kinds (normal/notable/keystone/jewel/attribute) instead of upstream's,
// and the "dot size by tier" radii the stylised spec (06) calls for.

import type { NodeKind } from "./types";

export type Lod = "dots" | "icons" | "full";

/** Choose detail by zoom (screen px per world unit). */
export function lodFor(zoom: number): Lod {
  if (zoom < 0.05) return "dots";
  if (zoom < 0.18) return "icons";
  return "full";
}

/** Base node radius in world units, by kind -- "dot size by tier" (06). */
export const NODE_WORLD_RADIUS: Record<NodeKind, number> = {
  normal: 24,
  attribute: 20,
  jewel: 34,
  notable: 42,
  keystone: 58,
};
