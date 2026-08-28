// Fixture generator: take a well-built PoB-PoE2 XML and "gut" it -- deallocate N passive-tree
// leaves -- so the tree planner has a build with real spare points AND a known-good recovery
// target (the original). The benchmark can then score repair/extend as *fraction of the lost
// objective recovered*: (repaired - gutted) / (original - gutted), instead of an open-ended lift.
//
//   npm run gut-build -- "<source.xml>" [options]
//
//   --points N        how many leaves to pull (default 25)
//   --policy P        random | low | high  (default random)
//                       random -> seeded-random leaves (realistic "player drifted")
//                       low    -> leaves whose removal costs the objective least (easy recovery)
//                       high   -> leaves whose removal costs the objective most (hard recovery)
//   --seed S          RNG seed for --policy random (default 1)
//   --objective SPEC  parseObjective spec used to score removals (default "dps-ehp:0.5")
//   --out DIR         output dir (default "<source-dir>/gutted")
//
// Writes <name>-gut<N>-<policy>.xml and a .json sidecar recording the source, removed node ids,
// per-step objective, and the original vs gutted baseline. Only leaf Normal/Notable/Keystone
// nodes are pulled -- never sockets, masteries, ascendancy, or load-bearing nodes (a leaf frees
// exactly 1 point; DeallocNode cascades otherwise). Re-loads the XML each round so the leaf set
// is always recomputed against the shrinking tree.

import * as fs from "node:fs";
import * as path from "node:path";
import { PobBridge } from "../src/core/bridge";
import { parseObjective, Objective } from "../src/core/objective";
import { StatSet, finiteNumber } from "../src/core/stats";

type Policy = "random" | "low" | "high";

const METRICS = ["TotalDPS", "TotalEHP", "Life", "EnergyShield", "Armour", "Evasion"] as const;
const REMOVABLE_TYPES = new Set(["Normal", "Notable", "Keystone"]);

interface Args {
	sourceXml: string;
	points: number;
	policy: Policy;
	seed: number;
	objectiveSpec: string;
	outDir?: string;
}

function parseArgs(argv: string[]): Args {
	const positional: string[] = [];
	const opt: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) opt[a.slice(2)] = argv[++i];
		else positional.push(a);
	}
	if (!positional[0]) throw new Error('usage: gut-build "<source.xml>" [--points N] [--policy random|low|high] [--seed S] [--objective SPEC] [--out DIR]');
	const policy = (opt.policy ?? "random") as Policy;
	if (!["random", "low", "high"].includes(policy)) throw new Error(`--policy must be random|low|high, got "${policy}"`);
	return {
		sourceXml: positional[0],
		points: opt.points ? Number(opt.points) : 25,
		policy,
		seed: opt.seed ? Number(opt.seed) : 1,
		objectiveSpec: opt.objective ?? "dps-ehp:0.5",
		outDir: opt.out,
	};
}

/** mulberry32 -- tiny deterministic PRNG so --policy random is reproducible from --seed. */
function makeRng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/** Remove `ids` from the active <Spec>'s nodes= list (and its WeaponSet1/2 deviations). */
function stripNodesFromXml(xml: string, ids: Set<number>): string {
	const treeOpen = xml.match(/<Tree\b[^>]*>/);
	const activeSpec = Number(treeOpen?.[0].match(/activeSpec="(\d+)"/)?.[1] ?? "1");

	const specRe = /<Spec\b[^>]*?>[\s\S]*?<\/Spec>/g;
	const specs = [...xml.matchAll(specRe)];
	if (specs.length === 0) throw new Error("no <Spec> element found");
	const target = specs[Math.min(activeSpec - 1, specs.length - 1)];
	if (specs.length > 1) console.warn(`  note: ${specs.length} <Spec> blocks, editing activeSpec=${activeSpec}`);

	const filterList = (csv: string) =>
		csv
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0 && !ids.has(Number(s)))
			.join(",");

	const editedSpec = target[0].replace(/(\bnodes=")([^"]*)(")/g, (_m, p1, list, p3) => p1 + filterList(list) + p3);
	return xml.slice(0, target.index!) + editedSpec + xml.slice(target.index! + target[0].length);
}

