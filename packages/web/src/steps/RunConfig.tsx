// Step 2: the run-config form. Model is OptimiseRequestInput so validation mirrors the server
// (docs/web-ui/05-frontend.md screen 2). Emits patches up to the reducer.

import { useState } from "react";
import { OBJECTIVE_SPEC_RE, type BuildSummary, type OptimiseRequestInput } from "@poe2/contract";
import ObjectiveBuilder from "../components/ObjectiveBuilder";
import ConstraintsEditor, { type ConstraintsValue } from "../components/ConstraintsEditor";

interface Props {
  build: BuildSummary;
  request: OptimiseRequestInput;
  onChange: (patch: Partial<OptimiseRequestInput>) => void;
  onRun: () => void;
  onBack: () => void;
  busy?: boolean;
}

const MODES: OptimiseRequestInput["mode"][] = ["extend", "repair", "rollback"];

function numOrUndef(s: string): number | undefined {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function csvToIds(s: string): number[] {
  return s
    .split(/[,\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

export default function RunConfig({ build, request, onChange, onRun, onBack, busy }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [budgetKind, setBudgetKind] = useState<"extra" | "absolute">("extra");

  const mode = request.mode;
  const objOk = OBJECTIVE_SPEC_RE.test(request.objective ?? "TotalDPS");
  const rollbackOk = mode !== "rollback" || request.anchorNodeId !== undefined;
  const canRun = !busy && objOk && rollbackOk;

  const applyConstraints = (v: ConstraintsValue) =>
    onChange({
      constraints: v.constraints,
      preserveMetrics: v.preserveMetrics,
      minResist: v.minResist,
    });

  return (
    <div className="panel">
      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>Build</dt>
        <dd>
          {build.className}
          {build.ascendancy ? ` · ${build.ascendancy}` : ""} · L{build.level} ·{" "}
          {build.pointsUsed}/{build.pointsMax} pts
        </dd>
      </dl>
      {build.notes.length > 0 && (
        <div className="warn">
          {build.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      <fieldset>
        <legend>Mode</legend>
        <div className="segmented">
          {MODES.map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => onChange({ mode: m })}>
              {m}
            </button>
          ))}
        </div>

        {mode === "extend" && (
          <div style={{ marginTop: 12 }}>
            <div className="segmented" style={{ marginBottom: 8 }}>
              <button
                className={budgetKind === "extra" ? "on" : ""}
                onClick={() => {
                  setBudgetKind("extra");
                  onChange({ pointBudget: undefined });
                }}
              >
                Extra points
              </button>
              <button
                className={budgetKind === "absolute" ? "on" : ""}
                onClick={() => {
                  setBudgetKind("absolute");
                  onChange({ extraPoints: undefined });
                }}
              >
                Point budget
              </button>
            </div>
            {budgetKind === "extra" ? (
              <label>
                <span className="lbl">Extra points to spend</span>
                <input
                  type="number"
                  min={0}
                  value={request.extraPoints ?? ""}
                  onChange={(e) => onChange({ extraPoints: numOrUndef(e.target.value), pointBudget: undefined })}
                />
              </label>
            ) : (
              <label>
                <span className="lbl">Absolute point budget</span>
                <input
                  type="number"
                  min={0}
                  value={request.pointBudget ?? ""}
                  onChange={(e) => onChange({ pointBudget: numOrUndef(e.target.value), extraPoints: undefined })}
                />
              </label>
            )}
          </div>
        )}

        {mode === "repair" && (
          <label style={{ marginTop: 12 }}>
            <span className="lbl">Respec budget (points ceiling)</span>
            <input
              type="number"
              min={0}
              value={request.respecBudget ?? ""}
              onChange={(e) => onChange({ respecBudget: numOrUndef(e.target.value) })}
            />
          </label>
        )}

        {mode === "rollback" && (
          <div style={{ marginTop: 12 }}>
            <label>
              <span className="lbl">Anchor node id (required)</span>
              <input
                type="number"
                value={request.anchorNodeId ?? ""}
                onChange={(e) => onChange({ anchorNodeId: numOrUndef(e.target.value) })}
              />
            </label>
            <label>
              <span className="lbl">Respec budget for extra survivors (optional)</span>
              <input
                type="number"
                min={0}
                value={request.respecBudget ?? ""}
                onChange={(e) => onChange({ respecBudget: numOrUndef(e.target.value) })}
              />
            </label>
            <p className="note">
              The node to roll back to; its whole downstream subtree is freed.
            </p>
          </div>
        )}
      </fieldset>

      <ObjectiveBuilder
        value={request.objective ?? "TotalDPS"}
        onChange={(spec) => onChange({ objective: spec })}
      />
      {!objOk && <p className="err">Objective spec is not in a form the server accepts.</p>}

      <ConstraintsEditor onChange={applyConstraints} />

      <fieldset>
        <legend>
          <button
            className="ghost"
            style={{ padding: 0, border: 0 }}
            onClick={() => setAdvanced((a) => !a)}
          >
            {advanced ? "▾" : "▸"} Advanced
          </button>
        </legend>
        {advanced && (
          <>
            <div className="row">
              <label>
                <span className="lbl">Proximity K</span>
                <input
                  type="number"
                  min={1}
                  value={request.proximity ?? ""}
                  onChange={(e) => onChange({ proximity: numOrUndef(e.target.value) })}
                />
              </label>
              <label>
                <span className="lbl">Beam width</span>
                <input
                  type="number"
                  min={1}
                  value={request.beamWidth ?? ""}
                  onChange={(e) => onChange({ beamWidth: numOrUndef(e.target.value) })}
                />
              </label>
              <label>
                <span className="lbl">Beam depth</span>
                <input
                  type="number"
                  min={1}
                  value={request.beamDepth ?? ""}
                  onChange={(e) => onChange({ beamDepth: numOrUndef(e.target.value) })}
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={request.includeAllNodeTypes ?? false}
                onChange={(e) => onChange({ includeAllNodeTypes: e.target.checked })}
              />{" "}
              Include all node types
            </label>
            <label>
              <span className="lbl">Node types (comma separated)</span>
              <input
                type="text"
                value={(request.nodeTypes ?? []).join(", ")}
                placeholder="Notable, Keystone"
                onChange={(e) =>
                  onChange({
                    nodeTypes: e.target.value
                      .split(/,\s*/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <div className="row">
              <label>
                <span className="lbl">Keywords</span>
                <input
                  type="text"
                  value={(request.keywords ?? []).join(", ")}
                  onChange={(e) =>
                    onChange({
                      keywords: e.target.value.split(/,\s*/).map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                <span className="lbl">Exclude keywords</span>
                <input
                  type="text"
                  value={(request.excludeKeywords ?? []).join(", ")}
                  onChange={(e) =>
                    onChange({
                      excludeKeywords: e.target.value
                        .split(/,\s*/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
            <label>
              <span className="lbl">Freeze node ids (comma separated) &mdash; never freed by repair</span>
              <input
                type="text"
                value={(request.freeze ?? []).join(", ")}
                onChange={(e) => onChange({ freeze: csvToIds(e.target.value) })}
              />
            </label>
          </>
        )}
      </fieldset>

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button className="ghost" onClick={onBack}>
          Back
        </button>
        <button className="primary" disabled={!canRun} onClick={onRun}>
          {busy ? "Starting…" : "Run"}
        </button>
      </div>
    </div>
  );
}
