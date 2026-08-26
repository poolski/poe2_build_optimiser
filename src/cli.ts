#!/usr/bin/env node
// CLI: recommend the best next passive-tree node(s) to allocate for a given build.
// All argument parsing and console output lives here -- core/recommendTree.ts returns
// plain data so a future web frontend can call the same function directly.

import { PobBridge } from "./core/bridge";
import { loadBuildFromFile } from "./core/loadBuild";
import { recommendTree } from "./core/recommendTree";

interface CliArgs {
	buildXmlPath: string;
	targetMetric?: string;
	top?: number;
	maxCandidates?: number;
	nodeTypes?: string[];
	includeAllNodeTypes?: boolean;
	damageType?: string;
}

function parseArgs(argv: string[]): CliArgs {
	const positional: string[] = [];
	let targetMetric: string | undefined;
	let top: number | undefined;
	let maxCandidates: number | undefined;
	let nodeTypes: string[] | undefined;
	let includeAllNodeTypes = false;
	let damageType: string | undefined;

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
		} else {
			positional.push(arg);
		}
	}

	if (positional.length !== 1) {
		throw new Error(
			"usage: recommend-tree <path-to-build.xml> [--target <stat>] [--top <n>] [--max-candidates <n>] " +
				"[--node-types <Type,Type,...>] [--all-node-types] [--damage-type <type>]",
		);
	}
	return { buildXmlPath: positional[0], targetMetric, top, maxCandidates, nodeTypes, includeAllNodeTypes, damageType };
}

async function main(): Promise<void> {
	const { buildXmlPath, targetMetric, top, maxCandidates, nodeTypes, includeAllNodeTypes, damageType } = parseArgs(
		process.argv.slice(2),
	);

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
		});

		console.log(`Top ${recommendations.length} passive node recommendations (ranked by ${targetMetric ?? "TotalDPS"} per point):\n`);
		for (const rec of recommendations) {
			const ascTag = rec.ascendancyName ? ` [${rec.ascendancyName}]` : "";
			const damageTag = rec.damageTypeMatch ? ` [${damageType}]` : "";
			console.log(`${rec.name}${ascTag}${damageTag} (${rec.type}) -- ${rec.pointsSpent + rec.ascendancyPointsSpent} pt(s)`);
			console.log(`  delta: ${rec.delta.toFixed(2)}  (${rec.deltaPerPoint.toFixed(2)}/pt)`);
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
