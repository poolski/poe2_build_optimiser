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
}

function parseArgs(argv: string[]): CliArgs {
	const positional: string[] = [];
	let targetMetric: string | undefined;
	let top: number | undefined;
	let maxCandidates: number | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--target") {
			targetMetric = argv[++i];
		} else if (arg === "--top") {
			top = Number(argv[++i]);
		} else if (arg === "--max-candidates") {
			maxCandidates = Number(argv[++i]);
		} else {
			positional.push(arg);
		}
	}

	if (positional.length !== 1) {
		throw new Error("usage: recommend-tree <path-to-build.xml> [--target <stat>] [--top <n>] [--max-candidates <n>]");
	}
	return { buildXmlPath: positional[0], targetMetric, top, maxCandidates };
}

async function main(): Promise<void> {
	const { buildXmlPath, targetMetric, top, maxCandidates } = parseArgs(process.argv.slice(2));

	const bridge = new PobBridge();
	try {
		await loadBuildFromFile(bridge, buildXmlPath);
		const recommendations = await recommendTree(bridge, { targetMetric, top, maxCandidates });

		console.log(`Top ${recommendations.length} passive node recommendations (ranked by ${targetMetric ?? "TotalDPS"} per point):\n`);
		for (const rec of recommendations) {
			const ascTag = rec.ascendancyName ? ` [${rec.ascendancyName}]` : "";
			console.log(`${rec.name}${ascTag} (${rec.type}) -- ${rec.pointsSpent + rec.ascendancyPointsSpent} pt(s)`);
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
