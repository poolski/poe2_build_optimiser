// Step 4: the headline + tree canvas + node-list diff + updated PoB code
// (docs/web-ui/05-frontend.md screen 4, 06-tree-canvas.md). The canvas is the headline; the
// list stays visible beside it and is the sole view when the tree can't be rendered (build tree
// version != the shipped min tree, i.e. too many ids unknown to it).

import { useMemo, useState } from "react";
import type { BuildSummary, OptimiseResultDTO } from "@poe2/contract";
import NodeDiff, { fmt } from "../components/NodeDiff";
import { TreeCanvas } from "../render";
import { useMinTree } from "../hooks/useMinTree";

interface Props {
  result: OptimiseResultDTO;
  build?: BuildSummary;
  onRestart: () => void;
}

const STOPPED_TEXT: Record<string, string> = {
  "budget-reached": "spent the whole budget",
  "no-positive-candidate": "no further improving node found",
  "no-candidates": "no candidate nodes in range",
  "nothing-to-do": "already optimal — no change recommended",
  "nothing-removable": "nothing could be freed",
  "repair-not-worthwhile": "the loaded tree already wins — no change recommended",
  cancelled: "stopped early — partial result",
};

export default function Results({ result, build, onRestart }: Props) {
  const mt = useMinTree();
  const [showListOnly, setShowListOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const { before, after } = result.allocatedNodeIds;
  const anchor = result.anchorNodeId ?? null;

  const coverage = useMemo(() => {
    if (mt.status !== "ready" || after.length === 0) return 0;
    let known = 0;
    for (const id of after) if (mt.tree.nodesById.has(id)) known++;
    return known / after.length;
  }, [mt, after]);

  const canRenderCanvas = mt.status === "ready" && coverage >= 0.5 && !showListOnly;
  const versionMismatch = mt.status === "ready" && coverage < 0.5;

  const b = result.baseline.objective;
  const f = result.final.objective;
  const changePct = Number.isFinite(b) && b !== 0 ? ((f - b) / Math.abs(b)) * 100 : NaN;

  const copy = () => {
    void navigator.clipboard?.writeText(result.updatedPobCode).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <div className="panel">
      <p className="headline">
        <strong>{fmt(b)}</strong> &rarr; <strong>{fmt(f)}</strong>{" "}
        {Number.isFinite(changePct) && (
          <span className={changePct >= 0 ? "delta-pos" : "delta-neg"}>
            ({changePct >= 0 ? "+" : ""}
            {changePct.toFixed(1)}%)
          </span>
        )}
      </p>

      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>Mode</dt>
        <dd>
          {result.mode}
          {result.beamWidth != null ? ` · beam width ${result.beamWidth}` : ""}
          {anchor != null ? ` · rollback to ${anchor}` : ""}
        </dd>
        <dt>Net points</dt>
        <dd>
          {result.mode === "repair"
            ? `freed ${result.pointsFreed} / re-spent ${result.pointsRespent} (net ${result.final.pointsSpent})`
            : `${result.final.pointsSpent >= 0 ? "+" : ""}${result.final.pointsSpent}`}
        </dd>
        <dt>Outcome</dt>
        <dd>{STOPPED_TEXT[result.stoppedBecause] ?? result.stoppedBecause}</dd>
        {build && (
          <>
            <dt>Build</dt>
            <dd>
              {build.className}
              {build.ascendancy ? ` · ${build.ascendancy}` : ""} · L{build.level}
            </dd>
          </>
        )}
      </dl>

      {versionMismatch && (
        <div className="warn">
          The shipped tree render doesn&rsquo;t match this build&rsquo;s tree version
          (only {Math.round(coverage * 100)}% of allocated nodes are known to it). Showing the
          node-list diff only.
        </div>
      )}

      {canRenderCanvas && mt.status === "ready" && (
        <div style={{ marginBottom: 8 }}>
          <TreeCanvas minTree={mt.tree} before={before} after={after} anchor={anchor} />
          <button className="ghost" style={{ marginTop: 6 }} onClick={() => setShowListOnly(true)}>
            hide canvas
          </button>
        </div>
      )}
      {showListOnly && !versionMismatch && (
        <button className="ghost" style={{ marginBottom: 8 }} onClick={() => setShowListOnly(false)}>
          show canvas
        </button>
      )}
      {mt.status === "loading" && <p className="note">loading tree render…</p>}
      {mt.status === "error" && (
        <p className="note">tree render unavailable ({mt.message}) — node-list diff below.</p>
      )}

      <NodeDiff result={result} />

      <fieldset style={{ marginTop: 16 }}>
        <legend>Updated PoB code</legend>
        <textarea readOnly rows={4} value={result.updatedPobCode} />
        <button className="primary" style={{ marginTop: 8 }} onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <p className="note">Paste back into Path of Building.</p>
      </fieldset>

      <p className="footer-stats">
        {result.buildOutputCount != null && `${result.buildOutputCount} recomputes`}
        {result.buildOutputSeconds != null && ` · ${result.buildOutputSeconds.toFixed(1)}s sim`}
        {` · cache hit ${(result.cacheHitRate * 100).toFixed(0)}%`}
      </p>

      <details className="raw" open={showRaw}>
        <summary onClick={(e) => { e.preventDefault(); setShowRaw((s) => !s); }}>
          Raw result JSON
        </summary>
        {showRaw && <pre>{JSON.stringify(result, null, 2)}</pre>}
      </details>

      <div style={{ marginTop: 16 }}>
        <button className="ghost" onClick={onRestart}>
          Start over
        </button>
      </div>
    </div>
  );
}
