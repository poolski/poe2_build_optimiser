// The Configure-step tree preview (docs/web-ui/09-rollback-tree-preview.md). Draws the loaded
// build's current tree in every mode; in rollback mode the allocated nodes are clickable and
// picking one sets the anchor + previews the downstream subtree that rolling back would free.
//
// The freed overlay reuses the result canvas's diff renderer with no draw.ts change: before is
// the current allocated set, after is that set minus the freed cascade -> the anchor draws blue,
// the freed cascade red ("freed"), the rest gold.

import { useEffect, useMemo, useState } from "react";
import type { BuildSummary, OptimiseRequestInput } from "@poe2/contract";
import type { OptimiserClient } from "../api";
import { TreeCanvas } from "../render";
import { useBuildCanvas } from "../hooks/useBuildCanvas";

interface Props {
  build: BuildSummary;
  mode: OptimiseRequestInput["mode"];
  anchorNodeId: number | undefined;
  onPickAnchor: (id: number) => void;
  client: OptimiserClient;
}

export default function TreePreview({ build, mode, anchorNodeId, onPickAnchor, client }: Props) {
  const { mt, versionMismatch, canRender } = useBuildCanvas(build);
  const rollback = mode === "rollback";

  const [freed, setFreed] = useState<number[] | null>(null);
  const [cascadeError, setCascadeError] = useState<string | null>(null);

  // Fetch the freed subtree whenever the anchor changes (rollback + a renderable tree only).
  useEffect(() => {
    if (!rollback || anchorNodeId == null || !canRender) {
      setFreed(null);
      setCascadeError(null);
      return;
    }
    let cancelled = false;
    setFreed(null);
    setCascadeError(null);
    client.getCascade(build.buildId, anchorNodeId).then(
      (r) => {
        if (!cancelled) setFreed(r.freedNodeIds);
      },
      (e: unknown) => {
        if (!cancelled) setCascadeError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rollback, anchorNodeId, canRender, build.buildId, client]);

  const allocated = build.allocatedNodeIds;

  const pickable = useMemo(() => {
    if (!rollback || mt.status !== "ready") return undefined;
    return new Set(allocated.filter((id) => mt.tree.nodesById.has(id)));
  }, [rollback, mt, allocated]);

  const after = useMemo(() => {
    if (!freed || freed.length === 0) return allocated;
    const drop = new Set(freed);
    return allocated.filter((id) => !drop.has(id));
  }, [allocated, freed]);

  if (mt.status === "loading") return <p className="note">loading tree render…</p>;
  if (mt.status === "error") {
    return <p className="note">tree render unavailable ({mt.message}).</p>;
  }

  if (versionMismatch) {
    return (
      <div className="warn">
        The shipped tree render doesn&rsquo;t match this build&rsquo;s tree version
        {build.treeVersion !== null ? ` (build is ${build.treeVersion}, the render ships ${mt.tree.treeVersion}).` : "."}
        {rollback && " Rollback needs the tree render to pick a node, so it&rsquo;s unavailable for this build."}
      </div>
    );
  }

  return (
    <div>
      <TreeCanvas
        minTree={mt.tree}
        before={allocated}
        after={after}
        anchor={rollback ? anchorNodeId ?? null : null}
        onPick={rollback ? onPickAnchor : undefined}
        pickable={pickable}
        legend={rollback ? "select" : "diff"}
      />
      {rollback && (
        <p className="note">
          {anchorNodeId == null
            ? "Click a node on the tree to roll back to it — its whole downstream subtree is freed."
            : cascadeError
              ? `Selected node ${anchorNodeId}. Couldn't preview the freed subtree: ${cascadeError}`
              : freed
                ? `Rolling back to node ${anchorNodeId} frees ${freed.length} node${freed.length === 1 ? "" : "s"}.`
                : `Selected node ${anchorNodeId} — computing freed subtree…`}
        </p>
      )}
    </div>
  );
}
