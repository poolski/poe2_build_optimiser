import { describe, expect, it } from "vitest";
import { PobBridgeClient } from "./bridge";
import { AllocatableNode, filterByProximity, recommendTree, TreeStatus } from "./recommendTree";

// A minimal fake bridge: no real LuaJIT process, just canned responses per RPC method,
// good enough to exercise recommendTree's batching/filtering/ranking logic in isolation.
class FakeBridge implements PobBridgeClient {
	calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

	constructor(
		private stats: Record<string, unknown>,
		private status: TreeStatus,
		private nodes: AllocatableNode[],
		private evaluate: (nodeIds: number[]) => { results: unknown[] },
	) {}

	async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
		this.calls.push({ method, params });
		if (method === "get_stats") return this.stats as T;
		if (method === "get_tree_status") return this.status as T;
		if (method === "list_allocatable_nodes") return { nodes: this.nodes } as T;
		if (method === "evaluate_candidate_nodes") {
			return this.evaluate(params!.nodeIds as number[]) as T;
		}
		throw new Error(`FakeBridge: unhandled method ${method}`);
	}
}

const STATUS: TreeStatus = {
	pointsUsed: 90,
	pointsMax: 99,
	ascendancyPointsUsed: 4,
	ascendancyPointsMax: 8,
	secondaryAscendancyPointsUsed: 0,
	secondaryAscendancyPointsMax: 8,
};

function node(id: number, name: string, type = "Notable", statLines?: string[]): AllocatableNode {
	return { id, name, type, statLines: statLines ?? [`stat line for ${name}`] };
}

// Default-response evaluate: pointsSpent=1, TotalDPS unchanged from baseline unless overridden --
// good enough for tests that only care about which candidates got sent, not their ranking.
function passthroughEvaluate(nodeIds: number[]) {
	return { results: nodeIds.map((id) => ({ nodeId: id, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 0 } })) };
}

