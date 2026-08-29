// Real-LuaJIT proof that optimiseTree.allocatedNodeIds.after is the CONNECTED post-plan
// allocation set -- the thing a correct <Spec nodes="..."> export needs, and the blocker that
// held up intake/web-ui/04 + 06 (see PLAN.md). Needs luajit + the pob-runtime submodule;
// runs via `npm run test:integration` only.
//
// The committed fixture packages/web/fixtures/canvas-diff.R_Thor-L84-weak.json captured this same
// run BEFORE the bridge could enumerate the connected set (it shipped `afterConnected: null`,
// `unloggedPathNodeCount: 1`). This test reproduces the run and checks the real `after` against
// the fixture's arithmetic. The reference build XML lives outside the repo (a PoB Builds dir); the
// test self-skips when it is absent.

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PobBridge } from "@poe2/pob-bridge";
import { loadBuildFromFile } from "./loadBuild";
import { optimiseTree } from "./optimiseTree";

const FIXTURE = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, "../../packages/web/fixtures/canvas-diff.R_Thor-L84-weak.json"), "utf-8"),
) as {
	meta: { buildPath: string };
	before: number[];
	afterPicksOnly: number[];
	unloggedPathNodeCount: number;
	removed: { id: number; pointsFreed: number }[];
	steps: { id: number; pointsSpent: number }[];
	result: { respecBudget: number; buildOutputCount: number; finalObjective: number; stoppedBecause: string };
};

interface AllocatedNode {
	id: number;
}

const buildXmlPath = FIXTURE.meta.buildPath;
const haveBuild = fs.existsSync(buildXmlPath);

let bridge: PobBridge | undefined;
afterEach(() => {
	bridge?.dispose();
	bridge = undefined;
});

const listIds = async (b: PobBridge, params?: Record<string, unknown>): Promise<number[]> => {
	const { nodes } = await b.call<{ nodes: AllocatedNode[] }>("list_allocated_nodes", params);
	return nodes.map((n) => n.id).sort((a, x) => a - x);
};

describe.skipIf(!haveBuild)("optimiseTree.allocatedNodeIds (real bridge, R_Thor repair)", () => {
	it(
		"reports a connected `after` set matching the fixture arithmetic",
		async () => {
			bridge = new PobBridge();
			await loadBuildFromFile(bridge, buildXmlPath);
			await bridge.call("reset_metrics");

			const beforeFresh = await listIds(bridge);
			expect(beforeFresh).toEqual(FIXTURE.before);

			const result = await optimiseTree(bridge, { respecBudget: FIXTURE.result.respecBudget });

			// The plan itself must be byte-identical to the pre-change fixture run (determinism).
			expect(result.mode).toBe("repair");
			expect(result.stoppedBecause).toBe(FIXTURE.result.stoppedBecause);
			expect(result.final.objective).toBeCloseTo(FIXTURE.result.finalObjective, 4);
			expect(result.buildOutputCount).toBe(FIXTURE.result.buildOutputCount); // no new BuildOutputs
			expect(result.removed.map((r) => r.id)).toEqual(FIXTURE.removed.map((r) => r.id));
			expect(result.steps.map((s) => s.id)).toEqual(FIXTURE.steps.map((s) => s.id));

			const { before, after } = result.allocatedNodeIds;
			expect(before).toEqual(FIXTURE.before);

			const pointsFreed = FIXTURE.removed.reduce((s, r) => s + r.pointsFreed, 0);
			const respent = result.steps.reduce((s, st) => s + st.pointsSpent, 0);

			// (e) size invariant: before - (cascade points freed) + sum(step.pointsSpent).
			expect(after.length).toBe(before.length - pointsFreed + respent);
			// (e) the previously-unlogged path nodes = sum(pointsSpent) - number of picks.
			expect(respent - result.steps.length).toBe(FIXTURE.unloggedPathNodeCount);

			// `after` contains every survivor + pick the picks-only set had, plus exactly the
			// unlogged traversal node(s).
			const picksOnly = new Set(FIXTURE.afterPicksOnly);
			for (const id of picksOnly) expect(after).toContain(id);
			const extra = after.filter((id) => !picksOnly.has(id));
			expect(extra.length).toBe(FIXTURE.unloggedPathNodeCount);

			// removed-and-not-re-picked nodes are gone; a node freed then re-picked is present.
			const readdedIds = new Set(result.steps.map((s) => s.id));
			for (const r of result.removed) {
				if (readdedIds.has(r.id)) expect(after).toContain(r.id);
				else expect(after).not.toContain(r.id);
			}

			// CONNECTED: `after` = the surviving nodes + a set of newly-allocated ids. Hand that
			// newly-allocated set to the bridge EXPLICITLY (picks *and* the unlogged traversal
			// node) on top of the same removal prologue: if every one of them is already connected
			// to a survivor, AllocNode drags in nothing and the net point delta is exactly
			// (nodes added) - (points freed). A disconnected `after` would force AllocNode to pull
			// in extra connectors and push the delta above that.
			const survivorSet = new Set(FIXTURE.afterPicksOnly.filter((id) => !readdedIds.has(id)));
			const newlyAllocated = after.filter((id) => !survivorSet.has(id));
			const removedIds = result.removed.map((r) => r.id);
			const priced = await bridge.call<{ pointsSpent: number }>("get_stats_from", {
				allocSet: newlyAllocated,
				removeIds: removedIds,
			});
			expect(priced.pointsSpent).toBe(newlyAllocated.length - pointsFreed);
			expect(newlyAllocated.length).toBe(respent); // picks + their path nodes

			// And the bridge was left exactly as loaded (probe-and-restore).
			expect(await listIds(bridge)).toEqual(FIXTURE.before);
		},
		300_000,
	);
});
