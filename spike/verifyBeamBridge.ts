// SCRATCH: verification of the two beam-search bridge changes against a real build.
// Delete once folded into docs/beam-search-repro.md (design step 8).
//   npx ts-node spike/verifyBeamBridge.ts "D:/My Documents/Path of Building (PoE2)/Builds/RampantlyBisexual.xml"

import { PobBridge } from "../src/core/bridge";
import { loadBuildFromFile } from "../src/core/loadBuild";

interface AllocNode {
	id: number;
	name: string;
	type: string;
	pathLength?: number;
	ascendancyName?: string;
	statLines: string[];
}
interface CandResult {
	nodeId: number;
	pointsSpent: number;
	ascendancyPointsSpent: number;
	stats: Record<string, unknown>;
}

const KEYS = ["TotalDPS", "Evasion", "Armour", "Life", "Mana", "TotalEHP", "FireResist"];
const pick = (s: Record<string, unknown>) => KEYS.map((k) => `${k}=${s[k]}`).join(" ");

async function main() {
	const buildXmlPath = process.argv[2];
	const bridge = new PobBridge();
	try {
		await loadBuildFromFile(bridge, buildXmlPath);
		const baseline = await bridge.call<Record<string, unknown>>("get_stats");
		console.log("baseline:", pick(baseline));

		// --- Step 1: pathLength on list_allocatable_nodes ---
		const { nodes } = await bridge.call<{ nodes: AllocNode[] }>("list_allocatable_nodes");
		const withPath = nodes.filter((n) => typeof n.pathLength === "number");
		console.log(`\n[step 1] ${withPath.length}/${nodes.length} nodes carry a numeric pathLength`);
		const lens = withPath.map((n) => n.pathLength!).sort((a, b) => a - b);
		console.log(`  pathLength range: min=${lens[0]} max=${lens[lens.length - 1]}`);
		const adjacent = withPath.filter((n) => n.pathLength === 1).slice(0, 3);
		const distant = withPath
			.filter((n) => n.pathLength! > 5)
			.sort((a, b) => b.pathLength! - a.pathLength!)
			.slice(0, 3);
		console.log("  frontier-adjacent (pathLength 1):", adjacent.map((n) => `${n.name}#${n.id}`).join(", ") || "(none)");
		console.log("  distant (pathLength > 5):", distant.map((n) => `${n.name}#${n.id}=${n.pathLength}`).join(", ") || "(none)");

		const notables = withPath.filter((n) => n.type === "Notable" && n.pathLength! <= 3).slice(0, 4);
		const candIds = notables.map((n) => n.id);
		console.log("\n  step-2 candidate ids:", candIds.join(", "), `(${notables.map((n) => n.name).join(", ")})`);

		// --- Step 2a: evaluate_candidate_nodes_from([], ids) byte-matches evaluate_candidate_nodes(ids) ---
		const legacy = await bridge.call<{ results: CandResult[] }>("evaluate_candidate_nodes", { nodeIds: candIds });
		const viaFrom = await bridge.call<{ results: CandResult[] }>("evaluate_candidate_nodes_from", {
			allocSet: [],
			nodeIds: candIds,
		});
		const match = JSON.stringify(legacy.results) === JSON.stringify(viaFrom.results);
		console.log(`\n[step 2a] from([], ids) === evaluate_candidate_nodes(ids): ${match ? "MATCH" : "MISMATCH"}`);
		if (!match) {
			console.log("  legacy:", JSON.stringify(legacy.results));
			console.log("  from  :", JSON.stringify(viaFrom.results));
		}

		// --- Step 2b: alloc a set -> evaluate -> fresh get_stats matches the original baseline ---
		const allocSet = [candIds[0], candIds[1]];
		const remaining = candIds.slice(2);
		const fromRes = await bridge.call<{ results: CandResult[] }>("evaluate_candidate_nodes_from", {
			allocSet,
			nodeIds: remaining,
		});
		const afterBaseline = await bridge.call<Record<string, unknown>>("get_stats");
		const roundTrip = JSON.stringify(baseline) === JSON.stringify(afterBaseline);
		console.log(
			`\n[step 2b] get_stats after from(allocSet=[${allocSet}]) === original baseline: ${roundTrip ? "MATCH" : "MISMATCH"}`,
		);
		if (!roundTrip) console.log("  after:", pick(afterBaseline));

		// --- Step 2c: marginal cost/stats over a partial allocation vs over baseline ---
		console.log(`\n[step 2c] candidate #${remaining[0]} measured two ways:`);
		const overBase = legacy.results.find((r) => r.nodeId === remaining[0])!;
		const overPartial = fromRes.results.find((r) => r.nodeId === remaining[0])!;
		console.log(`  over baseline : pointsSpent=${overBase.pointsSpent} ${pick(overBase.stats)}`);
		console.log(`  over allocSet : pointsSpent=${overPartial.pointsSpent} ${pick(overPartial.stats)}`);

		// --- Step 2d: from(allocSet=[a,b], [c]).stats for c == evaluate_candidate_nodes over the
		// concatenation a,b,c via chained allocSet. Cross-check: absolute stats of c-on-top-of-[a,b]
		// should equal from(allocSet=[a], [b... no]) -- simplest equivalent: from([a,b,c-less-c]).
		// We compare from(allocSet=[a,b],[c]) against from(allocSet=[b,a],[c]) (order independence).
		const swapped = await bridge.call<{ results: CandResult[] }>("evaluate_candidate_nodes_from", {
			allocSet: [allocSet[1], allocSet[0]],
			nodeIds: remaining,
		});
		const c1 = fromRes.results.find((r) => r.nodeId === remaining[0])!;
		const c2 = swapped.results.find((r) => r.nodeId === remaining[0])!;
		const orderIndep = JSON.stringify(c1) === JSON.stringify(c2);
		console.log(`\n[step 2d] from(allocSet=[a,b]) === from(allocSet=[b,a]) for candidate stats: ${orderIndep ? "MATCH" : "MISMATCH"}`);
		if (!orderIndep) {
			console.log("  [a,b]:", pick(c1.stats), "p=", c1.pointsSpent);
			console.log("  [b,a]:", pick(c2.stats), "p=", c2.pointsSpent);
		}

		// --- Step 7 bridge additions: get_stats_from + BuildOutput counter ---
		await bridge.call("reset_metrics");
		const sf = await bridge.call<{ stats: Record<string, unknown>; pointsSpent: number }>("get_stats_from", {
			allocSet,
		});
		const afterSf = await bridge.call<Record<string, unknown>>("get_stats");
		const sfRoundTrip = JSON.stringify(baseline) === JSON.stringify(afterSf);
		console.log(`\n[step 7a] get_stats_from(allocSet=[${allocSet}]): pointsSpent=${sf.pointsSpent} ${pick(sf.stats)}`);
		console.log(`[step 7b] baseline restored after get_stats_from: ${sfRoundTrip ? "MATCH" : "MISMATCH"}`);
		// get_stats_from does 2 recomputes (measured state + restore); reset zeroed the counter.
		const m = await bridge.call<{ buildOutputCount: number }>("get_metrics");
		console.log(`[step 7c] BuildOutput counter after one get_stats_from: ${m.buildOutputCount} (expect 2)`);

		// get_stats_from(allocSet) stats should match evaluate_candidate_nodes_from(allocSet\{last}, [last])
		// for the same final node set -- i.e. adding candIds[1] on top of [candIds[0]].
		const viaCand = await bridge.call<{ results: CandResult[] }>("evaluate_candidate_nodes_from", {
			allocSet: [allocSet[0]],
			nodeIds: [allocSet[1]],
		});
		const sameSet = JSON.stringify(sf.stats) === JSON.stringify(viaCand.results[0].stats);
		console.log(
			`[step 7d] get_stats_from([a,b]).stats === from([a],[b]).stats: ${sameSet ? "MATCH" : "MISMATCH"}`,
		);

		// --- Repair step 1: list_allocated_nodes + evaluate_dealloc_candidates ---
		const { nodes: allocated } = await bridge.call<{ nodes: AllocNode[] }>("list_allocated_nodes");
		const regular = allocated.filter((n) => !n.ascendancyName);
		console.log(
			`\n[repair 1a] list_allocated_nodes: ${allocated.length} total (${regular.length} regular, ${allocated.length - regular.length} ascendancy)`,
		);

		// Probe a spread of allocated regular nodes for leaf vs load-bearing.
		const probe = regular.filter((_, i) => i % Math.ceil(regular.length / 12) === 0).slice(0, 12);
		await bridge.call("reset_metrics");
		const { results: deallocs } = await bridge.call<{
			results: Array<{ nodeId: number; pointsFreed: number; ascendancyPointsFreed: number; stats: Record<string, unknown> }>;
		}>("evaluate_dealloc_candidates", { nodeIds: probe.map((n) => n.id) });

		const byId = new Map(probe.map((n) => [n.id, n]));
		const leaves = deallocs.filter((d) => d.pointsFreed === 1);
		const loadBearing = deallocs.filter((d) => d.pointsFreed > 1);
		console.log(`[repair 1b] probed ${deallocs.length}: ${leaves.length} leaves (pointsFreed==1), ${loadBearing.length} load-bearing (>1)`);
		for (const d of deallocs.slice(0, 8)) {
			const n = byId.get(d.nodeId)!;
			const dpsNow = Number(d.stats.TotalDPS);
			const dpsBase = Number(baseline.TotalDPS);
			console.log(
				`   ${n.name} (${n.type}) freed ${d.pointsFreed}pt  TotalDPS ${dpsBase.toFixed(0)} -> ${dpsNow.toFixed(0)} (${(dpsNow - dpsBase).toFixed(0)})`,
			);
		}

		const afterDealloc = await bridge.call<Record<string, unknown>>("get_stats");
		const deallocRoundTrip = JSON.stringify(baseline) === JSON.stringify(afterDealloc);
		console.log(`[repair 1c] baseline restored after evaluate_dealloc_candidates: ${deallocRoundTrip ? "MATCH" : "MISMATCH"}`);
		if (!deallocRoundTrip) console.log("   after:", pick(afterDealloc));
	} finally {
		bridge.dispose();
	}
}

main().catch((e) => {
	console.error("verify failed:", e);
	process.exitCode = 1;
});
