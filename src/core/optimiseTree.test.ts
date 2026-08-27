import { describe, expect, it } from "vitest";
import { PobBridgeClient } from "./bridge";
import { optimiseTree } from "./optimiseTree";
import { TreeStatus } from "./recommendTree";

interface FakeNode {
	id: number;
	name?: string;
	type?: string;
	statLines?: string[];
	pathLength?: number;
}
type EvalFn = (
	allocSet: number[],
	nodeId: number,
	removeIds?: number[],
) => { pointsSpent: number; ascendancyPointsSpent?: number; stats: Record<string, unknown> };

/** An allocated node the repair pass may consider deallocating. */
interface AllocatedFake {
	id: number;
	name?: string;
	type?: string;
	statLines?: string[];
	ascendancyName?: string;
	/** Points freed by removing it. 1 => leaf (the only kind repair v1 drops). Default 1. */
	pointsFreed?: number;
	/** Stats with just this node removed from the loaded tree. */
	removedStats: Record<string, unknown>;
}

interface FakeOpts {
	allocated?: AllocatedFake[];
	/** Stats of "loaded minus removeIds, plus allocSet" -- backs get_stats_from. */
	statsFromFn?: (allocSet: number[], removeIds: number[]) => Record<string, unknown>;
}

class FakeBridge implements PobBridgeClient {
	calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
	buildOutputCount = 0;
	private allocated: AllocatedFake[];
	private statsFromFn?: (allocSet: number[], removeIds: number[]) => Record<string, unknown>;

	constructor(
		private baseStats: Record<string, unknown>,
		private status: TreeStatus,
		private nodes: FakeNode[],
		private evalFn: EvalFn,
		opts: FakeOpts = {},
	) {
		this.allocated = opts.allocated ?? [];
		this.statsFromFn = opts.statsFromFn;
	}

	async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
		this.calls.push({ method, params });
		if (method === "get_stats") return this.baseStats as T;
		if (method === "get_tree_status") return this.status as T;
		if (method === "get_metrics") return { buildOutputCount: this.buildOutputCount } as T;
		if (method === "list_allocatable_nodes_from") {
			const allocSet = (params!.allocSet as number[]) ?? [];
			const maxPathLength = params!.maxPathLength as number | undefined;
			const types = params!.types as string[] | undefined;
			const nodes = this.nodes
				.filter((n) => !allocSet.includes(n.id))
				.filter((n) => maxPathLength === undefined || (n.pathLength ?? 1) <= maxPathLength)
				.filter((n) => !types || types.includes(n.type ?? "Notable"))
				.map((n) => ({
					id: n.id,
					name: n.name ?? `Node ${n.id}`,
					type: n.type ?? "Notable",
					statLines: n.statLines ?? [`stat ${n.id}`],
					pathLength: n.pathLength ?? 1,
				}));
			return { nodes } as T;
		}
		if (method === "evaluate_candidate_nodes_from") {
			const allocSet = (params!.allocSet as number[]) ?? [];
			const removeIds = (params!.removeIds as number[]) ?? [];
			const nodeIds = params!.nodeIds as number[];
			this.buildOutputCount += nodeIds.length;
			return {
				results: nodeIds.map((id) => {
					const r = this.evalFn(allocSet, id, removeIds);
					return {
						nodeId: id,
						pointsSpent: r.pointsSpent,
						ascendancyPointsSpent: r.ascendancyPointsSpent ?? 0,
						stats: r.stats,
					};
				}),
			} as T;
		}
		if (method === "list_allocated_nodes") {
			return {
				nodes: this.allocated.map((a) => ({
					id: a.id,
					name: a.name ?? `Alloc ${a.id}`,
					type: a.type ?? "Notable",
					statLines: a.statLines ?? [`alloc stat ${a.id}`],
					ascendancyName: a.ascendancyName,
				})),
			} as T;
		}
		if (method === "evaluate_dealloc_candidates") {
			const nodeIds = params!.nodeIds as number[];
			const byId = new Map(this.allocated.map((a) => [a.id, a]));
			this.buildOutputCount += nodeIds.length;
			return {
				results: nodeIds
					.map((id) => byId.get(id))
					.filter((a): a is AllocatedFake => a !== undefined)
					.map((a) => ({
						nodeId: a.id,
						pointsFreed: a.pointsFreed ?? 1,
						ascendancyPointsFreed: 0,
						stats: a.removedStats,
					})),
			} as T;
		}
		if (method === "get_stats_from") {
			const allocSet = (params!.allocSet as number[]) ?? [];
			const removeIds = (params!.removeIds as number[]) ?? [];
			this.buildOutputCount += 1;
			return {
				pointsSpent: allocSet.length - removeIds.length,
				ascendancyPointsSpent: 0,
				stats: this.statsFromFn ? this.statsFromFn(allocSet, removeIds) : this.baseStats,
			} as T;
		}
		throw new Error(`FakeBridge: unhandled method ${method}`);
	}
}

