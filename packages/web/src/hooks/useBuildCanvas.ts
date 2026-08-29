// Shared "can the shipped canvas render this build?" decision, so RunConfig (for the rollback
// enable/disable gate) and TreePreview (for what to draw) agree on one source of truth. Reuses
// Results' isVersionMismatch -- the exact check 05/06 specified -- against the build's current
// allocated set. Spec: docs/web-ui/09-rollback-tree-preview.md.

import { useMemo } from "react";
import type { BuildSummary } from "@poe2/contract";
import { useMinTree, type MinTreeState } from "./useMinTree";
import { isVersionMismatch } from "../steps/Results";

export interface BuildCanvasState {
  mt: MinTreeState;
  /** Build tree version differs from the shipped render (or the id-overlap fallback failed). */
  versionMismatch: boolean;
  /** The tree is loaded and renders this build -- pickable, previewable. */
  canRender: boolean;
}

export function useBuildCanvas(build: BuildSummary): BuildCanvasState {
  const mt = useMinTree();
  return useMemo(() => {
    if (mt.status !== "ready") return { mt, versionMismatch: false, canRender: false };
    const ids = build.allocatedNodeIds;
    let known = 0;
    for (const id of ids) if (mt.tree.nodesById.has(id)) known++;
    const coverage = ids.length === 0 ? 0 : known / ids.length;
    const versionMismatch = isVersionMismatch(build.treeVersion, mt.tree.treeVersion, coverage);
    return { mt, versionMismatch, canRender: !versionMismatch };
  }, [mt, build.allocatedNodeIds, build.treeVersion]);
}
