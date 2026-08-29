import { describe, expect, it } from "vitest";
import { OptimiseRequest, RecommendRequest } from "@poe2/contract";
import type { BuildSummary } from "@poe2/contract";
import {
	classifyError,
	mapOptimiseRequestToOptions,
	mapRecommendRequestToOptions,
	normalizeProgress,
	sanitizeStatSet,
	toOptimiseResultDTO,
} from "./mappers";
import { fakeOptimiseResult, SAMPLE_XML } from "../testkit";
import type { OptimiseTreeResult } from "../core";

const BUILD: BuildSummary = {
	buildId: "b_1",
	className: "Warrior",
	ascendancy: null,
	treeVersion: "0_5",
	level: 84,
	pointsUsed: 100,
	pointsMax: 123,
	weaponSet1PointsUsed: 0,
	weaponSet2PointsUsed: 0,
	baseline: { TotalDPS: 1000 },
	notes: [],
};

const opt = (over: Record<string, unknown>) => OptimiseRequest.parse({ buildId: "b_1", mode: "extend", ...over });

describe("mapOptimiseRequestToOptions", () => {
	it("resolves extraPoints against the stored build's pointsUsed [obligation 5]", () => {
		const o = mapOptimiseRequestToOptions(opt({ mode: "extend", extraPoints: 5 }), BUILD);
		expect(o.pointBudget).toBe(105);
	});

	it("passes an absolute pointBudget straight through", () => {
		const o = mapOptimiseRequestToOptions(opt({ mode: "extend", pointBudget: 118 }), BUILD);
		expect(o.pointBudget).toBe(118);
	});

	it("expands minResist to Fire/Cold/Lightning constraints, explicit wins [obligation 6]", () => {
		const o = mapOptimiseRequestToOptions(
			opt({ minResist: 75, constraints: { FireResist: 80, TotalEHP: 5000 } }),
			BUILD,
		);
		expect(o.constraints).toEqual({ FireResist: 80, ColdResist: 75, LightningResist: 75, TotalEHP: 5000 });
	});

	it("rollback -> anchorNodeId, no core `mode` [obligation 7]", () => {
		const o = mapOptimiseRequestToOptions(
			OptimiseRequest.parse({ buildId: "b_1", mode: "rollback", anchorNodeId: 34015, respecBudget: 3 }),
			BUILD,
		);
		expect(o.anchorNodeId).toBe(34015);
		expect(o.respecBudget).toBe(3);
		expect("mode" in o).toBe(false);
	});

	it("repair -> respecBudget", () => {
		const o = mapOptimiseRequestToOptions(
			OptimiseRequest.parse({ buildId: "b_1", mode: "repair", respecBudget: 4 }),
			BUILD,
		);
		expect(o.respecBudget).toBe(4);
	});

	it("throws on a shape-valid but out-of-range objective weight [obligation 4]", () => {
		// `dps-ehp:5` passes ObjectiveSpec's regex; parseObjective range-checks [0,1].
		const req = OptimiseRequest.parse({ buildId: "b_1", mode: "extend", objective: "dps-ehp:0.9" });
		(req as { objective: string }).objective = "dps-ehp:5";
		expect(() => mapOptimiseRequestToOptions(req, BUILD)).toThrow(/weight/i);
	});

	it("leaves empty collections off the options object", () => {
		const o = mapOptimiseRequestToOptions(opt({}), BUILD);
		expect(o.constraints).toBeUndefined();
		expect(o.preserveMetrics).toBeUndefined();
		expect(o.freeze).toBeUndefined();
	});
});

describe("mapRecommendRequestToOptions", () => {
	it("maps the scoring spec to objectiveFn and carries keepViolating / top", () => {
		const o = mapRecommendRequestToOptions(
			RecommendRequest.parse({ buildId: "b_1", objective: "TotalEHP", top: 5, keepViolating: true }),
		);
		expect(typeof o.objectiveFn).toBe("function");
		expect(o.top).toBe(5);
		expect(o.keepViolating).toBe(true);
		expect("objective" in o).toBe(false); // NOT the keyword-screen param
	});
});

