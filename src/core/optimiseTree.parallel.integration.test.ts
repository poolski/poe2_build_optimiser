// Phase 1.5 acceptance gate: optimiseTree(bridge, options) must produce the SAME PLAN whether
// `bridge` is a single PobBridge or a ParallelBridge over N leased pool slots -- N changes wall
// time only, never the plan (intake/web-ui/01-bridge-service.md "Phase 1.5", requirement 1 in the
// task brief).
//
// buildOutputCount is the one field that is NOT expected to match exactly, and it isn't a bug:
// evaluateCandidatesAgainst in bridge.lua (packages/pob-bridge/pob-runtime/bridge.lua, tail of the
// function) does ONE extra recomputeBuild() per evaluate_candidate_nodes_from CALL whenever that
// call's allocSet or removeIds is non-empty -- it resyncs mainOutput after the outer
// CreateUndoState/RestoreUndoState so the *next* call's snapshot is clean (see docs/gotchas.md).
// That tail recompute never touches a candidate's own measured stats (those come from the
// per-candidate AllocNode + recomputeBuild() inside the loop, before the tail runs), so the PLAN
// stays byte-identical -- but sharding turns one call into up to N calls, so it also turns one
// tail recompute into up to N. Confirmed empirically 2026-08-29 on this exact fixture: serial 139,
// parallel (N=3) 145, excess 6 = (N-1) x 3 non-empty-allocSet calls (extend mode, beamWidth 1: the
// add-loop's first expandState call has allocSet=[] -- no tail recompute possible there regardless
// of N -- and one non-empty-allocSet call per step after that, so steps.length - 1 such calls).
//
// Self-contained (no external PoB Builds-dir fixture): uses the same minimal bare-Ranger XML
// bridge.integration.test.ts / pool.integration.test.ts already use, with includeAllNodeTypes so
// the candidate pool near a level-1 class start is large enough to actually exercise sharding
// across 3 slots (Notable/Keystone alone are sparse that close to the frontier).
//
// Needs luajit + the pob-runtime submodule; runs via `npm run test:integration` only.

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

const PARALLELISM = 3;

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

// Fields that legitimately differ between the serial and parallel path:
//  - buildOutputSeconds: cumulative os.clock() summed across N *concurrently running* children is
//    total CPU-seconds, not elapsed wall/simulation time -- see the aggregation-site comment in
//    parallel.ts. Not comparable to the serial (single-child) figure at all.
//  - buildOutputCount: NOT dropped here -- see the file header. Checked separately below against
//    the derived tail-recompute overhead instead of exact equality, because exact equality is the
//    wrong claim (that was this test's original bug).
function stripNonComparable(result: OptimiseTreeResult): Omit<OptimiseTreeResult, "buildOutputSeconds" | "buildOutputCount"> {
	const { buildOutputSeconds: _drop1, buildOutputCount: _drop2, ...rest } = result;
	return rest;
}

describe("optimiseTree with a ParallelBridge (real luajit)", () => {
	it(
		"produces the same plan as the serial path; buildOutputCount is serial + the exact predicted shard overhead",
		async () => {
			const options = { pointBudget: 8, includeAllNodeTypes: true, proximity: 4 } as const;

			const solo = new PobBridge();
			cleanups.push(() => solo.dispose());
			await solo.call("load_build_xml", { xml: MINIMAL_BUILD, name: "parallel-determinism" });
			await solo.call("reset_metrics");
			const serial = await optimiseTree(solo, options);

			// Sanity: this run must actually have candidates to shard, or the test proves nothing.
			expect(serial.steps.length).toBeGreaterThan(0);

			const pool = new PobBridgePool({ size: PARALLELISM });
			cleanups.push(() => pool.dispose());
			const lease = await pool.lease(PARALLELISM);
			cleanups.push(() => lease.release());
			const parallelBridge = new ParallelBridge(lease.slots);
			await parallelBridge.call("load_build_xml", { xml: MINIMAL_BUILD, name: "parallel-determinism" });
			await parallelBridge.call("reset_metrics");
			const parallel = await optimiseTree(parallelBridge, options);

			// The PLAN (everything except the two per-child timing/count fields) is byte-identical.
			expect(stripNonComparable(parallel)).toEqual(stripNonComparable(serial));

			// buildOutputCount: derive the predicted tail-recompute overhead from the result itself
			// (no hardcoded magic number). Extend mode, beamWidth 1 (both true of `options` above):
			// the add-loop's depth-0 expandState call always has allocSet=[] (the initial BeamState),
			// so it can never trigger evaluateCandidatesAgainst's tail recompute regardless of N; every
			// subsequent depth's call has a non-empty allocSet (the prior picks), so
			// `steps.length - 1` calls are eligible. This also assumes every eligible call actually
			// sharded into all `PARALLELISM` slots rather than fewer -- true whenever that depth's
			// cache-miss candidate batch has at least `PARALLELISM` entries, which a cacheHitRate of 0
			// (asserted below) makes highly likely for this fixture (batches come straight off
			// list_allocatable_nodes_from, never trimmed by a cache hit).
			expect(parallel.cacheHitRate).toBe(0);
			const nonEmptyAllocSetCalls = Math.max(0, parallel.steps.length - 1);
			const expectedOverhead = (PARALLELISM - 1) * nonEmptyAllocSetCalls;
			expect(parallel.buildOutputCount).toBe((serial.buildOutputCount ?? 0) + expectedOverhead);

			// Aggregation claim, independent of the overhead accounting above: summing each slot's own
			// get_metrics matches what the ParallelBridge reported to optimiseTree.
			const perSlot = await Promise.all(lease.slots.map((s) => s.call<{ buildOutputCount: number }>("get_metrics")));
			const summed = perSlot.reduce((s, m) => s + m.buildOutputCount, 0);
			expect(parallel.buildOutputCount).toBe(summed);
		},
		300_000,
	);
});
