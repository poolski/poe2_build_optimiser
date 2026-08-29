// Step 3: live progress from the SSE stream (intake/web-ui/05-frontend.md screen 3). Renders from
// a single ProgressEvent. `phase` is an open string in the contract (phase 1.5 adds more) -- the
// label map has a default branch.

import type { ProgressEvent } from "@poe2/contract";
import { fmt } from "../components/NodeDiff";

const PHASE_LABEL: Record<string, string> = {
  baseline: "Measuring baseline",
  "regret-probe": "Probing removals",
  "add-loop": "Add loop (dominates wall time)",
  "k-sweep": "Sweeping respec depth",
  finalising: "Finalising",
  scoring: "Scoring candidates",
};

function phaseText(phase: string): string {
  return PHASE_LABEL[phase] ?? phase;
}

interface Props {
  progress?: ProgressEvent;
  baselineObjective?: number;
  error?: string;
  onCancel: () => void;
  onBack: () => void;
}

export default function RunProgress({ progress, baselineObjective, error, onCancel, onBack }: Props) {
  if (error) {
    return (
      <div className="panel">
        <p className="err">Job failed: {error}</p>
        <button className="ghost" onClick={onBack}>
          Back to config
        </button>
      </div>
    );
  }

  const p = progress;
  const elapsedS = p ? p.elapsedMs / 1000 : 0;
  const rate = p && elapsedS > 0 ? p.buildOutputs / elapsedS : 0;
  const barPct =
    p?.estimatedTotal && p.estimatedTotal > 0
      ? Math.min(100, (p.buildOutputs / p.estimatedTotal) * 100)
      : null;
  // `bestObjective` is optimise-only -- a recommend tick omits it (contract), and `0` is a real
  // objective for a 0-DPS-headless build, so this must key off presence, not truthiness.
  const best = p?.bestObjective;
  const delta =
    best != null && baselineObjective != null ? best - baselineObjective : null;

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{p ? phaseText(p.phase) : "Starting…"}</h2>

      {barPct != null ? (
        <div className="progress-bar" aria-label="recompute progress">
          <i style={{ width: `${barPct}%` }} />
        </div>
      ) : (
        <p className="note">{p ? `${p.buildOutputs} recomputes…` : "waiting for first tick…"}</p>
      )}

      {p && (
        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>Recomputes</dt>
          <dd>
            {p.buildOutputs}
            {p.estimatedTotal ? ` / ~${p.estimatedTotal}` : ""}
          </dd>
          {best != null && (
            <>
              <dt>Best objective</dt>
              <dd>
                {fmt(best)}{" "}
                {delta != null && (
                  <span className={delta >= 0 ? "delta-pos" : "delta-neg"}>
                    ({delta >= 0 ? "+" : ""}
                    {fmt(delta)} vs baseline)
                  </span>
                )}
              </dd>
            </>
          )}
          {p.depth != null && (
            <>
              <dt>Depth</dt>
              <dd>{p.depth}</dd>
            </>
          )}
          {p.k != null && (
            <>
              <dt>k</dt>
              <dd>
                {p.k}
                {p.kTotal ? ` / ${p.kTotal}` : ""}
              </dd>
            </>
          )}
          {p.candidatesScored != null && (
            <>
              <dt>Candidates</dt>
              <dd>
                {p.candidatesScored}
                {p.candidatesTotal ? ` / ${p.candidatesTotal}` : ""}
              </dd>
            </>
          )}
          <dt>Elapsed</dt>
          <dd>
            {elapsedS.toFixed(1)}s {rate > 0 && `· ${rate.toFixed(1)}/s`}
          </dd>
          {p.note && (
            <>
              <dt>Note</dt>
              <dd>{p.note}</dd>
            </>
          )}
        </dl>
      )}

      <p className="note" style={{ marginTop: 12 }}>
        Cancel stops the run within one add-step (seconds) and frees the bridge slot, so you can
        re-submit a corrected config immediately.
      </p>
      <button className="ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
