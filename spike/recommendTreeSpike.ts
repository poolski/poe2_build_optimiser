// Validates recommendTree.ts end-to-end against a real build XML.
// Usage: npm run recommend-tree-spike -- "D:\My Documents\Path of Building (PoE2)\Builds\Blood Mage.xml" [maxCandidates]
//
// maxCandidates defaults to 20 here (not in recommendTree.ts itself) -- a real tree can have
// 3000+ reachable candidates, each costing a real recompute; while developing, cap the pool so
// a run takes seconds instead of many minutes. Pass 0 (or edit the call below) to evaluate the
// full reachable set once the plumbing itself is trusted.

import { PobBridge } from "../src/core/bridge";
import { loadBuildFromFile } from "../src/core/loadBuild";
import { recommendTree } from "../src/core/recommendTree";

const DEV_MAX_CANDIDATES = 20;

async function main() {
	const buildXmlPath = process.argv[2];
	if (!buildXmlPath) {
		throw new Error("usage: recommendTreeSpike.ts <path-to-build.xml> [maxCandidates]");
	}
	const maxCandidatesArg = process.argv[3] ? Number(process.argv[3]) : DEV_MAX_CANDIDATES;
	const maxCandidates = maxCandidatesArg > 0 ? maxCandidatesArg : undefined;

	const bridge = new PobBridge();
	try {
		await loadBuildFromFile(bridge, buildXmlPath);
		console.log(`Evaluating ${maxCandidates ?? "all"} candidate node(s)...`);
		const recommendations = await recommendTree(bridge, { top: 10, maxCandidates });

		console.log(`\n${recommendations.length} recommendations (ranked by TotalDPS per point):`);
		for (const rec of recommendations) {
			const ascTag = rec.ascendancyName ? ` [${rec.ascendancyName}]` : "";
			console.log(
				`  ${rec.deltaPerPoint >= 0 ? "+" : ""}${rec.deltaPerPoint.toFixed(2)}/pt  ` +
					`${rec.name}${ascTag} (${rec.type}, ${rec.pointsSpent + rec.ascendancyPointsSpent}pt)`,
			);
		}
	} finally {
		bridge.dispose();
	}
}

main().catch((err) => {
	console.error("recommend-tree spike failed:", err);
	process.exitCode = 1;
});
