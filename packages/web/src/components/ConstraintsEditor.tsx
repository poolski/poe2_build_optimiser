// Repeatable `metric = number` constraint rows + a Preserve list (floor each at baseline) + a
// Min-resist shortcut. Emits { constraints, preserveMetrics, minResist } for the request model
// (intake/web-ui/05-frontend.md screen 2, ConstraintsEditor).

import { useState } from "react";
import { mergeMetricOptions } from "../metrics/knownMetrics";

const METRIC_LIST_ID = "constraint-metric-options";

export interface ConstraintRow {
  metric: string;
  value: string; // kept as text while editing; parsed on emit
}

export interface ConstraintsValue {
  constraints: Record<string, number>;
  preserveMetrics: string[];
  minResist?: number;
}

/** Pure: rows -> a `{ metric: number }` map, dropping blank / non-finite rows. */
export function rowsToConstraints(rows: ConstraintRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = r.metric.trim();
    const n = Number(r.value);
    if (!key || r.value.trim() === "" || !Number.isFinite(n)) continue;
    out[key] = n;
  }
  return out;
}

/** Pure: comma / whitespace separated list -> trimmed unique metric names. */
export function parsePreserve(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,\s]+/)) {
    const t = part.trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

export function toValue(
  rows: ConstraintRow[],
  preserveText: string,
  minResistText: string,
): ConstraintsValue {
  const minResist = minResistText.trim() === "" ? undefined : Number(minResistText);
  return {
    constraints: rowsToConstraints(rows),
    preserveMetrics: parsePreserve(preserveText),
    minResist: minResist !== undefined && Number.isFinite(minResist) ? minResist : undefined,
  };
}

interface Props {
  onChange: (v: ConstraintsValue) => void;
}

export default function ConstraintsEditor({ onChange }: Props) {
  const [rows, setRows] = useState<ConstraintRow[]>([]);
  const [preserveText, setPreserveText] = useState("");
  const [minResistText, setMinResistText] = useState("");
  const metricOptions = mergeMetricOptions();

  const emit = (r: ConstraintRow[], p: string, mr: string) => onChange(toValue(r, p, mr));

  const setRow = (i: number, patch: Partial<ConstraintRow>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    emit(next, preserveText, minResistText);
  };
  const addRow = () => {
    const next = [...rows, { metric: "", value: "" }];
    setRows(next);
    emit(next, preserveText, minResistText);
  };
  const removeRow = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    setRows(next);
    emit(next, preserveText, minResistText);
  };

  return (
    <fieldset>
      <legend>Constraints</legend>

      <datalist id={METRIC_LIST_ID}>
        {metricOptions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {rows.map((r, i) => (
        <div className="row" key={i}>
          <label>
            <span className="lbl">Metric</span>
            <input
              type="text"
              aria-label={`constraint metric ${i + 1}`}
              list={METRIC_LIST_ID}
              value={r.metric}
              onChange={(e) => setRow(i, { metric: e.target.value })}
            />
          </label>
          <label>
            <span className="lbl">&ge; value</span>
            <input
              type="number"
              aria-label={`constraint value ${i + 1}`}
              value={r.value}
              onChange={(e) => setRow(i, { value: e.target.value })}
            />
          </label>
          <button type="button" onClick={() => removeRow(i)} aria-label={`remove constraint ${i + 1}`}>
            &times;
          </button>
        </div>
      ))}

      <button type="button" onClick={addRow}>
        + Add constraint
      </button>

      <label style={{ marginTop: 12 }}>
        <span className="lbl">Preserve (floor each metric at its baseline) &mdash; comma separated</span>
        <input
          type="text"
          value={preserveText}
          placeholder="TotalEHP, Life"
          onChange={(e) => {
            setPreserveText(e.target.value);
            emit(rows, e.target.value, minResistText);
          }}
        />
      </label>

      <label>
        <span className="lbl">Min resist (expands to Fire/Cold/Lightning constraints server-side)</span>
        <input
          type="number"
          value={minResistText}
          placeholder="75"
          onChange={(e) => {
            setMinResistText(e.target.value);
            emit(rows, preserveText, e.target.value);
          }}
        />
      </label>
    </fieldset>
  );
}
