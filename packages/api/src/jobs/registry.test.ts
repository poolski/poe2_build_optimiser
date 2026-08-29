import { describe, expect, it, vi } from "vitest";
import { OptimiseRequest } from "@poe2/contract";
import type { ProgressEvent } from "@poe2/contract";
import { JobRegistry, type BuildLookup } from "./registry";
import type { OptimiseTreeOptions } from "../core";
import { fakeBridgeSource, fakeOptimiseResult, SAMPLE_XML, stubCore } from "../testkit";
import type { StoredBuild } from "../builds/store";

const BUILD: StoredBuild = {
	buildId: "b_1",
	xml: SAMPLE_XML,
	summary: {
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
	},
};

const builds: BuildLookup = { get: (id) => (id === "b_1" ? BUILD : undefined) };
const bridgeHandlers = { load_build_xml: { ok: true }, reset_metrics: { ok: true } };
const req = () => OptimiseRequest.parse({ buildId: "b_1", mode: "extend", extraPoints: 3 });

/** Await the job's terminal state. */
function settled(job: { emitter: import("node:events").EventEmitter; status: string }): Promise<void> {
	if (["done", "error", "cancelled"].includes(job.status)) return Promise.resolve();
	return new Promise((r) => job.emitter.once("settled", () => r()));
}

describe("JobRegistry lifecycle", () => {
	it("runs an optimise job: 3 progress ticks then done, result stored, bridge released", async () => {
		const source = fakeBridgeSource(bridgeHandlers);
		const core = stubCore({
			optimiseTree: async (_b, opts: OptimiseTreeOptions) => {
				for (let i = 1; i <= 3; i++) {
					opts.onProgress?.({ phase: "add-loop", buildOutputs: i * 10, bestObjective: 1000 + i, depth: i } as never);
				}
				return fakeOptimiseResult({ final: { objective: 1003, pointsSpent: 3, stats: { TotalDPS: 1003 } } }) as never;
			},
		});
		const reg = new JobRegistry({ source, builds, maxActiveJobs: 2, core });

		const ticks: ProgressEvent[] = [];
		const job = reg.create("optimise", "b_1", req());
		job.emitter.on("progress", (pe) => ticks.push(pe));

		await settled(job);

		expect(job.status).toBe("done");
		expect(ticks.map((t) => t.buildOutputs)).toEqual([10, 20, 30]);
		expect(ticks[0].jobId).toBe(job.jobId);
		expect(typeof ticks[0].elapsedMs).toBe("number");
		expect((job.result as { final: { objective: number } }).final.objective).toBe(1003);
		expect(job.lastProgress?.depth).toBe(3);
		expect(source.released).toBe(1);
		expect(reg.get(job.jobId)).toBe(job);
	});

	it("classifies a core throw as an error job", async () => {
		const core = stubCore({
			optimiseTree: async () => {
				throw new Error("the objective cannot score the loaded build's baseline stats");
			},
		});
		const reg = new JobRegistry({ source: fakeBridgeSource(bridgeHandlers), builds, maxActiveJobs: 1, core });
		const job = reg.create("optimise", "b_1", req());
		await settled(job);
		expect(job.status).toBe("error");
		expect(job.error?.kind).toBe("unscoreable-objective");
	});

	it("errors a job whose buildId is unknown, without acquiring a bridge", async () => {
		const source = fakeBridgeSource(bridgeHandlers);
		const reg = new JobRegistry({ source, builds, maxActiveJobs: 1, core: stubCore({}) });
		const job = reg.create("optimise", "missing", OptimiseRequest.parse({ buildId: "missing", mode: "extend" }));
		await settled(job);
		expect(job.status).toBe("error");
		expect(job.error?.kind).toBe("bad-request");
		expect(source.acquired).toBe(0);
	});

	it("admission: with maxActiveJobs=1 the second job stays queued until the first settles", async () => {
		let release1!: () => void;
		const gate = new Promise<void>((r) => (release1 = r));
		const core = stubCore({
			optimiseTree: async (_b, opts: OptimiseTreeOptions) => {
				opts.onProgress?.({ phase: "baseline", buildOutputs: 0, bestObjective: 1 } as never);
				await gate;
				return fakeOptimiseResult() as never;
			},
		});
		const reg = new JobRegistry({ source: fakeBridgeSource(bridgeHandlers), builds, maxActiveJobs: 1, core });

		const a = reg.create("optimise", "b_1", req());
		const b = reg.create("optimise", "b_1", req());

		await vi.waitFor(() => expect(a.status).toBe("running"));
		expect(b.status).toBe("queued");
		expect(reg.counts()).toEqual({ active: 1, total: 2 });

		release1(); // resolves the shared gate -> a finishes, then b is pumped and runs through it
		await settled(a);
		await settled(b);
		expect(b.status).toBe("done");
	});

	it("cancel of a running job -> cancelled, partial result discarded, bridge freed", async () => {
		const source = fakeBridgeSource(bridgeHandlers);
		const core = stubCore({
			optimiseTree: async (_b, opts: OptimiseTreeOptions) => {
				// spin until cancelled, like core checking shouldContinue between add-steps
				while (opts.shouldContinue?.() ?? true) await new Promise((r) => setTimeout(r, 5));
				return fakeOptimiseResult({ stoppedBecause: "cancelled" }) as never;
			},
		});
		const reg = new JobRegistry({ source, builds, maxActiveJobs: 1, core });
		const job = reg.create("optimise", "b_1", req());
		await vi.waitFor(() => expect(job.status).toBe("running"));

		expect(reg.cancel(job.jobId)).toBe("cancelled");

		// cancel() flips status synchronously; the runner still needs a tick to unwind + release.
		await vi.waitFor(() => expect(source.released).toBe(1));
		expect(job.status).toBe("cancelled");
		expect(job.result).toBeUndefined();
	});

	it("cancel of a queued job -> cancelled, never runs", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const core = stubCore({
			optimiseTree: async () => {
				await gate;
				return fakeOptimiseResult() as never;
			},
		});
		const source = fakeBridgeSource(bridgeHandlers);
		const reg = new JobRegistry({ source, builds, maxActiveJobs: 1, core });

		const a = reg.create("optimise", "b_1", req());
		const b = reg.create("optimise", "b_1", req());
		await vi.waitFor(() => expect(a.status).toBe("running"));

		expect(reg.cancel(b.jobId)).toBe("cancelled");
		expect(b.status).toBe("cancelled");

		release();
		await settled(a);
		expect(source.acquired).toBe(1); // b never acquired
	});
});
