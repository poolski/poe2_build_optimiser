// Greedy "best next points to allocate" passive-tree recommender: for every currently
// connectable, unallocated node, measure its real stat delta and point cost against the
// loaded build's own calc engine, then rank by delta-per-point. No search beyond one pass
// over the current candidate pool -- this is the mutation/measurement primitive a future
// full re-optimization search would reuse, not that search itself.

import { PobBridgeClient } from "./bridge";

export type StatSet = Record<string, unknown>;

export interface TreeStatus {
	pointsUsed: number;
	pointsMax: number;
	ascendancyPointsUsed: number;
	ascendancyPointsMax: number;
	secondaryAscendancyPointsUsed: number;
	secondaryAscendancyPointsMax: number;
}

export interface AllocatableNode {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	ascendancyName?: string;
}

interface CandidateResult {
	nodeId: number;
	pointsSpent: number;
	ascendancyPointsSpent: number;
	stats: StatSet;
}

export interface RecommendedNode {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	ascendancyName?: string;
	pointsSpent: number;
	ascendancyPointsSpent: number;
	delta: number;
	deltaPerPoint: number;
}

export interface RecommendTreeOptions {
	/** mainOutput key to rank on, e.g. "TotalDPS" or "TotalEHP". */
	targetMetric?: string;
	/** How many top-ranked nodes to return. */
	top?: number;
	/** How many candidates to send per evaluate_candidate_nodes round trip. */
	batchSize?: number;
	/** Caps the candidate pool before evaluating (each candidate costs a real recompute --
	 * useful while developing/testing against a full tree of thousands of reachable nodes).
	 * Unset evaluates every reachable candidate. */
	maxCandidates?: number;
}

const DEFAULT_TARGET_METRIC = "TotalDPS";
const DEFAULT_TOP = 10;
const DEFAULT_BATCH_SIZE = 50;

export function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

// Assumes the build is already loaded into `bridge` (via loadBuildFromFile/load_build_xml).
export async function recommendTree(
	bridge: PobBridgeClient,
	options: RecommendTreeOptions = {},
): Promise<RecommendedNode[]> {
	const targetMetric = options.targetMetric ?? DEFAULT_TARGET_METRIC;
	const top = options.top ?? DEFAULT_TOP;
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

	const baseline = await bridge.call<StatSet>("get_stats");
	const baselineValue = asNumber(baseline[targetMetric]);

	const status = await bridge.call<TreeStatus>("get_tree_status");
	const pointsAvailable = status.pointsMax - status.pointsUsed;
	const ascendancyPointsAvailable = status.ascendancyPointsMax - status.ascendancyPointsUsed;

	const { nodes: allNodes } = await bridge.call<{ nodes: AllocatableNode[] }>("list_allocatable_nodes");
	const allocatable = options.maxCandidates !== undefined ? allNodes.slice(0, options.maxCandidates) : allNodes;

	const recommendations: RecommendedNode[] = [];
	for (const batch of chunk(allocatable, batchSize)) {
		const { results } = await bridge.call<{ results: CandidateResult[] }>("evaluate_candidate_nodes", {
			nodeIds: batch.map((node) => node.id),
		});
		const byId = new Map(batch.map((node) => [node.id, node]));
		for (const result of results) {
			// A candidate's true point cost includes every path node AllocNode had to pull in to
			// connect it, not just itself -- pointsSpent/ascendancyPointsSpent are that real count.
			if (result.pointsSpent <= 0 && result.ascendancyPointsSpent <= 0) continue;
			if (result.pointsSpent > pointsAvailable) continue;
			if (result.ascendancyPointsSpent > ascendancyPointsAvailable) continue;

			const node = byId.get(result.nodeId);
			if (!node) continue;

			const delta = asNumber(result.stats[targetMetric]) - baselineValue;
			const totalPointsSpent = result.pointsSpent + result.ascendancyPointsSpent;
			recommendations.push({
				id: node.id,
				name: node.name,
				type: node.type,
				statLines: node.statLines,
				ascendancyName: node.ascendancyName,
				pointsSpent: result.pointsSpent,
				ascendancyPointsSpent: result.ascendancyPointsSpent,
				delta,
				deltaPerPoint: delta / totalPointsSpent,
			});
		}
	}

	recommendations.sort((a, b) => b.deltaPerPoint - a.deltaPerPoint);
	return recommendations.slice(0, top);
}