const STATUS: TreeStatus = {
	pointsUsed: 50,
	pointsMax: 123,
	ascendancyPointsUsed: 4,
	ascendancyPointsMax: 8,
	secondaryAscendancyPointsUsed: 0,
	secondaryAscendancyPointsMax: 8,
};

describe("optimiseTree (extend mode)", () => {
	it("does nothing when the point budget equals points already used", async () => {
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [{ id: 1 }], () => ({
			pointsSpent: 1,
			stats: { TotalDPS: 9999 },
		}));

		const result = await optimiseTree(bridge, {}); // pointBudget defaults to pointsUsed

		expect(result.steps).toEqual([]);
		expect(result.stoppedBecause).toBe("nothing-to-do");
		expect(result.final.pointsSpent).toBe(0);
	});

	it("greedily picks the best delta-per-point node each step until the budget is reached", async () => {
		// Each node adds a fixed DPS increment for 1 point, stacking additively across steps.
		const increments: Record<number, number> = { 1: 300, 2: 100, 3: 50 };
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [{ id: 1 }, { id: 2 }, { id: 3 }], (allocSet, id) => {
			const total = 1000 + [...allocSet, id].reduce((sum, n) => sum + (increments[n] ?? 0), 0);
			return { pointsSpent: 1, stats: { TotalDPS: total } };
		});

		const result = await optimiseTree(bridge, { pointBudget: STATUS.pointsUsed + 2 });

		expect(result.steps.map((s) => s.id)).toEqual([1, 2]); // best two by increment
		expect(result.steps[0].delta).toBeCloseTo(300);
		expect(result.steps[1].delta).toBeCloseTo(100);
		expect(result.final.objective).toBeCloseTo(1400);
		expect(result.final.pointsSpent).toBe(2);
		expect(result.stoppedBecause).toBe("budget-reached");
	});

	it("stops early when no remaining candidate improves the objective", async () => {
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [{ id: 1 }, { id: 2 }], (allocSet, id) => ({
			pointsSpent: 1,
			// id 1 helps once; everything else is neutral or negative.
			stats: { TotalDPS: allocSet.includes(1) || id !== 1 ? 1000 : 1200 },
		}));

		const result = await optimiseTree(bridge, { pointBudget: STATUS.pointsUsed + 5 });

		expect(result.steps.map((s) => s.id)).toEqual([1]);
		expect(result.stoppedBecause).toBe("no-positive-candidate");
	});

	it("skips a step that would break a constraint floor", async () => {
		const bridge = new FakeBridge(
			{ TotalDPS: 1000, FireResist: 76 },
			STATUS,
			[
				{ id: 1, statLines: ["big dps, wrecks res"] },
				{ id: 2, statLines: ["modest dps, safe"] },
			],
			(_allocSet, id) =>
				id === 1
					? { pointsSpent: 1, stats: { TotalDPS: 5000, FireResist: 60 } }
					: { pointsSpent: 1, stats: { TotalDPS: 1100, FireResist: 76 } },
		);

		const result = await optimiseTree(bridge, {
			pointBudget: STATUS.pointsUsed + 1,
			constraints: { FireResist: 75 },
		});

		expect(result.steps.map((s) => s.id)).toEqual([2]);
	});

	it("reports BuildOutput count from the bridge and a numeric cache hit rate", async () => {
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [{ id: 1 }, { id: 2 }], (allocSet, id) => ({
			pointsSpent: 1,
			stats: { TotalDPS: 1000 + [...allocSet, id].length * 100 },
		}));

		const result = await optimiseTree(bridge, { pointBudget: STATUS.pointsUsed + 2 });

		expect(result.buildOutputCount).toBeGreaterThan(0);
		// A linear greedy walk never revisits an (allocSet, node) pair, so extend mode is expected
		// to get ~no cache hits -- just assert the field is populated.
		expect(result.cacheHitRate).toBe(0);
	});

	it("throws when the objective cannot score the baseline", async () => {
		const bridge = new FakeBridge({}, STATUS, [{ id: 1 }], () => ({ pointsSpent: 1, stats: {} }));
		await expect(optimiseTree(bridge, { targetMetric: "TotalDPS", pointBudget: STATUS.pointsUsed + 1 })).rejects.toThrow(
			/baseline/,
		);
	});
});