interface AllocatedNode {
	id: number;
	name: string;
	type: string;
	ascendancyName?: string;
}
interface DeallocResult {
	nodeId: number;
	pointsFreed: number;
	ascendancyPointsFreed: number;
	stats: StatSet;
}
interface TreeStatus {
	pointsUsed: number;
	pointsMax: number;
	ascendancyPointsUsed: number;
}

function num(stats: StatSet, k: string): number | "-" {
	const v = finiteNumber(stats[k]);
	return v === null ? "-" : Math.round(v);
}

async function loadAndBaseline(bridge: PobBridge, xml: string, objective: Objective) {
	const meta = await bridge.call<{ className: string; level: number }>("load_build_xml", { xml });
	const status = await bridge.call<TreeStatus>("get_tree_status");
	const stats = await bridge.call<StatSet>("get_stats");
	return { meta, status, stats, score: objective(stats) };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const objective = parseObjective(args.objectiveSpec);
	const sourceXml = fs.readFileSync(args.sourceXml, "utf-8");
	const baseName = path.basename(args.sourceXml).replace(/\.xml$/i, "");
	const outDir = args.outDir ?? path.join(path.dirname(args.sourceXml), "gutted");
	fs.mkdirSync(outDir, { recursive: true });

	const bridge = new PobBridge();
	try {
		const original = await loadAndBaseline(bridge, sourceXml, objective);
		console.log(
			`source: ${baseName}  ${original.meta.className} L${original.meta.level}  ` +
				`${original.status.pointsUsed}/${original.status.pointsMax} pts  ` +
				`score(${args.objectiveSpec})=${original.score?.toFixed(4) ?? "undefined"}`,
		);
		console.log(`  ${METRICS.map((k) => `${k}=${num(original.stats, k)}`).join("  ")}`);
		if (original.score === undefined) {
			throw new Error(
				`objective "${args.objectiveSpec}" can't score the source build (missing/non-positive metric). ` +
					`Pass --objective TotalDPS or TotalEHP.`,
			);
		}
		console.log(`\ngutting ${args.points} leaves, policy=${args.policy}${args.policy === "random" ? ` seed=${args.seed}` : ""}\n`);

		const rng = makeRng(args.seed);
		const removed: Array<{ nodeId: number; name: string; type: string; pointsUsedAfter: number; scoreAfter: number }> = [];
		let currentXml = sourceXml;

		for (let round = 1; round <= args.points; round++) {
			const base = await loadAndBaseline(bridge, currentXml, objective);
			const baseScore = base.score;
			if (baseScore === undefined) {
				console.log(`  round ${round}: build no longer scorable, stopping early`);
				break;
			}

			const alloc = (await bridge.call<{ nodes: AllocatedNode[] }>("list_allocated_nodes")).nodes.filter(
				(n) => !n.ascendancyName && REMOVABLE_TYPES.has(n.type),
			);
			if (alloc.length === 0) {
				console.log(`  round ${round}: no removable nodes left, stopping early`);
				break;
			}

			let pick: { node: AllocatedNode; scoreAfter: number; pointsUsedAfter: number } | undefined;

			if (args.policy === "random") {
				for (const node of seededShuffle(alloc, rng)) {
					const [r] = (
						await bridge.call<{ results: DeallocResult[] }>("evaluate_dealloc_candidates", { nodeIds: [node.id] })
					).results;
					if (r.pointsFreed !== 1 || r.ascendancyPointsFreed !== 0) continue;
					const s = objective(r.stats);
					if (s === undefined) continue;
					pick = { node, scoreAfter: s, pointsUsedAfter: base.status.pointsUsed - 1 };
					break;
				}
			} else {
				const results = (
					await bridge.call<{ results: DeallocResult[] }>("evaluate_dealloc_candidates", {
						nodeIds: alloc.map((n) => n.id),
					})
				).results;
				const leaves = results
					.filter((r) => r.pointsFreed === 1 && r.ascendancyPointsFreed === 0)
					.map((r) => ({ r, s: objective(r.stats) }))
					.filter((x): x is { r: DeallocResult; s: number } => x.s !== undefined)
					.sort((a, b) => {
						const dropA = baseScore - a.s;
						const dropB = baseScore - b.s;
						return args.policy === "low" ? dropA - dropB || a.r.nodeId - b.r.nodeId : dropB - dropA || a.r.nodeId - b.r.nodeId;
					});
				const top = leaves[0];
				if (top) {
					const node = alloc.find((n) => n.id === top.r.nodeId)!;
					pick = { node, scoreAfter: top.s, pointsUsedAfter: base.status.pointsUsed - 1 };
				}
			}

			if (!pick) {
				console.log(`  round ${round}: no scorable leaf found, stopping early`);
				break;
			}

			currentXml = stripNodesFromXml(currentXml, new Set([pick.node.id]));
			removed.push({
				nodeId: pick.node.id,
				name: pick.node.name,
				type: pick.node.type,
				pointsUsedAfter: pick.pointsUsedAfter,
				scoreAfter: pick.scoreAfter,
			});
			const drop = baseScore - pick.scoreAfter;
			console.log(
				`  ${String(round).padStart(2)}. -${pick.node.type.padEnd(8)} ${pick.node.name.slice(0, 34).padEnd(34)} ` +
					`id=${String(pick.node.id).padStart(6)}  score ${baseScore.toFixed(4)} -> ${pick.scoreAfter.toFixed(4)} (${drop >= 0 ? "-" : "+"}${Math.abs(drop).toFixed(4)})`,
			);
		}

		const gutted = await loadAndBaseline(bridge, currentXml, objective);
		const gap = (original.score ?? 0) - (gutted.score ?? 0);
		console.log(
			`\ngutted: ${gutted.status.pointsUsed}/${gutted.status.pointsMax} pts ` +
				`(${gutted.status.pointsMax - gutted.status.pointsUsed} spare)  ` +
				`score=${gutted.score?.toFixed(4) ?? "undefined"}  ` +
				`gap-to-recover=${gap.toFixed(4)}`,
		);
		console.log(`  ${METRICS.map((k) => `${k}=${num(gutted.stats, k)}`).join("  ")}`);

		const tag = `${baseName}-gut${removed.length}-${args.policy}`;
		const xmlOut = path.join(outDir, `${tag}.xml`);
		const jsonOut = path.join(outDir, `${tag}.json`);
		fs.writeFileSync(xmlOut, currentXml, "utf-8");
		fs.writeFileSync(
			jsonOut,
			JSON.stringify(
				{
					source: baseName,
					sourceXmlPath: path.resolve(args.sourceXml),
					policy: args.policy,
					seed: args.policy === "random" ? args.seed : undefined,
					objectiveSpec: args.objectiveSpec,
					pointsRequested: args.points,
					pointsRemoved: removed.length,
					className: original.meta.className,
					level: original.meta.level,
					original: {
						pointsUsed: original.status.pointsUsed,
						pointsMax: original.status.pointsMax,
						score: original.score,
						stats: Object.fromEntries(METRICS.map((k) => [k, num(original.stats, k)])),
					},
					gutted: {
						pointsUsed: gutted.status.pointsUsed,
						pointsMax: gutted.status.pointsMax,
						spare: gutted.status.pointsMax - gutted.status.pointsUsed,
						score: gutted.score,
						stats: Object.fromEntries(METRICS.map((k) => [k, num(gutted.stats, k)])),
					},
					gapToRecover: gap,
					removedNodes: removed,
				},
				null,
				2,
			),
			"utf-8",
		);
		console.log(`\nwrote ${path.relative(process.cwd(), xmlOut)}`);
		console.log(`      ${path.relative(process.cwd(), jsonOut)}`);
	} finally {
		bridge.dispose();
	}
}

main().catch((err) => {
	console.error("gut-build failed:", err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
