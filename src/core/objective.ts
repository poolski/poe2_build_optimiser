// A scoring function over a PoB stat set. The greedy recommender ranks on a single mainOutput
// key; the beam search and the approach benchmark need to optimise a *blend* (typically DPS vs
// EHP), so both consume an `Objective` instead of a bare metric name.
//
// An Objective returns `undefined` when it cannot score the given stats -- an input metric is
// absent, non-finite, or (for a log blend) non-positive. Callers treat that as "this build/branch
// is out of the comparison", never as a zero score.

import { StatSet, finiteNumber, positiveFinite } from "./stats";

export type Objective = (stats: StatSet) => number | undefined;

/** Score = the metric's raw value. `undefined` if the metric is absent or non-finite. */
export function metricObjective(metric: string): Objective {
	return (stats) => finiteNumber(stats[metric]) ?? undefined;
}

/** Score = `w·ln(a) + (1−w)·ln(b)`. Log space because PoB "more" multipliers stack
 * multiplicatively -- in logs their contributions are roughly additive, so a blended optimum is
 * better behaved. `undefined` if either metric is absent, non-finite, or ≤ 0 (outside ln's
 * domain) -- e.g. `TotalEHP` sits behind a conditional CalcDefence.lua block and is not always
 * present (see docs/gotchas.md), and that must not read as `ln(0)`. */
export function logBlend(metricA: string, metricB: string, w: number): Objective {
	if (!Number.isFinite(w) || w < 0 || w > 1) {
		throw new Error(`logBlend weight must be in [0, 1], got ${w}`);
	}
	return (stats) => {
		const a = positiveFinite(stats[metricA]);
		const b = positiveFinite(stats[metricB]);
		if (a === null || b === null) return undefined;
		return w * Math.log(a) + (1 - w) * Math.log(b);
	};
}

/** Parse a CLI/config objective spec:
 *   - `"dps-ehp:0.7"`      → logBlend("TotalDPS", "TotalEHP", 0.7)   (shorthand)
 *   - `"blend:A,B,0.5"`    → logBlend("A", "B", 0.5)                 (any two metrics)
 *   - `"TotalDPS"`         → metricObjective("TotalDPS")             (bare metric name)
 * The weight is the weight on the *first* metric. */
export function parseObjective(spec: string): Objective {
	const trimmed = spec.trim();

	const dpsEhp = /^dps-ehp:(.+)$/i.exec(trimmed);
	if (dpsEhp) {
		return logBlend("TotalDPS", "TotalEHP", parseWeight(dpsEhp[1]));
	}

	const blend = /^blend:(.+)$/i.exec(trimmed);
	if (blend) {
		const parts = blend[1].split(",").map((p) => p.trim());
		if (parts.length !== 3 || !parts[0] || !parts[1]) {
			throw new Error(`objective "blend:..." expects "blend:MetricA,MetricB,weight", got "${spec}"`);
		}
		return logBlend(parts[0], parts[1], parseWeight(parts[2]));
	}

	if (!/^[A-Za-z][\w]*$/.test(trimmed)) {
		throw new Error(`unrecognised objective spec "${spec}" (expected a metric name, "dps-ehp:W", or "blend:A,B,W")`);
	}
	return metricObjective(trimmed);
}

function parseWeight(raw: string): number {
	const w = Number(raw.trim());
	if (!Number.isFinite(w) || w < 0 || w > 1) {
		throw new Error(`objective weight must be a number in [0, 1], got "${raw}"`);
	}
	return w;
}
