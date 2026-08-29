// Memoizing layer over the two "measure a partial allocation" bridge RPCs
// (evaluate_candidate_nodes_from, get_stats_from). The beam repair loop revisits the same
// (allocSet, candidate) pairs constantly -- beam states reconverge via different allocation
// orders, and BuildOutput() is not incremental -- so caching the measured result is the main way
// to reclaim repeated work (pruning layer 5 in intake/beam-search-design.md).
//
// The cache key is the sorted allocSet joined on "," (ids are integers, so this is lossless --
// no hash collisions) plus the candidate id. In repair mode a non-empty `removeIds` set (leaves
// the driver dropped off the loaded tree) is prefixed as "r<sorted>|" so the same (allocSet,
// candidate) pair keyed against a different removal set never collides; an empty removeIds set
// produces the bare allocSet key, byte-identical to extend mode. Keys are per evaluator instance;
// make one per optimise run.

import { PobBridgeClient } from "@poe2/pob-bridge";
import { StatSet } from "./stats";

export interface CandidateEval {
	nodeId: number;
	/** Marginal point cost over the allocSet (the node plus any path nodes AllocNode drags in). */
	pointsSpent: number;
	ascendancyPointsSpent: number;
	stats: StatSet;
}

export interface AllocSetStats {
	/** Real point cost of the whole allocSet over the loaded baseline. */
	pointsSpent: number;
	ascendancyPointsSpent: number;
	stats: StatSet;
}

export class MemoEvaluator {
	private candidateCache = new Map<string, CandidateEval>();
	private allocSetCache = new Map<string, AllocSetStats>();
	hits = 0;
	misses = 0;

	constructor(private bridge: PobBridgeClient) {}

	private static sorted(ids: readonly number[]): number[] {
		return [...ids].sort((a, b) => a - b);
	}

	/** allocSet key, optionally prefixed with the removeIds set. Empty removeIds => bare allocSet
	 * key (byte-identical to extend mode). */
	private static key(allocSet: readonly number[], removeIds: readonly number[]): string {
		const base = MemoEvaluator.sorted(allocSet).join(",");
		if (removeIds.length === 0) return base;
		return `r${MemoEvaluator.sorted(removeIds).join(",")}|${base}`;
	}

	/** Measure each nodeId on top of `allocSet`, optionally against a tree with `removeIds`
	 * deallocated first (repair mode). Cache hits are served locally; the misses go to the bridge
	 * in one round trip. Results come back in `nodeIds` order (a node the bridge can't connect from
	 * this frontier is simply absent, same as the raw RPC). */
	async evaluateFrom(
		allocSet: readonly number[],
		nodeIds: readonly number[],
		removeIds: readonly number[] = [],
	): Promise<CandidateEval[]> {
		const cacheKey = MemoEvaluator.key(allocSet, removeIds);
		const need: number[] = [];
		const have = new Map<number, CandidateEval>();
		for (const id of nodeIds) {
			const cached = this.candidateCache.get(`${cacheKey}:${id}`);
			if (cached) {
				this.hits++;
				have.set(id, cached);
			} else {
				this.misses++;
				need.push(id);
			}
		}
		if (need.length > 0) {
			const params: Record<string, unknown> = {
				allocSet: MemoEvaluator.sorted(allocSet),
				nodeIds: need,
			};
			if (removeIds.length > 0) params.removeIds = MemoEvaluator.sorted(removeIds);
			const { results } = await this.bridge.call<{ results: CandidateEval[] }>(
				"evaluate_candidate_nodes_from",
				params,
			);
			for (const r of results) {
				this.candidateCache.set(`${cacheKey}:${r.nodeId}`, r);
				have.set(r.nodeId, r);
			}
		}
		return nodeIds.map((id) => have.get(id)).filter((r): r is CandidateEval => r !== undefined);
	}

	/** Stats of the build with `allocSet` allocated on top of the loaded baseline (or on top of the
	 * loaded baseline minus `removeIds`, repair mode). Memoized on the (removeIds, allocSet) pair.
	 * With removeIds set, `pointsSpent` is the NET point delta (see the bridge's get_stats_from). */
	async statsFrom(allocSet: readonly number[], removeIds: readonly number[] = []): Promise<AllocSetStats> {
		const cacheKey = MemoEvaluator.key(allocSet, removeIds);
		const cached = this.allocSetCache.get(cacheKey);
		if (cached) {
			this.hits++;
			return cached;
		}
		this.misses++;
		const params: Record<string, unknown> = { allocSet: MemoEvaluator.sorted(allocSet) };
		if (removeIds.length > 0) params.removeIds = MemoEvaluator.sorted(removeIds);
		const result = await this.bridge.call<AllocSetStats>("get_stats_from", params);
		this.allocSetCache.set(cacheKey, result);
		return result;
	}

	get cacheSize(): number {
		return this.candidateCache.size + this.allocSetCache.size;
	}

	get hitRate(): number {
		const total = this.hits + this.misses;
		return total === 0 ? 0 : this.hits / total;
	}
}