describe("recommendTree", () => {
	it("ranks candidates by delta per point, best first", async () => {
		const nodes = [node(1, "Big Notable"), node(2, "Small Notable"), node(3, "Expensive Notable")];
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => {
				if (id === 1) return { nodeId: 1, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1100 } }; // +100/pt
				if (id === 2) return { nodeId: 2, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1050 } }; // +50/pt
				return { nodeId: 3, pointsSpent: 4, ascendancyPointsSpent: 0, stats: { TotalDPS: 1200 } }; // +50/pt (200/4)
			}),
		}));

		const result = await recommendTree(bridge, { top: 10 });

		expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
		expect(result[0].delta).toBeCloseTo(100);
		expect(result[0].deltaPerPoint).toBeCloseTo(100);
	});

	it("breaks deltaPerPoint ties by node id, regardless of the pool's arrival order", async () => {
		// Same deltaPerPoint for all three; ids arrive shuffled (as Lua pairs() might hand them over).
		const nodes = [node(30, "C"), node(10, "A"), node(20, "B")];
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({ nodeId: id, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1100 } })),
		}));

		const result = await recommendTree(bridge, { top: 10 });

		expect(result.map((r) => r.id)).toEqual([10, 20, 30]);
	});

	it("excludes candidates that cost more points than are available", async () => {
		const nodes = [node(1, "Affordable"), node(2, "Too Expensive")];
		const status: TreeStatus = { ...STATUS, pointsUsed: 97, pointsMax: 99 }; // 2 points left
		const bridge = new FakeBridge({ TotalDPS: 1000 }, status, nodes, (nodeIds) => ({
			results: nodeIds.map((id) =>
				id === 1
					? { nodeId: 1, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1010 } }
					: { nodeId: 2, pointsSpent: 3, ascendancyPointsSpent: 0, stats: { TotalDPS: 5000 } },
			),
		}));

		const result = await recommendTree(bridge, { top: 10 });

		expect(result.map((r) => r.id)).toEqual([1]);
	});

	it("excludes candidates that cost more ascendancy points than are available", async () => {
		const nodes = [node(1, "Ascendancy Notable")];
		const status: TreeStatus = { ...STATUS, ascendancyPointsUsed: 8, ascendancyPointsMax: 8 };
		const bridge = new FakeBridge({ TotalDPS: 1000 }, status, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({ nodeId: id, pointsSpent: 0, ascendancyPointsSpent: 1, stats: { TotalDPS: 2000 } })),
		}));

		const result = await recommendTree(bridge, { top: 10 });

		expect(result).toEqual([]);
	});

	it("respects the top option", async () => {
		const nodes = [node(1, "A"), node(2, "B"), node(3, "C")];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({ nodeId: id, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: id } })),
		}));

		const result = await recommendTree(bridge, { top: 2 });

		expect(result).toHaveLength(2);
	});

	it("batches evaluate_candidate_nodes calls according to batchSize", async () => {
		const nodes = [node(1, "A"), node(2, "B"), node(3, "C")];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({ nodeId: id, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: id } })),
		}));

		await recommendTree(bridge, { batchSize: 2 });

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		expect(evalCalls).toHaveLength(2);
		expect(evalCalls[0].params!.nodeIds).toEqual([1, 2]);
		expect(evalCalls[1].params!.nodeIds).toEqual([3]);
	});

	it("ranks on the given targetMetric instead of the TotalDPS default", async () => {
		const nodes = [node(1, "Life Notable")];
		const bridge = new FakeBridge({ TotalDPS: 1000, Life: 500 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({
				nodeId: id,
				pointsSpent: 1,
				ascendancyPointsSpent: 0,
				stats: { TotalDPS: 1000, Life: 600 },
			})),
		}));

		const result = await recommendTree(bridge, { targetMetric: "Life" });

		expect(result[0].delta).toBeCloseTo(100);
	});

	it("defaults to Notable/Keystone candidates only, excluding other node types", async () => {
		const nodes = [node(1, "Notable Node", "Notable"), node(2, "Keystone Node", "Keystone"), node(3, "Small Node", "Normal")];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, {});

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]);
		expect(evaluatedIds.sort()).toEqual([1, 2]);
	});

	it("evaluates every node type when includeAllNodeTypes is set", async () => {
		const nodes = [node(1, "Notable Node", "Notable"), node(2, "Small Node", "Normal")];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, { includeAllNodeTypes: true });

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]);
		expect(evaluatedIds.sort()).toEqual([1, 2]);
	});

	it("respects an explicit nodeTypes list", async () => {
		const nodes = [node(1, "Notable Node", "Notable"), node(2, "Keystone Node", "Keystone")];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, { nodeTypes: ["Keystone"] });

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]);
		expect(evaluatedIds).toEqual([2]);
	});

	it("prioritizes damageType matches (including the Elemental synonym) ahead of maxCandidates truncation", async () => {
		const nodes = [
			node(1, "Physical Notable", "Notable", ["12% increased Physical Damage"]),
			node(2, "Lightning Notable", "Notable", ["12% increased Lightning Damage"]),
			node(3, "Elemental Notable", "Notable", ["12% increased Elemental Damage"]),
			node(4, "Another Physical Notable", "Notable", ["8% increased Physical Damage"]),
		];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, { damageType: "Lightning", maxCandidates: 2 });

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]).sort();
		expect(evaluatedIds).toEqual([2, 3]);
	});

	it("drops a candidate that pushes a constrained metric below its floor", async () => {
		const nodes = [node(1, "Safe DPS"), node(2, "Res-Wrecking DPS")];
		const bridge = new FakeBridge({ TotalDPS: 1000, FireResist: 76 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) =>
				id === 1
					? { nodeId: 1, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1100, FireResist: 76 } }
					: { nodeId: 2, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 5000, FireResist: 60 } },
			),
		}));

		const result = await recommendTree(bridge, { constraints: { FireResist: 75 } });

		expect(result.map((r) => r.id)).toEqual([1]);
	});

	it("keeps a candidate that holds a constrained metric at or above its floor", async () => {
		const nodes = [node(1, "Overcapped DPS")];
		const bridge = new FakeBridge({ TotalDPS: 1000, FireResist: 90 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({ nodeId: id, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 2000, FireResist: 78 } })),
		}));

		const result = await recommendTree(bridge, { constraints: { FireResist: 75 } });

		expect(result.map((r) => r.id)).toEqual([1]);
		expect(result[0].constraintViolation).toBeUndefined();
	});

	it("with an already-sub-floor metric, drops only candidates that worsen it", async () => {
		const nodes = [node(1, "Nudges Res Up"), node(2, "Neutral"), node(3, "Drops Res Further")];
		const bridge = new FakeBridge({ TotalDPS: 1000, FireResist: 40 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => {
				if (id === 1) return { nodeId: 1, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1100, FireResist: 45 } };
				if (id === 2) return { nodeId: 2, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1100, FireResist: 40 } };
				return { nodeId: 3, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 9000, FireResist: 30 } };
			}),
		}));

		const result = await recommendTree(bridge, { constraints: { FireResist: 75 } });

		expect(result.map((r) => r.id).sort()).toEqual([1, 2]);
	});

	it("preserveMetrics derives a floor from the baseline value (no regression allowed)", async () => {
		const nodes = [node(1, "EHP-Neutral"), node(2, "EHP-Negative")];
		const bridge = new FakeBridge({ TotalDPS: 1000, TotalEHP: 500000 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) =>
				id === 1
					? { nodeId: 1, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1100, TotalEHP: 500000 } }
					: { nodeId: 2, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 9000, TotalEHP: 480000 } },
			),
		}));

		const result = await recommendTree(bridge, { preserveMetrics: ["TotalEHP"] });

		expect(result.map((r) => r.id)).toEqual([1]);
	});

	it("lets an explicit constraints floor override the preserveMetrics-derived one", async () => {
		const nodes = [node(1, "Small EHP Dip")];
		const bridge = new FakeBridge({ TotalDPS: 1000, TotalEHP: 500000 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({ nodeId: id, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 5000, TotalEHP: 490000 } })),
		}));

		// preserveMetrics alone would drop this (490k < 500k baseline); the explicit lower floor rescues it.
		const result = await recommendTree(bridge, {
			preserveMetrics: ["TotalEHP"],
			constraints: { TotalEHP: 450000 },
		});

		expect(result.map((r) => r.id)).toEqual([1]);
	});

	it("skips a constraint when the metric is absent from the measured stats (can't judge, don't drop)", async () => {
		const nodes = [node(1, "No Res In Output")];
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({ nodeId: id, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 2000 } })),
		}));

		const result = await recommendTree(bridge, { constraints: { FireResist: 75 } });

		expect(result.map((r) => r.id)).toEqual([1]);
	});

	it("keeps violating candidates, tagged, when keepViolating is set -- ranking still by delta/pt", async () => {
		const nodes = [node(1, "Safe"), node(2, "Violating But Huge")];
		const bridge = new FakeBridge({ TotalDPS: 1000, FireResist: 80 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) =>
				id === 1
					? { nodeId: 1, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1100, FireResist: 80 } }
					: { nodeId: 2, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 5000, FireResist: 50 } },
			),
		}));

		const result = await recommendTree(bridge, { constraints: { FireResist: 75 }, keepViolating: true });

		expect(result.map((r) => r.id)).toEqual([2, 1]);
		expect(result.find((r) => r.id === 2)!.constraintViolation).toEqual({
			metric: "FireResist",
			floor: 75,
			baseline: 80,
			candidate: 50,
		});
		expect(result.find((r) => r.id === 1)!.constraintViolation).toBeUndefined();
	});

	it("objective filter mode drops off-objective candidates before evaluation", async () => {
		const nodes = [
			node(1, "Phys Notable", "Notable", ["10% increased Physical Damage"]),
			node(2, "Minion Notable", "Notable", ["10% increased Minion Damage"]),
			node(3, "Life Notable", "Notable", ["8% increased maximum Life"]),
		];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, {
			objective: { mode: "filter", keywords: ["Physical", "Life"] },
		});

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]).sort();
		expect(evaluatedIds).toEqual([1, 3]);
	});

	it("objective exclude list drops a node that only matched a keyword incidentally", async () => {
		const nodes = [
			node(1, "Clean Phys", "Notable", ["10% increased Physical Damage"]),
			node(2, "Regen Phys", "Notable", ["10% increased Physical Damage", "20% increased Mana Regeneration Rate"]),
		];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, {
			objective: { mode: "filter", keywords: ["Physical"], exclude: ["Mana Regeneration"] },
		});

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]);
		expect(evaluatedIds).toEqual([1]);
	});

	it("objective prioritize mode reorders (not drops) ahead of a maxCandidates cut", async () => {
		const nodes = [
			node(1, "Off Objective", "Notable", ["10% increased Minion Damage"]),
			node(2, "On Objective", "Notable", ["10% increased Physical Damage"]),
		];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, {
			objective: { mode: "prioritize", keywords: ["Physical"] },
			maxCandidates: 1,
		});

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]);
		expect(evaluatedIds).toEqual([2]);
	});

	it("resolves the physical-defence objective preset", async () => {
		const nodes = [
			node(1, "Armour Notable", "Notable", ["12% increased Armour"]),
			node(2, "Curse Notable", "Notable", ["Curses on you expire 20% faster"]),
			node(3, "Cast Speed Notable", "Notable", ["15% increased Cast Speed"]),
			node(4, "Attack Notable", "Notable", ["12% increased Attack Damage"]),
		];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, { objective: "physical-defence" });

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]).sort();
		expect(evaluatedIds).toEqual([1, 4]);
	});

	it("throws on an unknown objective preset name", async () => {
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, [node(1, "A")], passthroughEvaluate);
		await expect(recommendTree(bridge, { objective: "no-such-preset" })).rejects.toThrow(/unknown objective preset/);
	});

	it("applies the objective filter before damageType prioritization", async () => {
		const nodes = [
			node(1, "Phys, off-type", "Notable", ["10% increased Physical Damage"]),
			node(2, "Minion, on-type", "Notable", ["10% increased Lightning Minion Damage"]),
			node(3, "Phys + Lightning", "Notable", ["10% increased Physical Damage", "10% increased Lightning Damage"]),
		];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		// Objective drops node 2 (Minion); damageType then sorts node 3 ahead of node 1.
		await recommendTree(bridge, {
			objective: { mode: "filter", keywords: ["Physical"], exclude: ["Minion"] },
			damageType: "Lightning",
		});

		const evalCalls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes");
		const evaluatedIds = evalCalls.flatMap((c) => c.params!.nodeIds as number[]);
		expect(evaluatedIds).toEqual([3, 1]);
	});

	it("tags damageTypeMatch on results, without changing the delta-per-point ranking", async () => {
		const nodes = [
			node(1, "Lightning Notable", "Notable", ["increased Lightning Damage"]),
			node(2, "Life Notable", "Notable", ["increased maximum Life"]),
		];
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) => ({
				nodeId: id,
				pointsSpent: 1,
				ascendancyPointsSpent: 0,
				// The non-matching "Life" node still measures a bigger real delta -- ranking must
				// reflect that, not the text match.
				stats: { TotalDPS: id === 1 ? 1050 : 1200 },
			})),
		}));

		const result = await recommendTree(bridge, { damageType: "Lightning" });

		expect(result.map((r) => r.id)).toEqual([2, 1]);
		expect(result.find((r) => r.id === 1)!.damageTypeMatch).toBe(true);
		expect(result.find((r) => r.id === 2)!.damageTypeMatch).toBe(false);
	});

	it("maxPathLength drops candidates whose pathLength exceeds the gate (keeping unknown ones)", async () => {
		const nodes: AllocatableNode[] = [
			{ id: 1, name: "Adjacent", type: "Notable", statLines: ["x"], pathLength: 1 },
			{ id: 2, name: "Distant", type: "Notable", statLines: ["x"], pathLength: 9 },
			{ id: 3, name: "Unknown", type: "Notable", statLines: ["x"] },
		];
		const bridge = new FakeBridge({ TotalDPS: 0 }, STATUS, nodes, passthroughEvaluate);

		await recommendTree(bridge, { maxPathLength: 3 });

		const evaluatedIds = bridge.calls
			.filter((c) => c.method === "evaluate_candidate_nodes")
			.flatMap((c) => c.params!.nodeIds as number[])
			.sort();
		expect(evaluatedIds).toEqual([1, 3]);
	});

	it("objectiveFn is ranked on instead of targetMetric", async () => {
		const nodes = [node(1, "Balanced"), node(2, "Glass Cannon")];
		const bridge = new FakeBridge({ TotalDPS: 1000, TotalEHP: 1000 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) =>
				id === 1
					? { nodeId: 1, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1200, TotalEHP: 1200 } }
					: { nodeId: 2, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 5000, TotalEHP: 200 } },
			),
		}));

		// Equal-weight log blend: node 1 (1200,1200) beats node 2 (5000,200) because ln(200) tanks it.
		const blend = (s: Record<string, unknown>) => {
			const a = s.TotalDPS as number;
			const b = s.TotalEHP as number;
			return 0.5 * Math.log(a) + 0.5 * Math.log(b);
		};
		const result = await recommendTree(bridge, { objectiveFn: blend });

		expect(result.map((r) => r.id)).toEqual([1, 2]);
	});

	it("objectiveFn drops a candidate it cannot score", async () => {
		const nodes = [node(1, "Scorable"), node(2, "Unscorable")];
		const bridge = new FakeBridge({ TotalDPS: 1000, TotalEHP: 1000 }, STATUS, nodes, (nodeIds) => ({
			results: nodeIds.map((id) =>
				id === 1
					? { nodeId: 1, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 1100, TotalEHP: 1100 } }
					: { nodeId: 2, pointsSpent: 1, ascendancyPointsSpent: 0, stats: { TotalDPS: 9000 } }, // no TotalEHP
			),
		}));

		const blend = (s: Record<string, unknown>) => {
			const a = s.TotalDPS;
			const b = s.TotalEHP;
			if (typeof a !== "number" || typeof b !== "number") return undefined;
			return 0.5 * Math.log(a) + 0.5 * Math.log(b);
		};
		const result = await recommendTree(bridge, { objectiveFn: blend });

		expect(result.map((r) => r.id)).toEqual([1]);
	});

	it("throws when objectiveFn cannot score the baseline", async () => {
		const bridge = new FakeBridge({ TotalDPS: 1000 }, STATUS, [node(1, "A")], passthroughEvaluate);
		await expect(recommendTree(bridge, { objectiveFn: () => undefined })).rejects.toThrow(/baseline/);
	});
});

describe("filterByProximity", () => {
	it("keeps nodes within k, drops those beyond, and keeps nodes with no pathLength", () => {
		const nodes = [
			{ id: 1, pathLength: 1 },
			{ id: 2, pathLength: 3 },
			{ id: 3, pathLength: 4 },
			{ id: 4 },
		];
		expect(filterByProximity(nodes, 3).map((n) => n.id)).toEqual([1, 2, 4]);
	});
});
