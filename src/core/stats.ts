// Shared numeric helpers for reading PoB `mainOutput` stat sets. Kept in their own module so
// recommendTree.ts and objective.ts can both use them without an import cycle.

/** A flattened PoB `build.calcsTab.mainOutput` -- scalar-valued keys, as sanitized by the bridge. */
export type StatSet = Record<string, unknown>;

/** The value as a finite number, or null if it isn't one (absent key, string, NaN, ±Infinity).
 * null means "can't judge this metric" -- callers skip it rather than substituting 0. */
export function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Like finiteNumber but also rejects <= 0 -- for metrics about to go through Math.log. */
export function positiveFinite(value: unknown): number | null {
	const n = finiteNumber(value);
	return n !== null && n > 0 ? n : null;
}

/** The value as a finite number, or 0. Use only where a missing metric genuinely means "no
 * contribution" (e.g. a raw target-metric delta); prefer finiteNumber elsewhere. */
export function asNumber(value: unknown): number {
	return finiteNumber(value) ?? 0;
}
