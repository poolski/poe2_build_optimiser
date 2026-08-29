// The always-correct node-list diff (intake/web-ui/05-frontend.md screen 4). Stays visible beside
// the canvas, and is the only result view when the build's tree version != the shipped one.
// Pure render of OptimiseResultDTO -- no state.

import type { OptimiseResultDTO } from "@poe2/contract";

export function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function pct(from: number, to: number): string {
  if (!Number.isFinite(from) || from === 0) return "—";
  const p = ((to - from) / Math.abs(from)) * 100;
  const sign = p >= 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

export default function NodeDiff({ result }: { result: OptimiseResultDTO }) {
  const { removed, steps, addedNodeIds } = result;
  return (
    <div>
      <h3>
        Freed{" "}
        <span className="note">
          {removed.length === 0 ? "nothing" : `${result.pointsFreed} pts across ${removed.length}`}
        </span>
      </h3>
      {removed.length > 0 && (
        <ul className="diff-list">
          {removed.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> <span className="note">({r.type})</span>
              <span className="tag dropped">frees {r.pointsFreed} pt</span>
              {r.anchorCascade && <span className="tag anchor">anchor cascade</span>}
              <div className="stat">
                value lost: {fmt(r.valueLost)}
                {" · "}objective without it: {fmt(r.objectiveAfterRemoval)}
              </div>
              {r.statLines.map((s, i) => (
                <div className="stat" key={i}>
                  {s}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ marginTop: 16 }}>
        Added / re-spend steps{" "}
        <span className="note">
          {steps.length === 0 ? "none" : `${steps.length} · ${addedNodeIds.length} picks`}
        </span>
      </h3>
      {steps.length > 0 && (
        <ul className="diff-list">
          {steps.map((s, idx) => (
            <li key={`${s.id}-${idx}`}>
              <strong>{s.name}</strong>{" "}
              <span className="note">
                ({s.type}, {s.pointsSpent} pt
                {s.pathLength != null ? `, path ${s.pathLength}` : ""})
              </span>
              <span className="tag added">
                {fmt(s.objectiveBefore)} &rarr; {fmt(s.objectiveAfter)}
              </span>
              <span className="note"> ({pct(s.objectiveBefore, s.objectiveAfter)}, +{fmt(s.deltaPerPoint)}/pt)</span>
              {s.statLines.map((line, i) => (
                <div className="stat" key={i}>
                  {line}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
