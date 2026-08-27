// Approach benchmark for the tree planner (design step 9). For each (build × approach) it records
// the objective lift vs the loaded tree, the cost (BuildOutput recomputes -- the machine-independent
// currency), wall-clock, and whether the plan kept the build feasible, then writes a markdown table
// + summary to docs/beam-bench-<objective>.md (and stdout).
//
//   npm run bench-tree-approaches -- [objective] [extraPoints] [--no-constraints]
//
//   objective       objective spec for parseObjective -- "TotalDPS" (default), "TotalEHP",
//                   "dps-ehp:0.5", "blend:A,B,W", or any bare mainOutput key.
//   extraPoints      headroom above each build's pointsUsed for the extend row (default 8).
//   --no-constraints drop the default "preserve the 3 elemental resists" floor.
//
// Approaches compared:
//   extend      optimiseTree extend mode -- the multi-step greedy walk, +extraPoints fresh points,
//               no respec. This is the "greedy seed" baseline from the design doc.
//   repair-rN   optimiseTree repair mode -- free up to N of the lowest-value allocated leaves and
//               re-spend them, net ~0 points, costs N respec. better-of(loaded, repaired) internally.
//
// extend spends passive points; repair spends respec currency. Both report lift vs the same loaded
// baseline, and the cost columns show the price -- that's the apples-to-apples the design asks for.
//
// STATUS: the corpus is still short of the 8-15 builds the design calls for (see docs/beam-corpus.md)
// and there is no held-out subset yet, so treat the committed docs/beam-bench-*.md as a regression
// fixture for the *harness*, not a final result.

import * as fs from "node:fs";
import * as path from "node:path";
import { PobBridge } from "../src/core/bridge";
import { parseObjective } from "../src/core/objective";
import { optimiseTree, OptimiseTreeResult } from "../src/core/optimiseTree";
import { asNumber, StatSet } from "../src/core/stats";

const BUILDS_DIR = "D:/My Documents/Path of Building (PoE2)/Builds";
const PRESERVE_RESISTS = ["FireResist", "ColdResist", "LightningResist"];

/** docs/beam-bench-<objective>.md -- one committed fixture per objective. */
function outFileFor(objectiveSpec: string): string {
	const slug = objectiveSpec.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
	return path.join(__dirname, "..", "docs", `beam-bench-${slug}.md`);
}

interface CorpusBuild {
	rel: string;
	label: string;
	note?: string;
}

const CORPUS: CorpusBuild[] = [
	{ rel: "Ranger.xml", label: "Ranger-L37", note: "naive (deliberately gutted), L37 so budget = pointsUsed+extra" },
	{ rel: "RampantlyBisexual.xml", label: "RampantlyBisexual", note: "23 spare" },
	{ rel: "Blood Mage.xml", label: "Blood Mage", note: "TotalDPS=0 headless -- skipped under a DPS objective" },
	{ rel: "Monk/Flicker Strike Invoker.xml", label: "Flicker-Invoker", note: "10 spare" },
	{ rel: "Monk/MA-FlickerStrike.xml", label: "MA-FlickerStrike", note: "naive, 25 spare -- validation 'repair improves'" },
	{
		rel: "Monk/Martial Artist - Shattering Palm + Flicker Strike.xml",
		label: "MA-Shattering",
		note: "hand-tuned, 10 spare -- validation 'repair ~= no change'",
	},
];

interface Approach {
	name: string;
	proximity: number;
	respecBudget: number;
	/** Headroom above pointsUsed. extend uses this; repair rows pass 0 (net-neutral respec). */
	extraPoints: number;
}

function approaches(baseExtra: number): Approach[] {
	return [
		{ name: `extend+${baseExtra}`, proximity: 3, respecBudget: 0, extraPoints: baseExtra },
		{ name: "repair-r3", proximity: 3, respecBudget: 3, extraPoints: 0 },
		{ name: "repair-r6", proximity: 3, respecBudget: 6, extraPoints: 0 },
	];
}

