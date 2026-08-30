// Pure decision for "what actions does the right-click menu offer for this node?", split out of
// TreeCanvas so it is unit-testable without a canvas/jsdom mount, following pick.ts's pattern.

export type ContextMenuAction = "freeze" | "unfreeze" | "anchor";

export interface ContextMenuItem {
  action: ContextMenuAction;
  label: string;
}

export function menuActionsFor(
  nodeId: number,
  frozenIds: Set<number>,
  canAnchor: boolean,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = frozenIds.has(nodeId)
    ? [{ action: "unfreeze", label: "Unfreeze" }]
    : [{ action: "freeze", label: "Freeze" }];
  if (canAnchor) items.push({ action: "anchor", label: "Anchor for rollback" });
  return items;
}
