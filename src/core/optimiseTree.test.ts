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
) => { pointsSpent: number; ascendancyPointsSpent?: number; stats: Record<string, unknown> };

class FakeBridge implements PobBridgeClient {
	calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
	buildOutputCount = 0;

	constructor(
		private baseStats: Record<string, unknown>,
		private status: TreeStatus,
		private nodes: FakeNode[],
		private evalFn: EvalFn,
	) {}

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
			const nodeIds = params!.nodeIds as number[];
			this.buildOutputCount += nodeIds.length;
			return {
				results: nodeIds.map((id) => {
					const r = this.evalFn(allocSet, id);
					return {
						nodeId: id,
						pointsSpent: r.pointsSpent,
						ascendancyPointsSpent: r.ascendancyPointsSpent ?? 0,
						stats: r.stats,
					};
				}),
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

	it("throws for repair mode (respecBudget > 0)", async () => {
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [{ id: 1 }], () => ({ pointsSpent: 1, stats: {} }));
		await expect(optimiseTree(bridge, { respecBudget: 3 })).rejects.toThrow(/repair mode/);
	});

	it("throws when the objective cannot score the baseline", async () => {
		const bridge = new FakeBridge({}, STATUS, [{ id: 1 }], () => ({ pointsSpent: 1, stats: {} }));
		await expect(optimiseTree(bridge, { targetMetric: "TotalDPS", pointBudget: STATUS.pointsUsed + 1 })).rejects.toThrow(
			/baseline/,
		);
	});
});
