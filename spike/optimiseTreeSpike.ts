// Drives optimiseTree against a real build XML.
//   npm run optimise-tree-spike -- "<build.xml>" [extraPoints] [proximity] [objective] [respecBudget]
//
// extraPoints (default 8): points of headroom above the build's current pointsUsed -- i.e. plan
// this many more allocations. proximity (default 3): max pathLength per step. objective (default
// "TotalDPS"): a metric name, "dps-ehp:W", or "blend:A,B,W" (see src/core/objective.ts).
// respecBudget (default 0): >0 switches to repair mode -- free up to N low-value allocated leaves
// and re-spend them; extraPoints is then ignored (re-spend is capped at what was freed).

import { PobBridge } from "../src/core/bridge";
import { loadBuildFromFile } from "../src/core/loadBuild";
import { parseObjective } from "../src/core/objective";
import { optimiseTree } from "../src/core/optimiseTree";

async function main() {
	const buildXmlPath = process.argv[2];
	if (!buildXmlPath) {
		throw new Error("usage: optimiseTreeSpike.ts <build.xml> [extraPoints] [proximity] [objective] [respecBudget]");
	}
	const extraPoints = process.argv[3] ? Number(process.argv[3]) : 8;
	const proximity = process.argv[4] ? Number(process.argv[4]) : 3;
	const objectiveSpec = process.argv[5];
	const respecBudget = process.argv[6] ? Number(process.argv[6]) : 0;
	const repair = respecBudget > 0;

	const bridge = new PobBridge();
	try {
		await loadBuildFromFile(bridge, buildXmlPath);
		await bridge.call("reset_metrics");
		const status = await bridge.call<{ pointsUsed: number; pointsMax: number }>("get_tree_status");
		const pointBudget = status.pointsUsed + extraPoints;
		if (repair) {
			console.log(
				`pointsUsed=${status.pointsUsed} pointsMax=${status.pointsMax} -> REPAIR mode, respecBudget ${respecBudget}, ` +
					`proximity ${proximity}${objectiveSpec ? `, objective "${objectiveSpec}"` : ""}\n`,
			);
		} else {
			console.log(
				`pointsUsed=${status.pointsUsed} pointsMax=${status.pointsMax} -> planning +${extraPoints} (budget ${pointBudget}), ` +
					`proximity ${proximity}${objectiveSpec ? `, objective "${objectiveSpec}"` : ""}\n`,
			);
		}

		const t0 = Date.now();
		const result = await optimiseTree(bridge, {
			pointBudget: repair ? undefined : pointBudget,
			respecBudget: repair ? respecBudget : undefined,
			proximity,
			objectiveFn: objectiveSpec ? parseObjective(objectiveSpec) : undefined,
		});
		const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

		if (result.removed.length > 0) {
			console.log(`removed ${result.removed.length} leaf/leaves (freed ${result.pointsFreed}pt):`);
			for (const r of result.removed) {
				console.log(
					`  - ${r.name} (${r.type})  value lost ${r.valueLost.toFixed(2)}  ` +
						`[obj ${result.baseline.objective.toFixed(2)} -> ${r.objectiveAfterRemoval.toFixed(2)} without it]`,
				);
			}
			console.log();
		}

		console.log(`${result.steps.length} re-spend step(s), stopped: ${result.stoppedBecause}`);
		for (const [i, s] of result.steps.entries()) {
			console.log(
				`  ${i + 1}. ${s.name} (${s.type}, ${s.pointsSpent}pt, path ${s.pathLength}) ` +
					`obj ${s.objectiveBefore.toFixed(2)} -> ${s.objectiveAfter.toFixed(2)}  (+${s.deltaPerPoint.toFixed(2)}/pt)`,
			);
			for (const line of s.statLines) console.log(`       - ${line}`);
		}
		console.log(
			`\nbaseline objective ${result.baseline.objective.toFixed(2)} -> final ${result.final.objective.toFixed(2)} ` +
				`(net ${result.final.pointsSpent} pts` +
				(repair ? `, freed ${result.pointsFreed} / re-spent ${result.pointsRespent}` : "") +
				`)`,
		);
		console.log(
			`BuildOutput recomputes: ${result.buildOutputCount ?? "n/a"}   cache hit rate: ${(result.cacheHitRate * 100).toFixed(0)}%   wall ${elapsed}s`,
		);
	} finally {
		bridge.dispose();
	}
}

main().catch((err) => {
	console.error("optimise-tree spike failed:", err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
