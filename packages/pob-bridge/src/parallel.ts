// Phase 1.5 -- parallel candidate evaluation within a single optimise/recommend run.
//
// A ParallelBridge wraps N leased slots (see PobBridgePool.lease) and implements the same
// PobBridgeClient shape a single PobBridge does, so it is a drop-in `bridge` argument for
// optimiseTree / recommendTree and every method src/core/evaluator.ts's MemoEvaluator calls --
// no changes needed in src/core at all. That is deliberate: this repo's own architecture rule
// (CLAUDE.md) is "src/core receives a bridge and never constructs one"; a ParallelBridge is still
// just a bridge from core's point of view, so phase 1.5 stays entirely a packages/pob-bridge
// concern plus a construction choice at the edges (a CLI flag, an API job option).
//
// Per-method routing (see docs/gotchas.md + bridge.lua's own comments for why each choice is
// safe):
//   - evaluate_candidate_nodes[_from] -- SHARDED. Each is fully self-contained per call: the
//     handler wraps the whole batch in its own CreateUndoState/RestoreUndoState and ends by
//     resyncing mainOutput (evaluateCandidatesAgainst in bridge.lua), reading only the ids/
//     allocSet/removeIds passed in that one request. Nothing about it depends on, or leaves
//     behind, state another concurrent call on a *different* child could observe -- each leased
//     slot is a separate OS process. Splitting `nodeIds` into contiguous chunks and dispatching
//     one chunk per slot is exactly the technique the bench harness already uses across builds
//     (spike/benchTreeApproaches.ts), just within one build instead of across many.
//   - load_build_xml, reset_metrics -- BROADCAST to every slot (awaited together). These are the
//     only methods where "every slot must agree" needs an explicit fan-out instead of routing to
//     one slot: the whole point of a lease is that every slot has the same build loaded.
//   - get_metrics -- AGGREGATED (summed). buildOutputCount / buildOutputSeconds are per-child
//     module-local counters in bridge.lua (`local buildOutputCount = 0` at file scope) -- each
//     slot only knows about the recomputes *it* ran. The run's true total is the sum across every
//     leased slot, not just the primary's.
//       * buildOutputCount vs. the serial (N=1) count for the SAME options: NOT expected to be
//         equal, and that is not a bug -- it is real extra work, not a miscount. The tail of
//         evaluateCandidatesAgainst in bridge.lua (packages/pob-bridge/pob-runtime/bridge.lua)
//         does one extra recomputeBuild() per evaluate_candidate_nodes_from CALL whenever that
//         call's allocSet/removeIds is non-empty, to resync mainOutput after the call's own outer
//         CreateUndoState/RestoreUndoState (see docs/gotchas.md). Sharding turns one such call
//         into up to N, so it turns one tail recompute into up to N. It never touches a
//         candidate's own measured stats (those come from the per-candidate AllocNode +
//         recomputeBuild() inside the loop, before the tail runs) -- the PLAN stays
//         byte-identical, only the recompute COUNT grows. Confirmed empirically 2026-08-29; see
//         src/core/optimiseTree.parallel.integration.test.ts for the exact numbers and the
//         predicted-overhead formula.
//       * buildOutputSeconds: summed across N slots that ran CONCURRENTLY, this is total CPU-time
//         across those children, NOT elapsed wall/simulation time -- unlike the serial (N=1) case,
//         where buildOutputSeconds/buildOutputCount is a genuine per-recompute wall-time figure.
//         A caller reusing this the way the bench harness's "sim s" / "ms/BO" columns do (as a
//         proxy for elapsed time) will silently get a number that grows with N even though the
//         run got faster, not slower. Treat it as a CPU-cost figure once N > 1, not a timing one.
//   - everything else (get_stats, get_tree_status, list_allocatable_nodes_from, get_stats_from,
//     list_allocated_nodes, evaluate_dealloc_candidates, ...) -- ROUTED to slots[0] ("primary").
//     Each of these is a single round trip whose result is either a scalar snapshot of the whole
//     spec (get_stats, get_tree_status) or already covers its whole input in one call with no
//     independent per-id work to distribute (list_allocatable_nodes_from enumerates the *entire*
//     reachable set in one pass; get_stats_from / list_allocated_nodes / evaluate_dealloc_candidates
//     read or mutate-then-restore the *whole* spec as one value). None of them shard along an
//     obvious per-item axis the way evaluate_candidate_nodes[_from] does, and correctness would
//     require them to run against a stable spec baseline throughout the call -- the primary slot
//     always provides that.
//
// Determinism: shard results are recombined by chunk INDEX, not arrival order. `Promise.all`
// resolves its array in input order regardless of which promise settles first, so the merged
// `results` array is byte-identical to what a single slot would have returned for the same
// `nodeIds`, independent of pool size N and of which shard happens to finish first. See
// parallel.test.ts for a fake that resolves shards out of order to prove this.
//
// Failure handling: a shard's call() rejects (e.g. its child died -- PobBridge rejects every
// pending call on unexpected exit with "bridge process exited (code N) before responding", see
// bridge.ts) propagates straight through Promise.all -- the whole ParallelBridge.call() rejects,
// the run fails, and packages/api/src/jobs/mappers.ts's existing bridge-crash classification
// (`/bridge process (exited|error)|before responding/i`) still matches. No shard's results are
// ever silently dropped.