interface Row {
	build: string;
	approach: string;
	baselineObjective: number;
	finalObjective: number;
	liftPct: number;
	netPoints: number;
	respecUsed: number;
	resOk: boolean;
	buildOutputs: number;
	cacheHitPct: number;
	wallSeconds: number;
	stopped: string;
}

interface RunOutput {
	result: OptimiseTreeResult;
	baseStats: StatSet;
	wallSeconds: number;
}

async function runOne(
	buildXmlPath: string,
	approach: Approach,
	objectiveSpec: string,
	constraintsOn: boolean,
): Promise<RunOutput> {
	const bridge = new PobBridge();
	try {
		const xml = fs.readFileSync(buildXmlPath, "utf-8");
		await bridge.call("load_build_xml", { xml });
		await bridge.call("reset_metrics");
		const status = await bridge.call<{ pointsUsed: number }>("get_tree_status");
		const baseStats = await bridge.call<StatSet>("get_stats");

		const t0 = Date.now();
		const result = await optimiseTree(bridge, {
			pointBudget: status.pointsUsed + approach.extraPoints,
			proximity: approach.proximity,
			respecBudget: approach.respecBudget,
			objectiveFn: parseObjective(objectiveSpec),
			preserveMetrics: constraintsOn ? PRESERVE_RESISTS : undefined,
		});
		return { result, baseStats, wallSeconds: (Date.now() - t0) / 1000 };
	} finally {
		bridge.dispose();
	}
}

/** Every preserved resist in the final plan is >= its loaded-baseline value (small tolerance for
 * float dust). optimiseTree enforces this internally; a false here is a bug worth surfacing. */
function resistsHeld(baseStats: StatSet, finalStats: StatSet): boolean {
	return PRESERVE_RESISTS.every((m) => asNumber(finalStats[m]) >= asNumber(baseStats[m]) - 0.01);
}

function median(xs: number[]): number {
	if (xs.length === 0) return Number.NaN;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "n/a");

