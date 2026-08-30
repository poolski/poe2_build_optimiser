// Fast unit test against a mocked PobBridge (no LuaJIT) -- proves PobBridgePool.acquireParallel
// actually threads its onShardProgress callback into the ParallelBridge it constructs. Everything
// else about pool lifecycle (spawn, lease contention, dispose) is covered by
// pool.integration.test.ts against a real child; this file mocks ./bridge specifically to reach
// the one line real-bridge tests can't isolate without booting LuaJIT.

import { describe, expect, it, vi } from "vitest";
import { PobBridgePool } from "./pool";
import type { ShardProgress } from "./parallel";

vi.mock("./bridge", () => {
	class FakePobBridge {
		call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
			if (method === "evaluate_candidate_nodes_from") {
				const nodeIds = (params?.nodeIds as number[]) ?? [];
				return { results: nodeIds.map((nodeId) => ({ nodeId })) };
			}
			return {};
		});
		dispose = vi.fn();
	}
	return { PobBridge: FakePobBridge };
});

describe("PobBridgePool.acquireParallel", () => {
	it("threads onShardProgress into the ParallelBridge it constructs", async () => {
		const pool = new PobBridgePool({ size: 2 });
		const updates: ShardProgress[] = [];

		const bridge = await pool.acquireParallel(2, (u) => updates.push(u));
		await bridge.call("evaluate_candidate_nodes_from", { allocSet: [], nodeIds: [1, 2, 3, 4] });
		bridge.release();
		await pool.dispose();

		// One dispatch (done: 0) + one settle (done === total) per shard, across 2 slots.
		expect(updates.length).toBe(4);
		expect(updates.some((u) => u.slot === 0)).toBe(true);
		expect(updates.some((u) => u.slot === 1)).toBe(true);
	});

	it("acquireParallel without a callback does not throw", async () => {
		const pool = new PobBridgePool({ size: 1 });
		const bridge = await pool.acquireParallel(1);
		const result = await bridge.call<{ results: unknown[] }>("evaluate_candidate_nodes_from", {
			allocSet: [],
			nodeIds: [1],
		});
		expect(result.results).toEqual([{ nodeId: 1 }]);
		bridge.release();
		await pool.dispose();
	});
});