describe("optimiseTree (repair mode)", () => {
	// Shared model: baseline DPS 1000. Removing a leaf drops DPS by its `valueLost`. Re-spend
	// candidates add a fixed gain each, stacking additively, measured against the post-removal base.
	const valueLost: Record<number, number> = { 100: 10, 101: 30, 102: 100 };
	const removedStats = (id: number) => ({ TotalDPS: 1000 - valueLost[id] });
	const makeBridge = (candidateGain: Record<number, number>, extraAllocated: AllocatedFake[] = []) =>
		new FakeBridge(
			{ TotalDPS: 1000 },
			STATUS,
			Object.keys(candidateGain).map((k) => ({ id: Number(k) })),
			(allocSet, id, removeIds) => {
				const lost = (removeIds ?? []).reduce((s, r) => s + (valueLost[r] ?? 0), 0);
				const gain = [...allocSet, id].reduce((s, n) => s + (candidateGain[n] ?? 0), 0);
				return { pointsSpent: 1, stats: { TotalDPS: 1000 - lost + gain } };
			},
			{
				allocated: [
					{ id: 100, removedStats: removedStats(100) },
					{ id: 101, removedStats: removedStats(101) },
					{ id: 102, removedStats: removedStats(102) },
					...extraAllocated,
				],
				statsFromFn: (_allocSet, removeIds) => ({
					TotalDPS: 1000 - removeIds.reduce((s, r) => s + (valueLost[r] ?? 0), 0),
				}),
			},
		);

	it("frees the lowest-value leaves and re-spends them for a net objective gain", async () => {
		const bridge = makeBridge({ 1: 500, 2: 50 });

		const result = await optimiseTree(bridge, { respecBudget: 2 });

		expect(result.mode).toBe("repair");
		expect(result.removed.map((r) => r.id)).toEqual([100, 101]); // least value lost first
		expect(result.removed[0].valueLost).toBe(10);
		expect(result.steps.map((s) => s.id)).toEqual([1, 2]);
		expect(result.pointsFreed).toBe(2);
		expect(result.pointsRespent).toBe(2);
		expect(result.final.pointsSpent).toBe(0); // net: freed 2, spent 2
		expect(result.final.objective).toBeCloseTo(1000 - 10 - 30 + 500 + 50); // 1510
	});

	it("falls back to 'change nothing' when the re-spend can't beat the loaded tree", async () => {
		const bridge = makeBridge({ 1: 5, 2: 5 }); // recovers +10 against 40 lost

		const result = await optimiseTree(bridge, { respecBudget: 2 });

		expect(result.mode).toBe("repair");
		expect(result.stoppedBecause).toBe("repair-not-worthwhile");
		expect(result.steps).toEqual([]);
		expect(result.addedNodeIds).toEqual([]);
		expect(result.removed.map((r) => r.id)).toEqual([100, 101]); // still surfaced, informational
		expect(result.final.objective).toBe(1000); // the loaded baseline
		expect(result.final.pointsSpent).toBe(0);
	});

	it("prefers a leaf whose removal improves the objective (negative valueLost)", async () => {
		const bridge = new FakeBridge(
			{ TotalDPS: 1000 },
			STATUS,
			[{ id: 1 }],
			(allocSet, id, removeIds) => {
				const helped = (removeIds ?? []).includes(200) ? 50 : 0; // removing 200 raises DPS 50
				const lost = (removeIds ?? []).includes(201) ? 5 : 0;
				const gain = [...allocSet, id].includes(1) ? 100 : 0;
				return { pointsSpent: 1, stats: { TotalDPS: 1000 + helped - lost + gain } };
			},
			{
				allocated: [
					{ id: 200, removedStats: { TotalDPS: 1050 } }, // valueLost -50
					{ id: 201, removedStats: { TotalDPS: 995 } }, // valueLost 5
				],
				statsFromFn: (_a, removeIds) => ({
					TotalDPS: 1000 + (removeIds.includes(200) ? 50 : 0) - (removeIds.includes(201) ? 5 : 0),
				}),
			},
		);

		const result = await optimiseTree(bridge, { respecBudget: 1 });

		expect(result.removed.map((r) => r.id)).toEqual([200]);
		expect(result.removed[0].valueLost).toBe(-50);
		expect(result.final.objective).toBeCloseTo(1150);
	});

	it("never drops a leaf whose removal makes the build unscorable", async () => {
		const bridge = new FakeBridge(
			{ TotalDPS: 1000 },
			STATUS,
			[{ id: 1 }],
			(allocSet, id, removeIds) => {
				const lost = (removeIds ?? []).includes(301) ? 2 : 0;
				const gain = [...allocSet, id].includes(1) ? 40 : 0;
				return { pointsSpent: 1, stats: { TotalDPS: 1000 - lost + gain } };
			},
			{
				allocated: [
					{ id: 300, removedStats: {} }, // no TotalDPS -> unscorable -> never dropped
					{ id: 301, removedStats: { TotalDPS: 998 } },
				],
				statsFromFn: (_a, removeIds) => ({ TotalDPS: 1000 - (removeIds.includes(301) ? 2 : 0) }),
			},
		);

		const result = await optimiseTree(bridge, { respecBudget: 2 });

		expect(result.removed.map((r) => r.id)).toEqual([301]);
	});

	it("returns 'no-leaves' when nothing allocated is a leaf", async () => {
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [{ id: 1 }], () => ({ pointsSpent: 1, stats: {} }), {
			allocated: [{ id: 400, pointsFreed: 4, removedStats: { TotalDPS: 700 } }],
		});

		const result = await optimiseTree(bridge, { respecBudget: 2 });

		expect(result.mode).toBe("repair");
		expect(result.stoppedBecause).toBe("no-leaves");
		expect(result.removed).toEqual([]);
		expect(result.steps).toEqual([]);
	});
});