describe("toOptimiseResultDTO", () => {
	it("coerces non-finite objectiveAfterRemoval / valueLost to null [obligation 1]", () => {
		const result = fakeOptimiseResult({
			mode: "repair",
			respecBudget: 2,
			removed: [
				{
					id: 999,
					name: "Anchor",
					type: "Notable",
					statLines: [],
					pointsFreed: 6,
					anchorCascade: true,
					objectiveAfterRemoval: Number.POSITIVE_INFINITY,
					valueLost: Number.NaN,
				},
			],
			stoppedBecause: "nothing-removable",
		}) as unknown as OptimiseTreeResult;
		const dto = toOptimiseResultDTO(result, SAMPLE_XML);
		expect(dto.removed[0].objectiveAfterRemoval).toBeNull();
		expect(dto.removed[0].valueLost).toBeNull();
	});

	it("strips non-finite keys from final.stats [obligation 2]", () => {
		const result = fakeOptimiseResult({
			final: { objective: 1000, pointsSpent: 0, stats: { TotalDPS: 1000, Broken: Infinity, Nan: NaN } },
		}) as unknown as OptimiseTreeResult;
		const dto = toOptimiseResultDTO(result, SAMPLE_XML);
		expect(dto.final.stats).toEqual({ TotalDPS: 1000 });
	});

	it("builds updatedPobCode from allocatedNodeIds.after [obligation 3]", () => {
		const result = fakeOptimiseResult({
			allocatedNodeIds: { before: [10, 20, 30, 40], after: [10, 20, 30, 40, 55, 66] },
			addedNodeIds: [55], // picks-only -- deliberately different from `after`
		}) as unknown as OptimiseTreeResult;
		const dto = toOptimiseResultDTO(result, SAMPLE_XML);
		// decode it back and confirm the <Spec> got the CONNECTED set, not the picks-only one
		const zlib = require("node:zlib") as typeof import("node:zlib");
		const xml = zlib
			.inflateSync(Buffer.from(dto.updatedPobCode.replace(/-/g, "+").replace(/_/g, "/"), "base64"))
			.toString("utf-8");
		expect(xml).toContain('nodes="10,20,30,40,55,66"');
	});

	it("passes the DTO through the contract schema (rejects a mapper regression)", () => {
		const dto = toOptimiseResultDTO(fakeOptimiseResult() as unknown as OptimiseTreeResult, SAMPLE_XML);
		expect(dto.mode).toBe("extend");
		expect(dto.stoppedBecause).toBe("nothing-to-do");
	});
});

describe("normalizeProgress", () => {
	it("keeps core's buildOutputs name and adds jobId / elapsedMs [obligation 8]", () => {
		const pe = normalizeProgress(
			{ phase: "add-loop", buildOutputs: 128, bestObjective: 10441.9, depth: 3 } as never,
			"j_1",
			21000.7,
		);
		expect(pe).toMatchObject({ jobId: "j_1", phase: "add-loop", buildOutputs: 128, depth: 3, elapsedMs: 21001 });
	});

	it("supplies bestObjective 0 for a recommend tick (no such field on RecommendProgress)", () => {
		const pe = normalizeProgress(
			{ phase: "scoring", buildOutputs: 50, candidatesScored: 50, candidatesTotal: 220 } as never,
			"j_2",
			8000,
		);
		expect(pe.bestObjective).toBe(0);
		expect(pe.candidatesTotal).toBe(220);
	});
});

describe("classifyError", () => {
	it("bridge death -> bridge-crash", () => {
		expect(classifyError(new Error("bridge process exited (code 1) before responding"), "j").kind).toBe(
			"bridge-crash",
		);
	});
	it("baseline-unscorable + known 0-DPS build -> zero-dps-build", () => {
		const e = new Error("optimiseTree: the objective cannot score the loaded build's baseline stats");
		expect(classifyError(e, "j", { zeroDpsBuild: true }).kind).toBe("zero-dps-build");
		expect(classifyError(e, "j").kind).toBe("unscoreable-objective");
	});
	it("parseObjective throw -> unscoreable-objective", () => {
		expect(classifyError(new Error('objective weight must be a number in [0, 1], got "5"'), "j").kind).toBe(
			"unscoreable-objective",
		);
	});
	it("anything else -> internal", () => {
		expect(classifyError(new Error("kaboom"), "j").kind).toBe("internal");
	});
});

describe("sanitizeStatSet", () => {
	it("keeps only finite numbers", () => {
		expect(sanitizeStatSet({ a: 1, b: NaN, c: Infinity, d: "x", e: 0 })).toEqual({ a: 1, e: 0 });
	});
});
