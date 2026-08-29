// Emits the objective spec string the contract's OBJECTIVE_SPEC_RE accepts:
//   single metric -> "TotalDPS"
//   DPS/EHP blend -> "dps-ehp:0.5"
//   custom blend  -> "blend:TotalDPS,TotalEHP,0.5"
// (docs/web-ui/05-frontend.md screen 2, ObjectiveBuilder.)

import { useState } from "react";

export type ObjectiveKind = "single" | "dps-ehp" | "blend";

export interface ObjectiveModel {
  kind: ObjectiveKind;
  metric: string; // single
  weight: number; // dps-ehp + blend
  blendA: string;
  blendB: string;
}

export const defaultObjectiveModel: ObjectiveModel = {
  kind: "single",
  metric: "TotalDPS",
  weight: 0.5,
  blendA: "TotalDPS",
  blendB: "TotalEHP",
};

const clamp01 = (w: number) => (Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.5);

/** Pure: model -> spec string. */
export function buildObjectiveSpec(m: ObjectiveModel): string {
  switch (m.kind) {
    case "dps-ehp":
      return `dps-ehp:${clamp01(m.weight)}`;
    case "blend":
      return `blend:${m.blendA || "TotalDPS"},${m.blendB || "TotalEHP"},${clamp01(m.weight)}`;
    default:
      return m.metric || "TotalDPS";
  }
}

/** Best-effort inverse for seeding the form from an existing spec. */
export function parseObjectiveModel(spec: string): ObjectiveModel {
  const m = { ...defaultObjectiveModel };
  const dpsEhp = /^dps-ehp:(\d+(?:\.\d+)?)$/.exec(spec);
  if (dpsEhp) return { ...m, kind: "dps-ehp", weight: Number(dpsEhp[1]) };
  const blend = /^blend:([A-Za-z][A-Za-z0-9]*),([A-Za-z][A-Za-z0-9]*),(\d+(?:\.\d+)?)$/.exec(spec);
  if (blend) return { ...m, kind: "blend", blendA: blend[1], blendB: blend[2], weight: Number(blend[3]) };
  return { ...m, kind: "single", metric: spec || "TotalDPS" };
}

interface Props {
  value: string;
  onChange: (spec: string) => void;
}

export default function ObjectiveBuilder({ value, onChange }: Props) {
  const [model, setModel] = useState<ObjectiveModel>(() => parseObjectiveModel(value));

  const update = (patch: Partial<ObjectiveModel>) => {
    const next = { ...model, ...patch };
    setModel(next);
    onChange(buildObjectiveSpec(next));
  };

  return (
    <fieldset>
      <legend>Objective</legend>
      <div role="radiogroup" aria-label="objective kind" style={{ marginBottom: 10 }}>
        <label style={{ display: "inline-block", marginRight: 14 }}>
          <input
            type="radio"
            name="obj-kind"
            checked={model.kind === "single"}
            onChange={() => update({ kind: "single" })}
          />{" "}
          Single metric
        </label>
        <label style={{ display: "inline-block", marginRight: 14 }}>
          <input
            type="radio"
            name="obj-kind"
            checked={model.kind === "dps-ehp"}
            onChange={() => update({ kind: "dps-ehp" })}
          />{" "}
          DPS/EHP blend
        </label>
        <label style={{ display: "inline-block" }}>
          <input
            type="radio"
            name="obj-kind"
            checked={model.kind === "blend"}
            onChange={() => update({ kind: "blend" })}
          />{" "}
          Custom blend
        </label>
      </div>

      {model.kind === "single" && (
        <label>
          <span className="lbl">Metric</span>
          <input
            type="text"
            list="metric-suggestions"
            value={model.metric}
            onChange={(e) => update({ metric: e.target.value })}
          />
        </label>
      )}

      {model.kind === "dps-ehp" && (
        <label>
          <span className="lbl">Weight W (0 = all EHP, 1 = all DPS): {model.weight}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={model.weight}
            onChange={(e) => update({ weight: Number(e.target.value) })}
          />
        </label>
      )}

      {model.kind === "blend" && (
        <>
          <div className="row">
            <label>
              <span className="lbl">Metric A</span>
              <input
                type="text"
                value={model.blendA}
                onChange={(e) => update({ blendA: e.target.value })}
              />
            </label>
            <label>
              <span className="lbl">Metric B</span>
              <input
                type="text"
                value={model.blendB}
                onChange={(e) => update({ blendB: e.target.value })}
              />
            </label>
          </div>
          <label>
            <span className="lbl">Weight (favours A): {model.weight}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={model.weight}
              onChange={(e) => update({ weight: Number(e.target.value) })}
            />
          </label>
        </>
      )}

      <datalist id="metric-suggestions">
        <option value="TotalDPS" />
        <option value="TotalEHP" />
        <option value="Life" />
        <option value="EnergyShield" />
        <option value="CombinedDPS" />
        <option value="FullDPS" />
      </datalist>
      <p className="note">
        spec: <span className="mono">{value}</span>
      </p>
    </fieldset>
  );
}
