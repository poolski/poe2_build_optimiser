// Memoizing layer over the two "measure a partial allocation" bridge RPCs
// (evaluate_candidate_nodes_from, get_stats_from). The beam repair loop revisits the same
// (allocSet, candidate) pairs constantly -- beam states reconverge via different allocation
// orders, and BuildOutput() is not incremental -- so caching the measured result is the main way
// to reclaim repeated work (pruning layer 5 in docs/beam-search-design.md).
//
// The cache key is the sorted allocSet joined on "," (ids are integers, so this is lossless --
// no hash collisions) plus the candidate id. Keys are per evaluator instance; make one per
// optimise run.

import { PobBridgeClient } from "./bridge";
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

	private static sortedKey(allocSet: readonly number[]): string {
		return [...allocSet].sort((a, b) => a - b).join(",");
	}

	/** Measure each nodeId on top of `allocSet`. Cache hits are served locally; the misses go to
	 * the bridge in one round trip. Results come back in `nodeIds` order (a node the bridge can't
	 * connect from this allocSet is simply absent, same as the raw RPC). */
	async evaluateFrom(allocSet: readonly number[], nodeIds: readonly number[]): Promise<CandidateEval[]> {
		const base = MemoEvaluator.sortedKey(allocSet);
		const need: number[] = [];
		const have = new Map<number, CandidateEval>();
		for (const id of nodeIds) {
			const cached = this.candidateCache.get(`${base}:${id}`);
			if (cached) {
				this.hits++;
				have.set(id, cached);
			} else {
				this.misses++;
				need.push(id);
			}
		}
		if (need.length > 0) {
			const { results } = await this.bridge.call<{ results: CandidateEval[] }>("evaluate_candidate_nodes_from", {
				allocSet: base.length > 0 ? base.split(",").map(Number) : [],
				nodeIds: need,
			});
			for (const r of results) {
				this.candidateCache.set(`${base}:${r.nodeId}`, r);
				have.set(r.nodeId, r);
			}
		}
		return nodeIds.map((id) => have.get(id)).filter((r): r is CandidateEval => r !== undefined);
	}

	/** Stats of the build with `allocSet` allocated on top of the loaded baseline. Memoized on the
	 * sorted allocSet. */
	async statsFrom(allocSet: readonly number[]): Promise<AllocSetStats> {
		const key = MemoEvaluator.sortedKey(allocSet);
		const cached = this.allocSetCache.get(key);
		if (cached) {
			this.hits++;
			return cached;
		}
		this.misses++;
		const result = await this.bridge.call<AllocSetStats>("get_stats_from", {
			allocSet: key.length > 0 ? key.split(",").map(Number) : [],
		});
		this.allocSetCache.set(key, result);
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
