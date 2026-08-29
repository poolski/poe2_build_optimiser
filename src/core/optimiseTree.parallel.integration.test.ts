// Phase 1.5 acceptance gate: optimiseTree(bridge, options) must be byte-identical whether `bridge`
// is a single PobBridge or a ParallelBridge over N leased pool slots -- N changes wall time only,
// never the plan (docs/web-ui/01-bridge-service.md "Phase 1.5", requirement 1 in the task brief).
//
// Self-contained (no external PoB Builds-dir fixture): uses the same minimal bare-Ranger XML
// bridge.integration.test.ts / pool.integration.test.ts already use, with includeAllNodeTypes so
// the candidate pool near a level-1 class start is large enough to actually exercise sharding
// across 3 slots (Notable/Keystone alone are sparse that close to the frontier).
//
// Needs luajit + the pob-runtime submodule; runs via `npm run test:integration` only. NOT executed
// by the agent that wrote this file -- see the phase-1.5 report for the exact command.

import { afterEach, describe, expect, it } from "vitest";
import { ParallelBridge, PobBridge, PobBridgePool } from "@poe2/pob-bridge";
import { optimiseTree, OptimiseTreeResult } from "./optimiseTree";

const MINIMAL_BUILD = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="1" className="Ranger" ascendClassName="None" mainSocketGroup="1"/>
  <Skills/>
  <Tree activeSpec="1"><Spec treeVersion="0_2" classId="1" ascendClassId="0" nodes=""/></Tree>
  <Items/>
  <Config/>
</PathOfBuilding2>`;

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanups.splice(0)) {
		try {
			await fn();
		} catch {
			/* best effort */
		}
	}
});

// Fields that legitimately differ across separate LuaJIT children: cumulative os.clock() timing.
// buildOutputCount (a count of recomputes) must still match exactly -- that's the aggregation
// this test is really here to prove (requirement 6 in the task brief).
function stripTiming(result: OptimiseTreeResult): Omit<OptimiseTreeResult, "buildOutputSeconds"> {
	const { buildOutputSeconds: _drop, ...rest } = result;
	return rest;
}

describe("optimiseTree with a ParallelBridge (real luajit)", () => {
	it(
		"is byte-identical to the serial single-bridge path, and buildOutputCount is the SUM across slots",
		async () => {
			const options = { pointBudget: 8, includeAllNodeTypes: true, proximity: 4 } as const;

			const solo = new PobBridge();
			cleanups.push(() => solo.dispose());
			await solo.call("load_build_xml", { xml: MINIMAL_BUILD, name: "parallel-determinism" });
			await solo.call("reset_metrics");
			const serial = await optimiseTree(solo, options);

			// Sanity: this run must actually have candidates to shard, or the test proves nothing.
			expect(serial.steps.length).toBeGreaterThan(0);

			const pool = new PobBridgePool({ size: 3 });
			cleanups.push(() => pool.dispose());
			const lease = await pool.lease(3);
			cleanups.push(() => lease.release());
			const parallelBridge = new ParallelBridge(lease.slots);
			await parallelBridge.call("load_build_xml", { xml: MINIMAL_BUILD, name: "parallel-determinism" });
			await parallelBridge.call("reset_metrics");
			const parallel = await optimiseTree(parallelBridge, options);

			expect(stripTiming(parallel)).toEqual(stripTiming(serial));
			// Not just equal counts by coincidence -- explicitly the aggregation claim: summing each
			// slot's own get_metrics matches what the ParallelBridge reported to optimiseTree.
			const perSlot = await Promise.all(lease.slots.map((s) => s.call<{ buildOutputCount: number }>("get_metrics")));
			const summed = perSlot.reduce((s, m) => s + m.buildOutputCount, 0);
			expect(parallel.buildOutputCount).toBe(summed);
			expect(parallel.buildOutputCount).toBe(serial.buildOutputCount);
		},
		300_000,
	);
});
