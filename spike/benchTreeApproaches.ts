// Approach benchmark for the tree planner (design step 9). For each (build × approach × setting)
// it records final objective, cost (BuildOutput recomputes -- the machine-independent currency),
// wall-clock, and feasibility, then prints a markdown table + a summary.
//
//   npm run bench-tree-approaches -- [objective] [extraPoints]
//
// objective default "TotalDPS"; extraPoints default 8 (headroom above each build's pointsUsed).
//
// STATUS: v1. The headline greedy-vs-repair comparison from docs/beam-search-design.md needs
// repair mode (optimiseTree respecBudget > 0), which is not implemented. Until then this sweeps
// extend mode across proximity K -- enough to exercise the harness, the cost counter, and the
// output format, and to see how much K costs vs buys. Add a "repair" row to APPROACHES when it
// lands. The corpus is also short (see docs/beam-corpus.md): 4 local builds, not the 8-15 the
// design calls for.

import * as fs from "node:fs";
import * as path from "node:path";
import { PobBridge } from "../src/core/bridge";
import { parseObjective } from "../src/core/objective";
import { optimiseTree } from "../src/core/optimiseTree";

const BUILDS_DIR = "D:/My Documents/Path of Building (PoE2)/Builds";
const CORPUS = [
	"RampantlyBisexual.xml",
	"Blood Mage.xml",
	"Monk/Flicker Strike Invoker.xml",
	"Monk/Martial Artist - Shattering Palm + Flicker Strike.xml",
];

interface Row {
	build: string;
	approach: string;
	baselineObjective: number;
	finalObjective: number;
	liftPct: number;
	steps: number;
	pointsSpent: number;
	buildOutputCount: number;
	wallSeconds: number;
	stoppedBecause: string;
}

const APPROACHES: Array<{ name: string; proximity: number }> = [
	{ name: "extend-k1", proximity: 1 },
	{ name: "extend-k2", proximity: 2 },
	{ name: "extend-k3", proximity: 3 },
];

async function runOne(buildXmlPath: string, proximity: number, objectiveSpec: string, extraPoints: number) {
	const bridge = new PobBridge();
	try {
		const xml = fs.readFileSync(buildXmlPath, "utf-8");
		await bridge.call("load_build_xml", { xml });
		await bridge.call("reset_metrics");
		const status = await bridge.call<{ pointsUsed: number }>("get_tree_status");

		const t0 = Date.now();
		const result = await optimiseTree(bridge, {
			pointBudget: status.pointsUsed + extraPoints,
			proximity,
			objectiveFn: parseObjective(objectiveSpec),
		});
		return { result, wallSeconds: (Date.now() - t0) / 1000 };
	} finally {
		bridge.dispose();
	}
}

async function main() {
	const objectiveSpec = process.argv[2] ?? "TotalDPS";
	const extraPoints = process.argv[3] ? Number(process.argv[3]) : 8;

	const rows: Row[] = [];
	for (const rel of CORPUS) {
		const buildXmlPath = path.join(BUILDS_DIR, rel);
		if (!fs.existsSync(buildXmlPath)) {
			console.error(`skip (not found): ${buildXmlPath}`);
			continue;
		}
		// A build whose baseline objective is 0 (e.g. TotalDPS=0 headless -- see docs/beam-corpus.md)
		// can't yield a meaningful lift %; note it once and skip its rows rather than emit NaN.
		for (const approach of APPROACHES) {
			process.stderr.write(`running ${rel} / ${approach.name} ...\n`);
			const { result, wallSeconds } = await runOne(buildXmlPath, approach.proximity, objectiveSpec, extraPoints);
			const base = result.baseline.objective;
			const liftPct = base === 0 || !Number.isFinite(base) ? NaN : (100 * (result.final.objective - base)) / Math.abs(base);
			rows.push({
				build: rel.replace(/\.xml$/i, "").replace(/^Monk\//, ""),
				approach: approach.name,
				baselineObjective: result.baseline.objective,
				finalObjective: result.final.objective,
				liftPct,
				steps: result.steps.length,
				pointsSpent: result.final.pointsSpent,
				buildOutputCount: result.buildOutputCount ?? -1,
				wallSeconds,
				stoppedBecause: result.stoppedBecause,
			});
		}
	}

	const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "n/a");
	console.log(`\n### Tree planner approach benchmark  (objective: \`${objectiveSpec}\`, +${extraPoints} pts headroom)\n`);
	console.log(`| build | approach | baseline obj | final obj | lift % | steps | pts | BuildOutputs | wall s | stopped |`);
	console.log(`|---|---|--:|--:|--:|--:|--:|--:|--:|---|`);
	for (const r of rows) {
		console.log(
			`| ${r.build} | ${r.approach} | ${f2(r.baselineObjective)} | ${f2(r.finalObjective)} | ${f2(r.liftPct)} | ${r.steps} | ${r.pointsSpent} | ${r.buildOutputCount} | ${f2(r.wallSeconds)} | ${r.stoppedBecause} |`,
		);
	}

	console.log(`\n**Cost by approach (median BuildOutputs / median wall s):**`);
	for (const approach of APPROACHES) {
		const sub = rows.filter((r) => r.approach === approach.name);
		if (sub.length === 0) continue;
		console.log(`- ${approach.name}: ${median(sub.map((r) => r.buildOutputCount))} / ${f2(median(sub.map((r) => r.wallSeconds)))}`);
	}
}

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

main().catch((err) => {
	console.error("bench-tree-approaches failed:", err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