import type { PobBridgeClient } from "./bridge";
import type { PooledBridge } from "./pool";

/** Methods where every leased slot must independently agree on the loaded build / reset state,
 *  so the call is broadcast and awaited on every slot rather than routed to one. */
const BROADCAST_METHODS = new Set(["load_build_xml", "reset_metrics"]);

/** Methods whose params carry a flat `nodeIds` array of independent per-candidate work, safe to
 *  split across slots and recombine in order (see the file header for why). */
const SHARDABLE_METHODS = new Set(["evaluate_candidate_nodes_from", "evaluate_candidate_nodes"]);

interface MetricsResult {
	buildOutputCount?: number;
	buildOutputSeconds?: number;
}

interface CandidateBatchResult {
	results: unknown[];
}

/** One shard's dispatch/settle progress, fired at dispatch (`done: 0`) and again at settle
 *  (`done === total`). `slot` is the index within `ParallelBridge.slots` -- stable for the whole
 *  run, per the PRD's "worker identity" decision (docs/prd/web-ui-live-progress-view.md). */
export interface ShardProgress {
	slot: number;
	done: number;
	total: number;
}

/** A PobBridgeClient backed by N leased slots (packages/pob-bridge/src/pool.ts's
 *  `PobBridgePool.lease`), all with the same build loaded. Construct one per run; dispose the
 *  underlying lease (not this object -- it has no state of its own) when the run finishes. */
export class ParallelBridge implements PobBridgeClient {
	constructor(
		private readonly slots: readonly PooledBridge[],
		/** Fired at dispatch and settle of each shard, purely for progress reporting -- never
		 *  awaited, never allowed to affect recombination. A throwing observer is swallowed, same
		 *  contract as core's `onProgress` (see src/core/optimiseTree.ts). */
		private readonly onShardProgress?: (update: ShardProgress) => void,
	) {
		if (slots.length === 0) {
			throw new Error("ParallelBridge needs at least one slot");
		}
	}

	/** Number of leased slots this dispatcher fans work across. */
	get size(): number {
		return this.slots.length;
	}

	async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
		if (BROADCAST_METHODS.has(method)) {
			const results = await Promise.all(this.slots.map((s) => s.call<T>(method, params)));
			return results[0];
		}
		if (method === "get_metrics") {
			return (await this.aggregateMetrics()) as unknown as T;
		}
		if (SHARDABLE_METHODS.has(method) && this.slots.length > 1) {
			const nodeIds = params?.nodeIds;
			if (Array.isArray(nodeIds) && nodeIds.length > 1) {
				return (await this.shardCandidateBatch(method, params!, nodeIds as number[])) as unknown as T;
			}
		}
		// Primary slot: every other method, plus a shardable one with <= 1 candidate (not worth
		// splitting) or a single-slot lease (nothing to split across).
		return this.slots[0].call<T>(method, params);
	}

	private async aggregateMetrics(): Promise<{ buildOutputCount: number; buildOutputSeconds: number }> {
		const all = await Promise.all(this.slots.map((s) => s.call<MetricsResult>("get_metrics")));
		let buildOutputCount = 0;
		let buildOutputSeconds = 0;
		for (const m of all) {
			buildOutputCount += m.buildOutputCount ?? 0;
			buildOutputSeconds += m.buildOutputSeconds ?? 0;
		}
		return { buildOutputCount, buildOutputSeconds };
	}

	/** Split `nodeIds` into up to `slots.length` contiguous chunks (order-preserving), dispatch one
	 *  `method` call per non-empty chunk to a distinct slot, and recombine by chunk index -- never
	 *  by arrival order -- so the merged `results` array matches what one slot evaluating the whole
	 *  batch would have returned, regardless of which shard finishes first or how many slots N is. */
	private async shardCandidateBatch(
		method: string,
		params: Record<string, unknown>,
		nodeIds: number[],
	): Promise<CandidateBatchResult> {
		const shardCount = Math.min(this.slots.length, nodeIds.length);
		const base = Math.floor(nodeIds.length / shardCount);
		const extra = nodeIds.length % shardCount;
		const chunks: number[][] = [];
		let offset = 0;
		for (let i = 0; i < shardCount; i++) {
			const len = base + (i < extra ? 1 : 0);
			chunks.push(nodeIds.slice(offset, offset + len));
			offset += len;
		}

		const settled = await Promise.all(
			chunks.map(async (chunk, i) => {
				this.reportShardProgress({ slot: i, done: 0, total: chunk.length });
				const result = await this.slots[i].call<CandidateBatchResult>(method, { ...params, nodeIds: chunk });
				this.reportShardProgress({ slot: i, done: chunk.length, total: chunk.length });
				return result;
			}),
		);

		const results: unknown[] = [];
		for (const shard of settled) results.push(...shard.results);
		return { results };
	}

	private reportShardProgress(update: ShardProgress): void {
		try {
			this.onShardProgress?.(update);
		} catch {
			// Progress reporting is best-effort; never let it affect dispatch or recombination.
		}
	}
}
