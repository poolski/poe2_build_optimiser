import { describe, expect, it } from "vitest";
import { PobBridgeClient } from "@poe2/pob-bridge";
import { MemoEvaluator } from "./evaluator";

// Fake bridge that records every call and answers the two "measure a partial allocation" RPCs
// with deterministic canned stats, so the tests can assert on how often the bridge was hit.
class CountingBridge implements PobBridgeClient {
	calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

	async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
		this.calls.push({ method, params });
		if (method === "evaluate_candidate_nodes_from") {
			const nodeIds = params!.nodeIds as number[];
			return {
				results: nodeIds.map((id) => ({
					nodeId: id,
					pointsSpent: 1,
					ascendancyPointsSpent: 0,
					stats: { TotalDPS: id * 10 },
				})),
			} as T;
		}
		if (method === "get_stats_from") {
			const allocSet = params!.allocSet as number[];
			return { pointsSpent: allocSet.length, ascendancyPointsSpent: 0, stats: { TotalDPS: allocSet.length } } as T;
		}
		throw new Error(`unexpected method ${method}`);
	}

	countOf(method: string): number {
		return this.calls.filter((c) => c.method === method).length;
	}
}

describe("MemoEvaluator.evaluateFrom", () => {
	it("does not re-hit the bridge for an already-measured (allocSet, nodeId)", async () => {
		const bridge = new CountingBridge();
		const evaluator = new MemoEvaluator(bridge);

		const first = await evaluator.evaluateFrom([5, 3], [1, 2]);
		const second = await evaluator.evaluateFrom([5, 3], [1, 2]);

		expect(first).toEqual(second);
		expect(bridge.countOf("evaluate_candidate_nodes_from")).toBe(1);
		expect(evaluator.hits).toBe(2);
		expect(evaluator.misses).toBe(2);
	});

	it("only sends the not-yet-cached nodeIds to the bridge", async () => {
		const bridge = new CountingBridge();
		const evaluator = new MemoEvaluator(bridge);

		await evaluator.evaluateFrom([1], [10, 11]);
		await evaluator.evaluateFrom([1], [11, 12, 13]);

		const secondCall = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes_from")[1];
		expect(secondCall.params!.nodeIds).toEqual([12, 13]);
	});

	it("treats allocSets that differ only in order as the same cache entry", async () => {
		const bridge = new CountingBridge();
		const evaluator = new MemoEvaluator(bridge);

		await evaluator.evaluateFrom([2, 7, 4], [99]);
		await evaluator.evaluateFrom([4, 2, 7], [99]);

		expect(bridge.countOf("evaluate_candidate_nodes_from")).toBe(1);
	});

	it("preserves nodeIds order in the returned results", async () => {
		const bridge = new CountingBridge();
		const evaluator = new MemoEvaluator(bridge);

		const result = await evaluator.evaluateFrom([1], [3, 1, 2]);
		expect(result.map((r) => r.nodeId)).toEqual([3, 1, 2]);
	});

	it("keys separately on removeIds -- same (allocSet, nodeId) against a different removal set re-hits", async () => {
		const bridge = new CountingBridge();
		const evaluator = new MemoEvaluator(bridge);

		await evaluator.evaluateFrom([5], [1], []);
		await evaluator.evaluateFrom([5], [1], [9]);
		await evaluator.evaluateFrom([5], [1], [9]); // cached
		await evaluator.evaluateFrom([5], [1], [9, 8]); // order-independent vs [8,9] below
		await evaluator.evaluateFrom([5], [1], [8, 9]); // cached

		expect(bridge.countOf("evaluate_candidate_nodes_from")).toBe(3);
	});

	it("forwards a sorted removeIds to the bridge, and omits it when empty", async () => {
		const bridge = new CountingBridge();
		const evaluator = new MemoEvaluator(bridge);

		await evaluator.evaluateFrom([5], [1], []);
		await evaluator.evaluateFrom([5], [2], [9, 3]);

		const calls = bridge.calls.filter((c) => c.method === "evaluate_candidate_nodes_from");
		expect("removeIds" in calls[0].params!).toBe(false);
		expect(calls[1].params!.removeIds).toEqual([3, 9]);
	});
});

describe("MemoEvaluator.statsFrom", () => {
	it("memoizes on the sorted allocSet", async () => {
		const bridge = new CountingBridge();
		const evaluator = new MemoEvaluator(bridge);

		const a = await evaluator.statsFrom([9, 1, 5]);
		const b = await evaluator.statsFrom([1, 5, 9]);

		expect(a).toEqual(b);
		expect(bridge.countOf("get_stats_from")).toBe(1);
		expect(evaluator.hitRate).toBeCloseTo(0.5);
	});

	it("keys separately on removeIds and forwards it sorted", async () => {
		const bridge = new CountingBridge();
		const evaluator = new MemoEvaluator(bridge);

		await evaluator.statsFrom([5], []);
		await evaluator.statsFrom([5], [7, 2]);
		await evaluator.statsFrom([5], [2, 7]); // cached

		expect(bridge.countOf("get_stats_from")).toBe(2);
		const calls = bridge.calls.filter((c) => c.method === "get_stats_from");
		expect("removeIds" in calls[0].params!).toBe(false);
		expect(calls[1].params!.removeIds).toEqual([2, 7]);
	});
});
