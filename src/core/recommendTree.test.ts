import { describe, expect, it } from "vitest";
import { PobBridgeClient } from "./bridge";
import { AllocatableNode, recommendTree, TreeStatus } from "./recommendTree";

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
});
