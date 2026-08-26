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

function node(id: number, name: string, type = "Notable"): AllocatableNode {
	return { id, name, type, statLines: [`stat line for ${name}`] };
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
});
