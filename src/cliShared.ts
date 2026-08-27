// Argument-parsing helpers shared by the two CLI entry points (src/cli.ts recommend-tree,
// src/optimiseCli.ts optimise-tree). Output formatting stays in each entry point; core modules
// return plain data.

/** The three elemental resistances `--min-resist` expands to. Chaos res is deliberately excluded
 * (set it explicitly with `--constraint ChaosResist=<n>` if a build wants it capped). */
export const ELEMENTAL_RESIST_METRICS = ["FireResist", "ColdResist", "LightningResist"];

/** Parse a `<Metric>=<number>` constraint flag value. */
export function parseConstraint(spec: string): [string, number] {
	const eq = spec.indexOf("=");
	if (eq <= 0) {
		throw new Error(`--constraint expects <Metric>=<number>, got "${spec}"`);
	}
	const metric = spec.slice(0, eq).trim();
	const value = Number(spec.slice(eq + 1));
	if (!Number.isFinite(value)) {
		throw new Error(`--constraint "${spec}" has a non-numeric floor`);
	}
	return [metric, value];
}

/** Read the next argv entry as a flag's value, or throw if it's missing. */
export function expectValue(argv: string[], i: number, flag: string): string {
	const v = argv[i];
	if (v === undefined) throw new Error(`${flag} expects a value`);
	return v;
}

/** Parse an integer flag value, or throw. */
export function parseIntFlag(raw: string, flag: string): number {
	const n = Number(raw);
	if (!Number.isInteger(n)) throw new Error(`${flag} expects an integer, got "${raw}"`);
	return n;
}

/** Split a comma-separated list flag ("a, b ,c") into trimmed non-empty entries. */
export function parseList(raw: string): string[] {
	return raw
		.split(",")
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}
