#!/usr/bin/env node
// CLI: recommend the best next passive-tree node(s) to allocate for a given build.
// All argument parsing and console output lives here -- core/recommendTree.ts returns
// plain data so a future web frontend can call the same function directly.

import { PobBridge } from "./core/bridge";
import { loadBuildFromFile } from "./core/loadBuild";
import { recommendTree } from "./core/recommendTree";

// The three elemental resistances --min-resist expands to. Chaos res is deliberately not
// included (set it explicitly with --constraint ChaosResist=<n> if a build wants it capped).
const ELEMENTAL_RESIST_METRICS = ["FireResist", "ColdResist", "LightningResist"];

interface CliArgs {
	buildXmlPath: string;
	targetMetric?: string;
	top?: number;
	maxCandidates?: number;
	nodeTypes?: string[];
	includeAllNodeTypes?: boolean;
	damageType?: string;
	objective?: string;
	constraints?: Record<string, number>;
	preserveMetrics?: string[];
	keepViolating?: boolean;
}

function parseConstraint(spec: string): [string, number] {
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

function parseArgs(argv: string[]): CliArgs {
	const positional: string[] = [];
	let targetMetric: string | undefined;
	let top: number | undefined;
	let maxCandidates: number | undefined;
	let nodeTypes: string[] | undefined;
	let includeAllNodeTypes = false;
	let damageType: string | undefined;
	let objective: string | undefined;
	const constraints: Record<string, number> = {};
	let preserveMetrics: string[] | undefined;
	let keepViolating = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--target") {
			targetMetric = argv[++i];
		} else if (arg === "--top") {
			top = Number(argv[++i]);
		} else if (arg === "--max-candidates") {
			maxCandidates = Number(argv[++i]);
		} else if (arg === "--node-types") {
			nodeTypes = argv[++i].split(",").map((t) => t.trim());
		} else if (arg === "--all-node-types") {
			includeAllNodeTypes = true;
		} else if (arg === "--damage-type") {
			damageType = argv[++i];
		} else if (arg === "--objective") {
			objective = argv[++i];
		} else if (arg === "--min-resist") {
			const floor = Number(argv[++i]);
			if (!Number.isFinite(floor)) throw new Error("--min-resist expects a number");
			for (const metric of ELEMENTAL_RESIST_METRICS) constraints[metric] = floor;
		} else if (arg === "--constraint") {
			const [metric, value] = parseConstraint(argv[++i]);
			constraints[metric] = value;
		} else if (arg === "--preserve") {
			preserveMetrics = argv[++i].split(",").map((t) => t.trim());
		} else if (arg === "--keep-violating") {
			keepViolating = true;
		} else {
			positional.push(arg);
		}
	}

	if (positional.length !== 1) {
		throw new Error(
			"usage: recommend-tree <path-to-build.xml> [--target <stat>] [--top <n>] [--max-candidates <n>] " +
				"[--node-types <Type,Type,...>] [--all-node-types] [--damage-type <type>] [--objective <preset>] " +
				"[--min-resist <n>] [--constraint <Metric>=<n> ...] [--preserve <Metric,Metric,...>] [--keep-violating]",
		);
	}
	return {
		buildXmlPath: positional[0],
		targetMetric,
		top,
		maxCandidates,
		nodeTypes,
		includeAllNodeTypes,
		damageType,
		objective,
		constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
		preserveMetrics,
		keepViolating,
	};
}

async function main(): Promise<void> {
	const { buildXmlPath, targetMetric, top, maxCandidates, nodeTypes, includeAllNodeTypes, damageType, objective, constraints, preserveMetrics, keepViolating } =
		parseArgs(process.argv.slice(2));

	const bridge = new PobBridge();
	try {
		await loadBuildFromFile(bridge, buildXmlPath);
		const recommendations = await recommendTree(bridge, {
			targetMetric,
			top,
			maxCandidates,
			nodeTypes,
			includeAllNodeTypes,
			damageType,
			objective,
			constraints,
			preserveMetrics,
			keepViolating,
		});

		if (constraints || preserveMetrics?.length) {
			const parts = [
				...Object.entries(constraints ?? {}).map(([m, f]) => `${m} >= ${f}`),
				...(preserveMetrics ?? []).map((m) => `${m} >= baseline`),
			];
			console.log(`Constraints: ${parts.join(", ")}${keepViolating ? " (violating nodes shown, not dropped)" : ""}\n`);
		}

		console.log(`Top ${recommendations.length} passive node recommendations (ranked by ${targetMetric ?? "TotalDPS"} per point):\n`);
		for (const rec of recommendations) {
			const ascTag = rec.ascendancyName ? ` [${rec.ascendancyName}]` : "";
			const damageTag = rec.damageTypeMatch ? ` [${damageType}]` : "";
			console.log(`${rec.name}${ascTag}${damageTag} (${rec.type}) -- ${rec.pointsSpent + rec.ascendancyPointsSpent} pt(s)`);
			console.log(`  delta: ${rec.delta.toFixed(2)}  (${rec.deltaPerPoint.toFixed(2)}/pt)`);
			if (rec.constraintViolation) {
				const v = rec.constraintViolation;
				console.log(`  ! violates ${v.metric}: ${v.baseline.toFixed(2)} -> ${v.candidate.toFixed(2)} (floor ${v.floor})`);
			}
			for (const line of rec.statLines) {
				console.log(`  - ${line}`);
			}
			console.log("");
		}
	} finally {
		bridge.dispose();
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
