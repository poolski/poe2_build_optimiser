#!/usr/bin/env node
// CLI: plan a multi-step passive-tree change for a build -- extend mode (add points within a
// budget) or leaf-only repair mode (free the lowest-value allocated leaves and re-spend them).
// Argument parsing + console output live here; core/optimiseTree.ts returns plain data.

import { PobBridge } from "./core/bridge";
import { ELEMENTAL_RESIST_METRICS, expectValue, parseConstraint, parseIntFlag, parseList } from "./cliShared";
import { loadBuildFromFile } from "./core/loadBuild";
import { parseObjective } from "./core/objective";
import { optimiseTree, OptimiseTreeOptions, OptimiseTreeResult } from "./core/optimiseTree";

const USAGE = `usage: optimise-tree <path-to-build.xml> [options]

  mode
    --mode <extend|repair>       default: repair if --respec-budget > 0, else extend
    --respec-budget <n>          repair mode: free up to n low-value allocated leaves and re-spend
    --repair-nodes <n>           alias for --respec-budget

  budget (extend mode)
    --point-budget <n>           absolute cap on total regular points the plan may occupy
    --extra-points <n>           shorthand: pointsUsed + n  (mutually exclusive with --point-budget)

  scoring
    --target <metric>            mainOutput key to maximise (default TotalDPS)
    --objective <spec>           'dps-ehp:W' | 'blend:MetricA,MetricB,W' | a bare metric name
                                 (takes precedence over --target)

  search
    --proximity <k>              max pathLength per step (default 3)
    --node-types <A,B,...>       candidate node types (default Notable,Keystone)
    --all-node-types             consider every node type
    --keywords <a,b,...>         keep only candidates whose stat lines mention one of these
    --exclude-keywords <a,b,...> drop candidates mentioning one of these
    --max-candidates <n>         per-step candidate cap after the screens (dev knob)

  constraints (floors on any mainOutput metric)
    --min-resist <n>             floor Fire/Cold/Lightning resist at n
    --constraint <Metric>=<n>    repeatable
    --preserve <A,B,...>         floor each metric at its loaded-baseline value (no regression)
`;

export interface OptimiseCliArgs {
	buildXmlPath: string;
	options: OptimiseTreeOptions;
	/** Resolved against `pointsUsed` in main() (needs the bridge). null = not given. */
	extraPoints: number | null;
	/** Present only so main() can warn when extend mode has nothing to do. */
	explicitBudget: boolean;
}

export function parseArgs(argv: string[]): OptimiseCliArgs {
	const positional: string[] = [];
	let mode: "extend" | "repair" | undefined;
	let respecBudget: number | undefined;
	let pointBudget: number | undefined;
	let extraPoints: number | undefined;
	let proximity: number | undefined;
	let targetMetric: string | undefined;
	let objectiveSpec: string | undefined;
	let nodeTypes: string[] | undefined;
	let includeAllNodeTypes = false;
	let keywords: string[] | undefined;
	let excludeKeywords: string[] | undefined;
	let maxCandidatesPerStep: number | undefined;
	const constraints: Record<string, number> = {};
	let preserveMetrics: string[] | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--mode") {
			const v = expectValue(argv, ++i, "--mode");
			if (v !== "extend" && v !== "repair") throw new Error(`--mode expects extend|repair, got "${v}"`);
			mode = v;
		} else if (arg === "--respec-budget" || arg === "--repair-nodes") {
			respecBudget = parseIntFlag(expectValue(argv, ++i, arg), arg);
		} else if (arg === "--point-budget") {
			pointBudget = parseIntFlag(expectValue(argv, ++i, "--point-budget"), "--point-budget");
		} else if (arg === "--extra-points") {
			extraPoints = parseIntFlag(expectValue(argv, ++i, "--extra-points"), "--extra-points");
		} else if (arg === "--proximity") {
			proximity = parseIntFlag(expectValue(argv, ++i, "--proximity"), "--proximity");
		} else if (arg === "--target") {
			targetMetric = expectValue(argv, ++i, "--target");
		} else if (arg === "--objective") {
			objectiveSpec = expectValue(argv, ++i, "--objective");
		} else if (arg === "--node-types") {
			nodeTypes = parseList(expectValue(argv, ++i, "--node-types"));
		} else if (arg === "--all-node-types") {
			includeAllNodeTypes = true;
		} else if (arg === "--keywords") {
			keywords = parseList(expectValue(argv, ++i, "--keywords"));
		} else if (arg === "--exclude-keywords") {
			excludeKeywords = parseList(expectValue(argv, ++i, "--exclude-keywords"));
		} else if (arg === "--max-candidates") {
			maxCandidatesPerStep = parseIntFlag(expectValue(argv, ++i, "--max-candidates"), "--max-candidates");
		} else if (arg === "--min-resist") {
			const floor = Number(expectValue(argv, ++i, "--min-resist"));
			if (!Number.isFinite(floor)) throw new Error("--min-resist expects a number");
			for (const metric of ELEMENTAL_RESIST_METRICS) constraints[metric] = floor;
		} else if (arg === "--constraint") {
			const [metric, value] = parseConstraint(expectValue(argv, ++i, "--constraint"));
			constraints[metric] = value;
		} else if (arg === "--preserve") {
			preserveMetrics = parseList(expectValue(argv, ++i, "--preserve"));
		} else if (arg.startsWith("--")) {
			throw new Error(`unknown flag "${arg}"\n\n${USAGE}`);
		} else {
			positional.push(arg);
		}
	}

	if (positional.length !== 1) {
		throw new Error(USAGE);
	}
	if (pointBudget !== undefined && extraPoints !== undefined) {
		throw new Error("--point-budget and --extra-points are mutually exclusive");
	}
	if (targetMetric !== undefined && objectiveSpec !== undefined) {
		throw new Error("--target and --objective are mutually exclusive (use one)");
	}
	if (respecBudget !== undefined && respecBudget < 0) {
		throw new Error("--respec-budget cannot be negative");
	}

	// Resolve mode.
	let resolvedRespec: number;
	if (mode === "repair") {
		if (!respecBudget || respecBudget <= 0) {
			throw new Error("--mode repair needs --respec-budget <n> (n > 0)");
		}
		resolvedRespec = respecBudget;
	} else if (mode === "extend") {
		if (respecBudget && respecBudget > 0) {
			throw new Error("--mode extend conflicts with --respec-budget > 0");
		}
		resolvedRespec = 0;
	} else {
		resolvedRespec = respecBudget && respecBudget > 0 ? respecBudget : 0;
	}

	const options: OptimiseTreeOptions = {
		targetMetric,
		objectiveFn: objectiveSpec ? parseObjective(objectiveSpec) : undefined,
		nodeTypes,
		includeAllNodeTypes,
		constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
		preserveMetrics,
		respecBudget: resolvedRespec,
		proximity,
		maxCandidatesPerStep,
		keywords,
		excludeKeywords,
	};

	// pointBudget: absolute wins; otherwise extra-points is resolved against pointsUsed in main().
	const explicitBudget = pointBudget !== undefined || extraPoints !== undefined;
	if (pointBudget !== undefined) options.pointBudget = pointBudget;

	return { buildXmlPath: positional[0], options, extraPoints: extraPoints ?? null, explicitBudget };
}

