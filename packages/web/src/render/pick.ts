// Pure decision for "was this pointer-up a click on a pickable node?", split out of TreeCanvas so
// it is unit-testable without a canvas/jsdom mount (docs/web-ui/09-rollback-tree-preview.md).

/**
 * Resolve a click selection. Returns the node id to pick, or null when this gesture is not a
 * selection: it was a drag (moved >= slop), missed a node, or hit a non-pickable one.
 */
export function clickPick(
  moved: number,
  slop: number,
  hit: number | null,
  pickable: Set<number> | undefined,
): number | null {
  if (moved >= slop) return null; // a pan, not a click
  if (hit == null || !pickable) return null;
  return pickable.has(hit) ? hit : null;
}
