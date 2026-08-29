// Re-skinned from poe2-build-planner src/render/nodeVisual.ts (MIT -- see ./LICENSE.upstream).
// Upstream returned an allocated/canAllocate/unallocated string; here it is the full stylised
// style lookup intake/web-ui/06-tree-canvas.md pins to this file: "dot size by tier + PoE2 colour
// + minimal decoration", plus the diff overlay tint (allocated / added / dropped / anchor).

import { NODE_WORLD_RADIUS } from "./lod";
import type { DiffState, NodeKind, RenderNode } from "./types";

export interface NodeVisual {
  /** world-unit radius */
  radius: number;
  fill: string;
  /** ring / outline colour, or null for none */
  stroke: string | null;
  /** world-unit stroke width */
  strokeWidth: number;
  /** draw the decorative ring (notables, keystones) */
  ring: boolean;
}

// PoE2 category tints (str/dex/int/hybrid + structural kinds). We only get attribute *category*
// from stat text, so this is a light heuristic -- documented deviation from 06's "str/dex/int
// tint" (the min tree carries no per-node attribute category).
const TINT: Record<NodeKind, string> = {
  normal: "#8a7d5a", // gold-grey
  attribute: "#8a7d5a", // overridden below when the stat text names an attribute
  jewel: "#5ab0c8", // cyan
  notable: "#c8a86a", // gold
  keystone: "#b98adf", // amethyst
};

const ATTR_TINT: Array<[RegExp, string]> = [
  [/strength/i, "#d76050"],
  [/dexterity/i, "#5aa85a"],
  [/intelligence/i, "#6a9ec8"],
];

// Diff overlay -- these override the category fill entirely.
const DIFF_FILL: Partial<Record<DiffState, string>> = {
  added: "#5aa85a", // jade
  dropped: "#d76050", // blood
  anchor: "#6a9ec8", // blue
};

const DIM = "#4a4230";

function categoryFill(node: RenderNode): string {
  if (node.kind === "attribute") {
    for (const [re, col] of ATTR_TINT) {
      if (node.statLines.some((s) => re.test(s))) return col;
    }
  }
  return TINT[node.kind];
}

export function nodeVisual(node: RenderNode, state: DiffState): NodeVisual {
  const base = NODE_WORLD_RADIUS[node.kind];
  const ring = node.kind === "notable" || node.kind === "keystone";

  if (state === "unallocated") {
    return { radius: base * 0.72, fill: DIM, stroke: ring ? "#3a3327" : null, strokeWidth: base * 0.14, ring };
  }

  const diff = DIFF_FILL[state];
  const fill = diff ?? categoryFill(node);
  // allocated & anchor stay at base size; added/dropped pop slightly larger so the diff reads.
  const radius = state === "added" || state === "dropped" || state === "anchor" ? base * 1.18 : base;
  const stroke =
    state === "anchor"
      ? "#bcd8ef"
      : state === "added"
        ? "#a6e0a6"
        : state === "dropped"
          ? "#f0b6ac"
          : ring
            ? "#ecd49a"
            : null;

  return { radius, fill, stroke, strokeWidth: base * (ring || diff ? 0.2 : 0.12), ring };
}
