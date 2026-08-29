// Fast unit tests against fake slots (no LuaJIT) -- proves ParallelBridge's routing/sharding/
// aggregation contract before ever touching a real bridge. See docs/web-ui/01-bridge-service.md
// "Phase 1.5" for the design this implements.

import { describe, expect, it, vi } from "vitest";
import type { PooledBridge } from "./pool";
import { ParallelBridge } from "./parallel";

interface FakeCall {
	slot: number;
	method: string;
	params?: Record<string, unknown>;
}

/** A fake PooledBridge whose evaluate_candidate_nodes[_from] handler resolves after `delayMs`
 *  (default 0), so a test can force shards to settle in a chosen, possibly reversed, order. */
function fakeSlot(
	index: number,
	log: FakeCall[],
	opts: {
		delayForNodeIds?: (nodeIds: number[]) => number;
		failOn?: (method: string, params?: Record<string, unknown>) => boolean;
	} = {},
): PooledBridge {
	const callImpl = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
		log.push({ slot: index, method, params });
		if (opts.failOn?.(method, params)) {
			throw new Error(`bridge process exited (code 1) before responding [slot ${index}]`);
		}
		if (method === "evaluate_candidate_nodes_from" || method === "evaluate_candidate_nodes") {
			const nodeIds = (params?.nodeIds as number[]) ?? [];
			const delay = opts.delayForNodeIds?.(nodeIds) ?? 0;
			if (delay > 0) await new Promise((r) => setTimeout(r, delay));
			// Deterministic fake "evaluation": pointsSpent = nodeId % 3, stats keyed by id.
			return {
				results: nodeIds.map((id) => ({
					nodeId: id,
					pointsSpent: (id % 3) + 1,
					ascendancyPointsSpent: 0,
					stats: { TotalDPS: id * 10 },
				})),
			};
		}
		if (method === "get_metrics") {
			return { buildOutputCount: 5 + index, buildOutputSeconds: 1.5 + index };
		}
		if (method === "load_build_xml") {
			return { ok: true, className: "Fake", level: 90 };
		}
		if (method === "reset_metrics") {
			return { ok: true };
		}
		if (method === "get_stats") {
			return { TotalDPS: 42, slot: index };
		}
		throw new Error(`fakeSlot: unhandled method "${method}"`);
	};
	return {
		call: vi.fn(callImpl) as unknown as PooledBridge["call"],
		release: vi.fn(),
	};
}

describe("ParallelBridge", () => {
	it("shards evaluate_candidate_nodes_from and recombines byte-identical to a single-slot call", async () => {
		const nodeIds = [101, 205, 303, 404, 517, 618, 729];

		const singleLog: FakeCall[] = [];
		const single = new ParallelBridge([fakeSlot(0, singleLog)]);
		const singleResult = await single.call<{ results: { nodeId: number }[] }>("evaluate_candidate_nodes_from", {
			allocSet: [1, 2],
			nodeIds,
		});

		const shardedLog: FakeCall[] = [];
		const slots = [fakeSlot(0, shardedLog), fakeSlot(1, shardedLog), fakeSlot(2, shardedLog)];
		const sharded = new ParallelBridge(slots);
		const shardedResult = await sharded.call<{ results: { nodeId: number }[] }>("evaluate_candidate_nodes_from", {
			allocSet: [1, 2],
			nodeIds,
		});

		expect(shardedResult).toEqual(singleResult);
		expect(shardedResult.results.map((r) => r.nodeId)).toEqual(nodeIds); // caller order preserved
		// Actually used more than one slot -- otherwise this test wouldn't be testing sharding.
		const usedSlots = new Set(shardedLog.filter((c) => c.method === "evaluate_candidate_nodes_from").map((c) => c.slot));
		expect(usedSlots.size).toBeGreaterThan(1);
	});

	it("result order is independent of shard completion order", async () => {
		const nodeIds = [10, 20, 30, 40, 50, 60];
		// Slot 0 (first chunk) resolves LAST; slot 2 (last chunk) resolves FIRST.
		const slots = [
			fakeSlot(0, [], { delayForNodeIds: () => 30 }),
			fakeSlot(1, [], { delayForNodeIds: () => 15 }),
			fakeSlot(2, [], { delayForNodeIds: () => 0 }),
		];
		const bridge = new ParallelBridge(slots);
		const result = await bridge.call<{ results: { nodeId: number }[] }>("evaluate_candidate_nodes_from", {
			allocSet: [],
			nodeIds,
		});
		// Recombined by chunk index, not arrival order -- must still match the original nodeIds order.
		expect(result.results.map((r) => r.nodeId)).toEqual(nodeIds);
	});

	it("sums buildOutputCount / buildOutputSeconds across every leased slot", async () => {
		const slots = [fakeSlot(0, []), fakeSlot(1, []), fakeSlot(2, [])];
		const bridge = new ParallelBridge(slots);
		const metrics = await bridge.call<{ buildOutputCount: number; buildOutputSeconds: number }>("get_metrics");
		// fakeSlot returns buildOutputCount 5+index, buildOutputSeconds 1.5+index for index 0,1,2.
		expect(metrics.buildOutputCount).toBe(5 + 6 + 7);
		expect(metrics.buildOutputSeconds).toBeCloseTo(1.5 + 2.5 + 3.5);
	});

	it("a dying shard fails the whole call rather than dropping its candidates", async () => {
		const nodeIds = [1, 2, 3, 4, 5, 6];
		const slots = [
			fakeSlot(0, []),
			fakeSlot(1, [], { failOn: (m) => m === "evaluate_candidate_nodes_from" }),
			fakeSlot(2, []),
		];
		const bridge = new ParallelBridge(slots);
		await expect(
			bridge.call("evaluate_candidate_nodes_from", { allocSet: [], nodeIds }),
		).rejects.toThrow(/bridge process exited.*before responding/i);
	});

	it("broadcasts load_build_xml and reset_metrics to every slot", async () => {
		const log: FakeCall[] = [];
		const slots = [fakeSlot(0, log), fakeSlot(1, log), fakeSlot(2, log)];
		const bridge = new ParallelBridge(slots);

		await bridge.call("load_build_xml", { xml: "<xml/>" });
		expect(log.filter((c) => c.method === "load_build_xml").map((c) => c.slot).sort()).toEqual([0, 1, 2]);

		log.length = 0;
		await bridge.call("reset_metrics");
		expect(log.filter((c) => c.method === "reset_metrics").map((c) => c.slot).sort()).toEqual([0, 1, 2]);
	});

	it("routes single-round-trip / stateful methods to the primary slot only", async () => {
		const log: FakeCall[] = [];
		const slots = [fakeSlot(0, log), fakeSlot(1, log), fakeSlot(2, log)];
		const bridge = new ParallelBridge(slots);

		const stats = await bridge.call<{ slot: number }>("get_stats");
		expect(stats.slot).toBe(0);
		expect(log.filter((c) => c.method === "get_stats").map((c) => c.slot)).toEqual([0]);
	});

	it("does not shard a batch of 1 or fewer candidates (not worth splitting)", async () => {
		const log: FakeCall[] = [];
		const slots = [fakeSlot(0, log), fakeSlot(1, log)];
		const bridge = new ParallelBridge(slots);

		await bridge.call("evaluate_candidate_nodes_from", { allocSet: [], nodeIds: [42] });
		expect(log.map((c) => c.slot)).toEqual([0]);
	});

	it("throws when constructed with zero slots", () => {
		expect(() => new ParallelBridge([])).toThrow(/at least one slot/);
	});
});
