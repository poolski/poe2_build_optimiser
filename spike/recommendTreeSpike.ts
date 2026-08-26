// Validates recommendTree.ts end-to-end against a real build XML.
// Usage: npm run recommend-tree-spike -- "D:\My Documents\Path of Building (PoE2)\Builds\Blood Mage.xml" [maxCandidates] [damageType]
//
// maxCandidates defaults to 20 here (not in recommendTree.ts itself) -- even after the
// Notable/Keystone-only default filter, a real tree can have several hundred reachable
// candidates of those types alone, each costing a real recompute. Pass 0 to evaluate every
// reachable Notable/Keystone once the plumbing itself is trusted. damageType (e.g. "Lightning")
// is optional -- see recommendTree.ts's damageType option.

import { PobBridge } from "../src/core/bridge";
import { loadBuildFromFile } from "../src/core/loadBuild";
import { recommendTree } from "../src/core/recommendTree";

const DEV_MAX_CANDIDATES = 20;

async function main() {
	const buildXmlPath = process.argv[2];
	if (!buildXmlPath) {
		throw new Error("usage: recommendTreeSpike.ts <path-to-build.xml> [maxCandidates] [damageType]");
	}
	const maxCandidatesArg = process.argv[3] ? Number(process.argv[3]) : DEV_MAX_CANDIDATES;
	const maxCandidates = maxCandidatesArg > 0 ? maxCandidatesArg : undefined;
	const damageType = process.argv[4];

	const bridge = new PobBridge();
	try {
		await loadBuildFromFile(bridge, buildXmlPath);
		console.log(`Evaluating ${maxCandidates ?? "all"} candidate node(s)${damageType ? ` (prioritizing ${damageType})` : ""}...`);
		const recommendations = await recommendTree(bridge, { top: 10, maxCandidates, damageType });

		console.log(`\n${recommendations.length} recommendations (ranked by TotalDPS per point):`);
		for (const rec of recommendations) {
			const ascTag = rec.ascendancyName ? ` [${rec.ascendancyName}]` : "";
			const damageTag = rec.damageTypeMatch ? ` [${damageType}]` : "";
			console.log(
				`  ${rec.deltaPerPoint >= 0 ? "+" : ""}${rec.deltaPerPoint.toFixed(2)}/pt  ` +
					`${rec.name}${ascTag}${damageTag} (${rec.type}, ${rec.pointsSpent + rec.ascendancyPointsSpent}pt)`,
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
