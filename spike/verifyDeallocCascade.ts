// Cascade-verification spike for the any-node-repair track (PLAN.md §Active next track,
// step 1). The leaf-only repair pass filters `evaluate_dealloc_candidates` to pointsFreed == 1;
// before trusting non-leaf removal we need to know:
//
//   1. Distribution  -- on real builds, how many allocated nodes are interior (pointsFreed > 1),
//      and how big are those cascades? (free-3 is useful granularity; free-40 is not.)
//   2. Value         -- when an interior node is removed, does the objective just crater (whole
//      damage cluster offline -> regret ranking never picks it -> any-node repair adds nothing),
//      or are some interior removals cheap (redundant pathing / dead clusters)?
//   3. Re-spend reach -- after a mid-tree `removeIds` prologue, do the cascaded-off nodes come
//      back into `list_allocatable_nodes_from`'s pool at low pathLength, so greedy re-spend can
//      re-path to them?
//   4. Round-trip     -- after an interior `get_stats_from({removeIds:[m]})`, does a fresh
//      `get_stats` still equal the loaded baseline byte-for-byte? (the leaf path asserts this;
//      confirm it holds with a bigger cascade.)
//
//   npm run verify-dealloc-cascade -- "<build.xml>" [objectiveKey=TotalDPS]

import * as fs from "node:fs";
import { PobBridge } from "@poe2/pob-bridge";
import type { AllocatableNode } from "../src/core/recommendTree";

interface AllocatedNode {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	ascendancyName?: string;
}
interface DeallocResult {
	nodeId: number;
	pointsFreed: number;
	ascendancyPointsFreed: number;
	stats: Record<string, unknown>;
}

const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined;

function pct(part: number, whole: number): string {
	if (whole === 0) return "n/a";
	return `${((part / whole) * 100).toFixed(1)}%`;
}
function quantiles(xs: number[]): { min: number; p50: number; p90: number; max: number } {
	if (xs.length === 0) return { min: NaN, p50: NaN, p90: NaN, max: NaN };
	const s = [...xs].sort((a, b) => a - b);
	const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
	return { min: s[0], p50: at(0.5), p90: at(0.9), max: s[s.length - 1] };
}