async function main() {
	const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
	const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
	const objectiveSpec = positional[0] ?? "TotalDPS";
	const extraPoints = positional[1] ? Number(positional[1]) : 8;
	const constraintsOn = !flags.has("--no-constraints");

	const APPROACHES = approaches(extraPoints);
	const rows: Row[] = [];
	const skipped: string[] = [];

	for (const cb of CORPUS) {
		const buildXmlPath = path.join(BUILDS_DIR, cb.rel);
		if (!fs.existsSync(buildXmlPath)) {
			skipped.push(`${cb.label} (file not found)`);
			continue;
		}
		let buildSkipReason: string | undefined;
		for (const approach of APPROACHES) {
			if (buildSkipReason) break;
			process.stderr.write(`running ${cb.label} / ${approach.name} ...\n`);
			let out: RunOutput;
			try {
				out = await runOne(buildXmlPath, approach, objectiveSpec, constraintsOn);
			} catch (err) {
				buildSkipReason = `optimiseTree threw (${err instanceof Error ? err.message : err})`;
				break;
			}
			const base = out.result.baseline.objective;
			if (!Number.isFinite(base) || base === 0) {
				buildSkipReason = `baseline objective ${base} not usable for lift %`;
				break;
			}
			const final = out.result.final;
			rows.push({
				build: cb.label,
				approach: approach.name,
				baselineObjective: base,
				finalObjective: final.objective,
				liftPct: (100 * (final.objective - base)) / Math.abs(base),
				netPoints: final.pointsSpent,
				respecUsed: out.result.pointsFreed,
				resOk: resistsHeld(out.baseStats, final.stats),
				buildOutputs: out.result.buildOutputCount ?? -1,
				cacheHitPct: 100 * out.result.cacheHitRate,
				wallSeconds: out.wallSeconds,
				stopped: out.result.stoppedBecause,
			});
		}
		if (buildSkipReason) skipped.push(`${cb.label} (${buildSkipReason})`);
	}

	const lines: string[] = [];
	lines.push(`<!-- generated by \`npm run bench-tree-approaches\` -- do not edit by hand -->`);
	lines.push(`# Tree planner approach benchmark`);
	lines.push(``);
	lines.push(
		`objective \`${objectiveSpec}\`, extend headroom +${extraPoints} pts, ` +
			`constraints: ${constraintsOn ? "preserve Fire/Cold/Lightning resist" : "none"}. ` +
			`Generated ${new Date().toISOString()}.`,
	);
	lines.push(``);
	lines.push(`| build | approach | base | final | lift % | net pts | respec | res ok | BuildOutputs | cache hit % | wall s | stopped |`);
	lines.push(`|---|---|--:|--:|--:|--:|--:|:-:|--:|--:|--:|---|`);
	for (const r of rows) {
		lines.push(
			`| ${r.build} | ${r.approach} | ${f2(r.baselineObjective)} | ${f2(r.finalObjective)} | ${f2(r.liftPct)} | ` +
				`${r.netPoints} | ${r.respecUsed} | ${r.resOk ? "y" : "**N**"} | ${r.buildOutputs} | ${f2(r.cacheHitPct)} | ` +
				`${f2(r.wallSeconds)} | ${r.stopped} |`,
		);
	}
	lines.push(``);

	// Per-build summary. extend and repair are different-budget operations -- extend spends
	// `extraPoints` fresh passive points, repair spends respec currency for a net ~0 point change --
	// so this is not a head-to-head "which wins", it is "what each path buys from the same baseline".
	lines.push(`## Per-build summary (lift %, same loaded baseline)`);
	lines.push(``);
	lines.push(`| build | extend+${extraPoints} (+pts) | repair-r3 (+respec) | repair-r6 (+respec) | repair monotonic? |`);
	lines.push(`|---|--:|--:|--:|:-:|`);
	let nonMonotonic = 0;
	for (const cb of CORPUS) {
		const ext = rows.find((r) => r.build === cb.label && r.approach === `extend+${extraPoints}`);
		const r3 = rows.find((r) => r.build === cb.label && r.approach === "repair-r3");
		const r6 = rows.find((r) => r.build === cb.label && r.approach === "repair-r6");
		if (!ext && !r3 && !r6) continue;
		// A larger respec budget should never do worse than a smaller one -- optimiseTree commits to
		// exactly N leaves, so it can. Flag it.
		const mono = r3 && r6 ? (r6.liftPct >= r3.liftPct - 0.5 ? "y" : "**N**") : "-";
		if (mono === "**N**") nonMonotonic++;
		lines.push(
			`| ${cb.label} | ${ext ? f2(ext.liftPct) : "-"} | ${r3 ? f2(r3.liftPct) : "-"} | ${r6 ? f2(r6.liftPct) : "-"} | ${mono} |`,
		);
	}
	lines.push(``);
	if (nonMonotonic > 0) {
		lines.push(
			`> **${nonMonotonic} build(s): repair-r6 < repair-r3.** optimiseTree removes exactly ` +
				`\`respecBudget\` leaves in one shot; if the deepest few are not really expendable the ` +
				`whole plan can fail \`better-of\` and fall back to no-change. Repair should sweep k=1..N ` +
				`and keep the best (design doc step 7 follow-up).`,
		);
		lines.push(``);
	}

	lines.push(`## Cost by approach (median)`);
	lines.push(``);
	lines.push(`| approach | median BuildOutputs | median wall s |`);
	lines.push(`|---|--:|--:|`);
	for (const approach of APPROACHES) {
		const sub = rows.filter((r) => r.approach === approach.name);
		if (sub.length === 0) continue;
		lines.push(`| ${approach.name} | ${median(sub.map((r) => r.buildOutputs))} | ${f2(median(sub.map((r) => r.wallSeconds)))} |`);
	}
	lines.push(``);

	if (skipped.length > 0) {
		lines.push(`## Skipped`);
		lines.push(``);
		for (const s of skipped) lines.push(`- ${s}`);
		lines.push(``);
	}

	const text = lines.join("\n");
	const outFile = outFileFor(objectiveSpec);
	fs.writeFileSync(outFile, text + "\n");
	console.log(text);
	console.error(`\nwrote ${path.relative(path.join(__dirname, ".."), outFile)}`);
}

main().catch((err) => {
	console.error("bench-tree-approaches failed:", err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