function fmt(n: number): string {
	return Number.isFinite(n) ? n.toFixed(2) : String(n);
}

function report(result: OptimiseTreeResult, wallSeconds: string): void {
	const objectiveLabel = "objective";
	console.log(
		`mode: ${result.mode}   baseline ${objectiveLabel} ${fmt(result.baseline.objective)}   ` +
			`points ${result.baseline.pointsUsed}/${result.baseline.pointsMax}` +
			(result.mode === "repair" ? `   respec budget ${result.respecBudget}` : `   point budget ${result.pointBudget}`),
	);
	console.log();

	if (result.removed.length > 0) {
		console.log(`Freed ${result.pointsFreed} leaf point(s):`);
		for (const r of result.removed) {
			console.log(
				`  - ${r.name} (${r.type})   value lost ${fmt(r.valueLost)}   ` +
					`[${objectiveLabel} ${fmt(result.baseline.objective)} -> ${fmt(r.objectiveAfterRemoval)} without it]`,
			);
		}
		console.log();
	}

	const stepLabel = result.mode === "repair" ? "re-spend step" : "step";
	if (result.steps.length === 0) {
		console.log(`No ${stepLabel}s. Stopped: ${result.stoppedBecause}`);
	} else {
		console.log(`${result.steps.length} ${stepLabel}(s):`);
		for (const [i, s] of result.steps.entries()) {
			console.log(
				`  ${i + 1}. ${s.name} (${s.type}, ${s.pointsSpent} pt, path ${s.pathLength ?? "?"})   ` +
					`${objectiveLabel} ${fmt(s.objectiveBefore)} -> ${fmt(s.objectiveAfter)}  (+${fmt(s.deltaPerPoint)}/pt)`,
			);
			for (const line of s.statLines) console.log(`       - ${line}`);
		}
		console.log(`Stopped: ${result.stoppedBecause}`);
	}
	console.log();

	const net = result.final.pointsSpent;
	const netLabel = result.mode === "repair" ? `net ${net >= 0 ? "+" : ""}${net} pts (freed ${result.pointsFreed} / re-spent ${result.pointsRespent})` : `${net} pts spent`;
	console.log(`${objectiveLabel} ${fmt(result.baseline.objective)} -> ${fmt(result.final.objective)}   (${netLabel})`);
	console.log(
		`BuildOutput recomputes: ${result.buildOutputCount ?? "n/a"}   cache hit rate: ${(result.cacheHitRate * 100).toFixed(0)}%   wall ${wallSeconds}s`,
	);

	if (result.mode === "repair" && result.stoppedBecause === "repair-not-worthwhile") {
		console.log("\n(repair could not beat the loaded tree -- recommending no change)");
	}
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(USAGE);
		return;
	}
	const { buildXmlPath, options, extraPoints, explicitBudget } = parseArgs(argv);

	const bridge = new PobBridge();
	try {
		await loadBuildFromFile(bridge, buildXmlPath);
		await bridge.call("reset_metrics");

		if (extraPoints !== null) {
			const status = await bridge.call<{ pointsUsed: number }>("get_tree_status");
			options.pointBudget = status.pointsUsed + extraPoints;
		}

		const isExtend = (options.respecBudget ?? 0) === 0;
		if (isExtend && !explicitBudget) {
			console.error(
				"extend mode with no --point-budget / --extra-points has nothing to add (budget defaults to points already used).\n" +
					"Pass --extra-points <n> to plan ahead, or --respec-budget <n> for repair mode.\n",
			);
		}

		const t0 = Date.now();
		const result = await optimiseTree(bridge, options);
		const wall = ((Date.now() - t0) / 1000).toFixed(1);
		report(result, wall);
	} finally {
		bridge.dispose();
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
	});
}