async function main() {
	const buildXmlPath = process.argv[2];
	if (!buildXmlPath) throw new Error('usage: verifyDeallocCascade.ts "<build.xml>" [objectiveKey]');
	const objectiveKey = process.argv[3] ?? "TotalDPS";

	const bridge = new PobBridge();
	try {
		const xml = fs.readFileSync(buildXmlPath, "utf-8");
		const loaded = await bridge.call<{ className: string; level: number }>("load_build_xml", { xml });
		const status = await bridge.call<{ pointsUsed: number; pointsMax: number }>("get_tree_status");
		const baseStats = await bridge.call<Record<string, unknown>>("get_stats");
		const baseObj = num(baseStats[objectiveKey]);
		const baseStatsJson = JSON.stringify(baseStats);

		const name = buildXmlPath.split(/[\\/]/).pop()?.replace(/\.xml$/i, "") ?? buildXmlPath;
		console.log(`\n=== ${name}  (${loaded.className} L${loaded.level}) ===`);
		console.log(`points ${status.pointsUsed}/${status.pointsMax}   ${objectiveKey}=${baseObj ?? "unscorable"}`);

		// --- all allocated regular nodes -> dealloc probe ---
		const { nodes: allocated } = await bridge.call<{ nodes: AllocatedNode[] }>("list_allocated_nodes");
		const regular = allocated.filter((n) => !n.ascendancyName);
		const metaById = new Map(regular.map((n) => [n.id, n]));
		const { results: deallocs } = await bridge.call<{ results: DeallocResult[] }>(
			"evaluate_dealloc_candidates",
			{ nodeIds: regular.map((n) => n.id) },
		);

		const leaves = deallocs.filter((d) => d.pointsFreed === 1 && d.ascendancyPointsFreed === 0);
		const interior = deallocs.filter((d) => d.pointsFreed > 1 && d.ascendancyPointsFreed === 0);
		const weird = deallocs.filter((d) => d.pointsFreed < 1 || d.ascendancyPointsFreed !== 0);

		console.log(`\n[1] Distribution over ${deallocs.length} allocated regular nodes`);
		console.log(`    leaves (pointsFreed==1): ${leaves.length}   interior (>1): ${interior.length}   weird: ${weird.length}`);
		if (interior.length) {
			const q = quantiles(interior.map((d) => d.pointsFreed));
			console.log(`    interior pointsFreed:  min ${q.min}  p50 ${q.p50}  p90 ${q.p90}  max ${q.max}`);
		}
		if (weird.length) {
			for (const w of weird) {
				console.log(`    !! weird: ${w.nodeId} ${metaById.get(w.nodeId)?.name} pointsFreed=${w.pointsFreed} asc=${w.ascendancyPointsFreed}`);
			}
		}

		console.log(`\n[2] Objective impact of interior removals (${objectiveKey})`);
		if (baseObj === undefined) {
			console.log(`    baseline unscorable -- skipping`);
		} else {
			const buckets = { helps: 0, cheap: 0, moderate: 0, severe: 0, unscorable: 0 };
			const cheapExamples: string[] = [];
			for (const d of interior) {
				const after = num(d.stats[objectiveKey]);
				if (after === undefined) {
					buckets.unscorable++;
					continue;
				}
				const drop = (baseObj - after) / baseObj; // >0 = removal hurt
				if (drop <= 0) buckets.helps++;
				else if (drop < 0.05) buckets.cheap++;
				else if (drop < 0.25) buckets.moderate++;
				else buckets.severe++;
				if (drop <= 0.05) {
					cheapExamples.push(
						`      ${d.nodeId} ${metaById.get(d.nodeId)?.name} [${metaById.get(d.nodeId)?.type}]  frees ${d.pointsFreed}  Δobj ${pct(-(baseObj - after), baseObj)}`,
					);
				}
			}
			console.log(
				`    helps:${buckets.helps}  cheap(<5%):${buckets.cheap}  moderate(5-25%):${buckets.moderate}  severe(>=25%):${buckets.severe}  unscorable:${buckets.unscorable}`,
			);
			if (cheapExamples.length) {
				console.log(`    interior removals that barely move the objective (repair candidates):`);
				console.log(cheapExamples.slice(0, 12).join("\n"));
			}
		}

		// --- pick probe nodes: smallest-cascade interior, + the cheapest interior if any ---
		const bySmallCascade = [...interior].sort((a, b) => a.pointsFreed - b.pointsFreed || a.nodeId - b.nodeId);
		const cheapest = baseObj === undefined
			? undefined
			: [...interior]
					.map((d) => ({ d, after: num(d.stats[objectiveKey]) }))
					.filter((x) => x.after !== undefined)
					.sort((a, b) => (b.after! - a.after!) || a.d.nodeId - b.d.nodeId)[0]?.d;
		const probes = [...new Set([bySmallCascade[0], cheapest, bySmallCascade[1]].filter(Boolean))] as DeallocResult[];

		const { nodes: poolBefore } = await bridge.call<{ nodes: AllocatableNode[] }>("list_allocatable_nodes");
		const beforeIds = new Set(poolBefore.map((n) => n.id));

		console.log(`\n[3] Re-spend reachability + [4] round-trip, per probed interior node`);
		let roundTripOk = true;
		for (const p of probes) {
			const meta = metaById.get(p.nodeId);
			const { nodes: poolAfter } = await bridge.call<{ nodes: AllocatableNode[] }>(
				"list_allocatable_nodes_from",
				{ allocSet: [], removeIds: [p.nodeId] },
			);
			const newly = poolAfter.filter((n) => !beforeIds.has(n.id));
			const newlyClose = newly.filter((n) => (n.pathLength ?? 99) <= 2);
			const selfBack = poolAfter.some((n) => n.id === p.nodeId);

			// round-trip: stats must be untouched after a _from call that removed a whole subtree
			const stats2 = await bridge.call<Record<string, unknown>>("get_stats");
			const clean = JSON.stringify(stats2) === baseStatsJson;
			roundTripOk &&= clean;

			console.log(
				`  ${p.nodeId} ${meta?.name} [${meta?.type}] frees ${p.pointsFreed}:  ` +
					`newly-allocatable ${newly.length} (≤2 path: ${newlyClose.length})  self-back-in-pool: ${selfBack}  ` +
					`round-trip ${clean ? "clean" : "DIRTY"}`,
			);
			if (newlyClose.length) {
				console.log(`      e.g. ${newlyClose.slice(0, 6).map((n) => `${n.name}(${n.pathLength})`).join(", ")}`);
			}
		}

		// control: leaf round-trip
		if (leaves[0]) {
			await bridge.call("list_allocatable_nodes_from", { allocSet: [], removeIds: [leaves[0].nodeId] });
			const s = await bridge.call<Record<string, unknown>>("get_stats");
			console.log(`\n  control (leaf ${leaves[0].nodeId}): round-trip ${JSON.stringify(s) === baseStatsJson ? "clean" : "DIRTY"}`);
		}

		console.log(`\nVERDICT: round-trip ${roundTripOk ? "CLEAN on all probes" : "DIRTY -- investigate before any-node repair"}`);
	} finally {
		bridge.dispose();
	}
}
main();
