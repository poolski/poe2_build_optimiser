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
	/** Points freed by removing it: 1 => leaf, >1 => interior node whose downstream cascades off.
	 * Default 1, or `cascade.length + 1` when `cascade` is set. */
	pointsFreed?: number;
	/** ids that also leave the tree when this node is removed (its downstream cascade, excluding
	 * this node itself). Drives `list_allocated_nodes({ removeIds })` and the derived `pointsFreed`. */
	cascade?: number[];
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
			const removeIds = (params?.removeIds as number[] | undefined) ?? [];
			const gone = new Set<number>();
			for (const rid of removeIds) {
				gone.add(rid);
				const meta = this.allocated.find((a) => a.id === rid);
				for (const c of meta?.cascade ?? []) gone.add(c);
			}
			return {
				nodes: this.allocated
					.filter((a) => !gone.has(a.id))
					.map((a) => ({
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
						pointsFreed: a.pointsFreed ?? (a.cascade ? a.cascade.length + 1 : 1),
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
	weaponSet1PointsUsed: 0,
	weaponSet2PointsUsed: 0,
	weaponSetPointsMax: 24,
	treeNodesAllocated: 50,
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

	it("treats respecBudget as a ceiling: sweeps k=1..N and keeps the best prefix (non-monotonic guard)", async () => {
		// Leaves by value lost: 100 (cheap, 10), 101 (30), 102 (expensive, 120).
		// Re-spend candidates add +55 / +45 / +15 for 1 pt each, additive:
		//   k=1: -10  +55  = 1045
		//   k=2: -40  +100 = 1060   <- best
		//   k=3: -160 +115 =  955   <- below baseline; committing to the full budget => "change nothing"
		const vlost: Record<number, number> = { 100: 10, 101: 30, 102: 120 };
		const gain: Record<number, number> = { 1: 55, 2: 45, 3: 15 };
		const bridge = new FakeBridge(
			{ TotalDPS: 1000 },
			STATUS,
			[{ id: 1 }, { id: 2 }, { id: 3 }],
			(allocSet, id, removeIds) => {
				const lost = (removeIds ?? []).reduce((s, r) => s + (vlost[r] ?? 0), 0);
				const g = [...allocSet, id].reduce((s, n) => s + (gain[n] ?? 0), 0);
				return { pointsSpent: 1, stats: { TotalDPS: 1000 - lost + g } };
			},
			{
				allocated: [
					{ id: 100, removedStats: { TotalDPS: 990 } },
					{ id: 101, removedStats: { TotalDPS: 970 } },
					{ id: 102, removedStats: { TotalDPS: 880 } },
				],
				statsFromFn: (_a, removeIds) => ({
					TotalDPS: 1000 - removeIds.reduce((s, r) => s + (vlost[r] ?? 0), 0),
				}),
			},
		);

		const result = await optimiseTree(bridge, { respecBudget: 3 });

		expect(result.respecBudget).toBe(3); // the ceiling is unchanged
		expect(result.removed.map((r) => r.id)).toEqual([100, 101]); // k=2 won, not the full budget
		expect(result.pointsFreed).toBe(2);
		expect(result.steps.map((s) => s.id)).toEqual([1, 2]);
		expect(result.final.objective).toBeCloseTo(1060);
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

	it("returns 'nothing-removable' when every removal's cascade exceeds the budget", async () => {
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [{ id: 1 }], () => ({ pointsSpent: 1, stats: {} }), {
			allocated: [{ id: 400, pointsFreed: 4, removedStats: { TotalDPS: 700 } }],
		});

		const result = await optimiseTree(bridge, { respecBudget: 2 }); // 400 frees 4 > 2

		expect(result.mode).toBe("repair");
		expect(result.stoppedBecause).toBe("nothing-removable");
		expect(result.removed).toEqual([]);
		expect(result.steps).toEqual([]);
	});

	it("never frees a node in the freeze list", async () => {
		const bridge = makeBridge({ 1: 500, 2: 50 });

		const result = await optimiseTree(bridge, { respecBudget: 2, freeze: [100] });

		expect(result.removed.map((r) => r.id)).not.toContain(100);
		expect(result.removed.map((r) => r.id)).toEqual([101]); // next-lowest value lost, minus the frozen 100
		// k=1 wins the sweep: free 101's 1 point, re-spend it into candidate 1 (+500).
		expect(result.final.objective).toBeCloseTo(1000 - 30 + 500); // 1470
	});

	it("returns 'nothing-removable' when the freeze list covers every removable node", async () => {
		const bridge = makeBridge({ 1: 500 });

		const result = await optimiseTree(bridge, { respecBudget: 2, freeze: [100, 101, 102] });

		expect(result.stoppedBecause).toBe("nothing-removable");
		expect(result.removed).toEqual([]);
	});

	it("frees an interior node (pointsFreed > 1) and re-spends the whole cascade", async () => {
		// Node 110 is interior: removing it frees 3 points and drops DPS by 20. Re-spend candidates
		// 1/2/3 each add +40, additive, 1 pt each -> the walk should reclaim all 3 freed points.
		const bridge = new FakeBridge(
			{ TotalDPS: 1000 },
			STATUS,
			[{ id: 1 }, { id: 2 }, { id: 3 }],
			(allocSet, id, removeIds) => {
				const lost = (removeIds ?? []).includes(110) ? 20 : 0;
				const gain = [...allocSet, id].reduce((s, n) => s + ([1, 2, 3].includes(n) ? 40 : 0), 0);
				return { pointsSpent: 1, stats: { TotalDPS: 1000 - lost + gain } };
			},
			{
				allocated: [{ id: 110, pointsFreed: 3, removedStats: { TotalDPS: 980 } }],
				statsFromFn: (_a, removeIds) => ({ TotalDPS: 1000 - (removeIds.includes(110) ? 20 : 0) }),
			},
		);

		const result = await optimiseTree(bridge, { respecBudget: 3 });

		expect(result.removed.map((r) => r.id)).toEqual([110]);
		expect(result.removed[0].pointsFreed).toBe(3);
		expect(result.pointsFreed).toBe(3);
		expect(result.steps.map((s) => s.id)).toEqual([1, 2, 3]);
		expect(result.pointsRespent).toBe(3);
		expect(result.final.pointsSpent).toBe(0); // net: freed 3, re-spent 3
		expect(result.final.objective).toBeCloseTo(1000 - 20 + 120); // 1100
	});

	it("skips a removal whose cascade exceeds the budget and takes a smaller one that fits", async () => {
		// 120 is the cheapest to lose (valueLost 5) but frees 5 > budget 3; 121 (valueLost 10)
		// frees 2 and fits. Re-spend candidates 1/2 add +30 each.
		const vlost: Record<number, number> = { 120: 5, 121: 10 };
		const bridge = new FakeBridge(
			{ TotalDPS: 1000 },
			STATUS,
			[{ id: 1 }, { id: 2 }],
			(allocSet, id, removeIds) => {
				const lost = (removeIds ?? []).reduce((s, r) => s + (vlost[r] ?? 0), 0);
				const gain = [...allocSet, id].reduce((s, n) => s + ([1, 2].includes(n) ? 30 : 0), 0);
				return { pointsSpent: 1, stats: { TotalDPS: 1000 - lost + gain } };
			},
			{
				allocated: [
					{ id: 120, pointsFreed: 5, removedStats: { TotalDPS: 995 } },
					{ id: 121, pointsFreed: 2, removedStats: { TotalDPS: 990 } },
				],
				statsFromFn: (_a, removeIds) => ({
					TotalDPS: 1000 - removeIds.reduce((s, r) => s + (vlost[r] ?? 0), 0),
				}),
			},
		);

		const result = await optimiseTree(bridge, { respecBudget: 3 });

		expect(result.removed.map((r) => r.id)).toEqual([121]);
		expect(result.pointsFreed).toBe(2);
		expect(result.steps.map((s) => s.id)).toEqual([1, 2]);
		expect(result.final.objective).toBeCloseTo(1000 - 10 + 60); // 1050
	});
});

describe("optimiseTree (rollback-to-node)", () => {
	// Anchor 900 has a downstream cascade [901, 902] -> removing it force-frees 3 points and drops
	// DPS by 300. Survivors 910 / 911 are elsewhere in the tree (valueLost 20 / 25). Re-spend pool
	// 1/2/3/4 adds +200 / +150 / +40 / +35 per point, additive.
	const lost: Record<number, number> = { 900: 300, 910: 20, 911: 25 };
	const gain: Record<number, number> = { 1: 200, 2: 150, 3: 40, 4: 35 };
	const makeBridge = (anchorOverride: Partial<AllocatedFake> = {}) =>
		new FakeBridge(
			{ TotalDPS: 1000 },
			STATUS,
			[{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
			(allocSet, id, removeIds) => {
				const l = (removeIds ?? []).reduce((s, r) => s + (lost[r] ?? 0), 0);
				const g = [...allocSet, id].reduce((s, n) => s + (gain[n] ?? 0), 0);
				return { pointsSpent: 1, stats: { TotalDPS: 1000 - l + g } };
			},
			{
				allocated: [
					{ id: 900, cascade: [901, 902], removedStats: { TotalDPS: 700 }, ...anchorOverride },
					{ id: 901, removedStats: { TotalDPS: 700 } },
					{ id: 902, removedStats: { TotalDPS: 700 } },
					{ id: 910, removedStats: { TotalDPS: 980 } },
					{ id: 911, removedStats: { TotalDPS: 975 } },
				],
				statsFromFn: (_a, removeIds) => ({
					TotalDPS: 1000 - removeIds.reduce((s, r) => s + (lost[r] ?? 0), 0),
				}),
			},
		);

	it("force-frees the anchor's whole cascade and re-spends it (repair mode, no respec budget)", async () => {
		const result = await optimiseTree(makeBridge(), { anchorNodeId: 900 });

		expect(result.mode).toBe("repair");
		expect(result.anchorNodeId).toBe(900);
		// One synthetic removal entry standing for the whole cascade.
		expect(result.removed.map((r) => r.id)).toEqual([900]);
		expect(result.removed[0].anchorCascade).toBe(true);
		expect(result.removed[0].pointsFreed).toBe(3);
		expect(result.removed[0].valueLost).toBe(300);
		// 3 points re-spent into 1/2/3.
		expect(result.steps.map((s) => s.id)).toEqual([1, 2, 3]);
		expect(result.pointsFreed).toBe(3);
		expect(result.pointsRespent).toBe(3);
		expect(result.final.pointsSpent).toBe(0);
		expect(result.final.objective).toBeCloseTo(1000 - 300 + (200 + 150 + 40)); // 1090
	});

	it("composes with respecBudget: also frees the lowest-value survivors on top of the cascade", async () => {
		const result = await optimiseTree(makeBridge(), { anchorNodeId: 900, respecBudget: 1 });

		// k-sweep: k=1 (anchor only) re-spends 3 -> 1090; k=2 (anchor + survivor 910) re-spends 4
		// into 1/2/3/4 -> 1000 - 320 + 425 = 1105, the winner.
		expect(result.removed.map((r) => r.id)).toEqual([900, 910]);
		expect(result.removed[0].anchorCascade).toBe(true);
		expect(result.removed[1].anchorCascade).toBeFalsy();
		expect(result.pointsFreed).toBe(4);
		expect(result.steps.map((s) => s.id)).toEqual([1, 2, 3, 4]);
		expect(result.final.objective).toBeCloseTo(1105);
		expect(result.final.pointsSpent).toBe(0);
	});

	it("rejects an anchor whose cascade would leave too little tree to re-plan from", async () => {
		// pointsUsed 50, cascade 48 -> only 2 points survive (< MIN_ANCHOR_SPINE_POINTS).
		await expect(
			optimiseTree(makeBridge({ pointsFreed: 48, cascade: undefined }), { anchorNodeId: 900 }),
		).rejects.toThrow(/too little tree|from-scratch/);
	});

	it("rejects an ascendancy anchor", async () => {
		await expect(
			optimiseTree(makeBridge({ ascendancyName: "Deadeye", cascade: undefined }), { anchorNodeId: 900 }),
		).rejects.toThrow(/ascendancy/);
	});

	it("rejects an anchor that is not an allocated regular node", async () => {
		await expect(optimiseTree(makeBridge(), { anchorNodeId: 424242 })).rejects.toThrow(/not an allocated/);
	});

	it("rejects a node listed in both freeze and anchorNodeId", async () => {
		await expect(optimiseTree(makeBridge(), { anchorNodeId: 900, freeze: [900] })).rejects.toThrow(
			/both freeze and anchorNodeId/,
		);
	});
});

describe("optimiseTree (beam width)", () => {
	// Node 1 is +100 for 1 pt (delta-per-point 100). Node 2 is +190 for 2 pts (delta-per-point 95).
	// Nodes 3/4 are +10 fillers, 1 pt each. Budget = 2 points. A width-1 greedy walk takes node 1
	// (best dpp), then can only afford a +10 filler -> 1110. A width-2 beam keeps the 2-point node 2
	// alive and returns it outright -> 1190.
	const contrib: Record<number, number> = { 1: 100, 2: 190, 3: 10, 4: 10 };
	const makeBeamBridge = () =>
		new FakeBridge(
			{ TotalDPS: 1000 },
			STATUS,
			[{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
			(allocSet, id) => ({
				pointsSpent: id === 2 ? 2 : 1,
				stats: { TotalDPS: 1000 + [...allocSet, id].reduce((s, n) => s + (contrib[n] ?? 0), 0) },
			}),
		);

	it("width 1 reproduces the greedy walk (best delta-per-point, then a filler)", async () => {
		const result = await optimiseTree(makeBeamBridge(), { pointBudget: STATUS.pointsUsed + 2 });
		expect(result.steps.map((s) => s.id)).toEqual([1, 3]);
		expect(result.final.objective).toBeCloseTo(1110);
		expect(result.beamWidth).toBeUndefined(); // only echoed when > 1
	});

	it("a wider beam keeps a 2-point move alive that the greedy walk could not afford", async () => {
		const result = await optimiseTree(makeBeamBridge(), { pointBudget: STATUS.pointsUsed + 2, beamWidth: 2 });
		expect(result.steps.map((s) => s.id)).toEqual([2]);
		expect(result.final.objective).toBeCloseTo(1190);
		expect(result.final.pointsSpent).toBe(2);
		expect(result.beamWidth).toBe(2);
	});

	it("is deterministic: same inputs, identical plan across runs", async () => {
		const a = await optimiseTree(makeBeamBridge(), { pointBudget: STATUS.pointsUsed + 2, beamWidth: 3 });
		const b = await optimiseTree(makeBeamBridge(), { pointBudget: STATUS.pointsUsed + 2, beamWidth: 3 });
		expect(a.steps.map((s) => s.id)).toEqual(b.steps.map((s) => s.id));
		expect(a.final.objective).toBe(b.final.objective);
	});

	it("beamDepth caps the number of steps below the point budget", async () => {
		const increments: Record<number, number> = { 1: 300, 2: 100, 3: 50 };
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [{ id: 1 }, { id: 2 }, { id: 3 }], (allocSet, id) => ({
			pointsSpent: 1,
			stats: { TotalDPS: 1000 + [...allocSet, id].reduce((s, n) => s + (increments[n] ?? 0), 0) },
		}));

		// Budget is 3 points; without the depth cap the greedy walk would allocate 1, 2, 3.
		const result = await optimiseTree(bridge, { pointBudget: STATUS.pointsUsed + 3, beamDepth: 2 });

		expect(result.steps.map((s) => s.id)).toEqual([1, 2]);
		expect(result.final.objective).toBeCloseTo(1400);
	});
});
