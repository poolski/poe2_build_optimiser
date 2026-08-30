// Shared fakes for the fast suite -- no LuaJIT. Not a *.test.ts so vitest does not collect it.

import type { PobBridgeClient, ShardProgress } from "@poe2/pob-bridge";
import type { BridgeLease, BridgeSource } from "./builds/store";
import type {
	OptimiseTreeOptions,
	OptimiseTreeResult,
	RecommendedNode,
	RecommendTreeOptions,
} from "./core";
import type { CoreFns } from "./jobs/runner";

export type CallHandler = (method: string, params?: Record<string, unknown>) => unknown;

/** A canned bridge: `call(method)` returns `handlers[method]` (or runs it if it's a function).
 *  `acquireParallel(n)` does not simulate real multi-slot fan-out (there is no fake for that --
 *  ParallelBridge's own sharding is covered by packages/pob-bridge/src/parallel.test.ts); it just
 *  hands back the same canned single-bridge shape, so callers/tests that only care about WHICH
 *  acquire method the runner picked (and with what `n`) can assert on `parallelAcquisitions`.
 *  `opts.shardProgress` replays a canned sequence of `ShardProgress` updates through whatever
 *  `onShardProgress` callback the caller passed to `acquireParallel`, for testing runner-side
 *  merging without a real `ParallelBridge`. */
export function fakeBridgeSource(
	handlers: Record<string, unknown | CallHandler>,
	opts: { onAcquire?: () => void; onRelease?: () => void; shardProgress?: ShardProgress[] } = {},
): BridgeSource & { acquired: number; released: number; parallelAcquisitions: number[] } {
	const makeLease = (): BridgeLease => ({
		call: (async (method: string, params?: Record<string, unknown>) => {
			const h = handlers[method];
			if (h === undefined) throw new Error(`fake bridge: no handler for "${method}"`);
			return typeof h === "function" ? (h as CallHandler)(method, params) : h;
		}) as BridgeLease["call"],
		release() {
			source.released++;
			opts.onRelease?.();
		},
	});
	const source = {
		acquired: 0,
		released: 0,
		parallelAcquisitions: [] as number[],
		async acquire(): Promise<BridgeLease> {
			source.acquired++;
			opts.onAcquire?.();
			return makeLease();
		},
		async acquireParallel(n: number, onShardProgress?: (update: ShardProgress) => void): Promise<BridgeLease> {
			source.acquired++;
			source.parallelAcquisitions.push(n);
			opts.onAcquire?.();
			for (const update of opts.shardProgress ?? []) onShardProgress?.(update);
			return makeLease();
		},
	};
	return source;
}

/** A fake pool that also answers `stats()` (for /api/health). */
export function fakePool(
	handlers: Record<string, unknown | CallHandler>,
	stats: { size: number; busy: number; queued: number } = { size: 2, busy: 0, queued: 0 },
) {
	return Object.assign(fakeBridgeSource(handlers), { stats: () => stats });
}

export interface StubCoreImpl {
	optimiseTree?: (bridge: PobBridgeClient, opts: OptimiseTreeOptions) => Promise<OptimiseTreeResult>;
	recommendTree?: (bridge: PobBridgeClient, opts: RecommendTreeOptions) => Promise<RecommendedNode[]>;
}

/** Build a `CoreFns` stub. The impls get a guaranteed-defined `opts` (so they can fire
 * `opts.onProgress` / read `opts.shouldContinue`); the exposed fns keep core's `opts?` signature. */
export function stubCore(impl: StubCoreImpl): CoreFns {
	return {
		optimiseTree: (bridge, opts = {}) => {
			if (!impl.optimiseTree) throw new Error("stubCore: optimiseTree not provided");
			return impl.optimiseTree(bridge, opts);
		},
		recommendTree: (bridge, opts = {}) => {
			if (!impl.recommendTree) throw new Error("stubCore: recommendTree not provided");
			return impl.recommendTree(bridge, opts);
		},
	};
}

/** A minimal valid-ish OptimiseTreeResult for `toOptimiseResultDTO` / runner tests. */
export function fakeOptimiseResult(over: Record<string, unknown> = {}) {
	return {
		mode: "extend" as const,
		baseline: { objective: 1000, pointsUsed: 100, pointsMax: 123 },
		pointBudget: 105,
		removed: [],
		steps: [],
		addedNodeIds: [],
		allocatedNodeIds: { before: [1, 2, 3], after: [1, 2, 3] },
		pointsFreed: 0,
		pointsRespent: 0,
		final: { objective: 1000, pointsSpent: 0, stats: { TotalDPS: 1000 } },
		stoppedBecause: "nothing-to-do" as const,
		buildOutputCount: 4,
		cacheHitRate: 0,
		...over,
	};
}

/** A tiny but complete PoB build XML with a base <Spec> and two weapon-set specs. */
export const SAMPLE_XML =
	`<?xml version="1.0" encoding="UTF-8"?>\n` +
	`<PathOfBuilding2>\n` +
	`\t<Build level="84" className="Warrior" ascendClassName="Smith of Kitava" mainSocketGroup="1">\n` +
	`\t\t<PlayerStat stat="TotalDPS" value="5513.53"/>\n` +
	`\t</Build>\n` +
	`\t<Tree activeSpec="1">\n` +
	`\t\t<Spec ascendClassId="3" classId="6" masteryEffects="" nodes="10,20,30,40" treeVersion="0_5">\n` +
	`\t\t\t<WeaponSet1 nodes="10,20,99"/>\n` +
	`\t\t\t<WeaponSet2 nodes="10,20"/>\n` +
	`\t\t</Spec>\n` +
	`\t</Tree>\n` +
	`</PathOfBuilding2>\n`;
