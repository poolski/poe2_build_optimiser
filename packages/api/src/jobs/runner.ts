// Runs one job on an acquired bridge: load -> map request -> call core with an onProgress relay
// and a shouldContinue tied to the job's AbortController -> map the result -> release.
//
// Cancellation contract (docs/web-ui/04-api-server.md §Job model): abort flips the job to
// "cancelled"; `shouldContinue` makes `optimiseTree` stop after the current add-step (seconds,
// not the whole run) and return a partial plan with `stoppedBecause: "cancelled"`, which the
// runner then DISCARDS -- the user cancelled because the config was wrong. The `finally` frees
// the bridge either way, so a size-2 pool is never blocked by a zombie job.

import type { OptimiseRequest, RecommendRequest } from "@poe2/contract";
import type { StoredBuild } from "../builds/store";
import type { BridgeLease, BridgeSource } from "../builds/store";
import { optimiseTree as realOptimiseTree, recommendTree as realRecommendTree } from "../core";
import type { OptimiseProgress, OptimiseTreeOptions, RecommendProgress, RecommendTreeOptions } from "../core";
import {
	classifyError,
	mapOptimiseRequestToOptions,
	mapRecommendRequestToOptions,
	normalizeProgress,
	toOptimiseResultDTO,
	toRecommendedNodeDTOs,
} from "./mappers";
import type { JobState } from "./registry";

/** The two core entry points, injectable so the fast suite can stub them (no LuaJIT). */
export interface CoreFns {
	optimiseTree: typeof realOptimiseTree;
	recommendTree: typeof realRecommendTree;
}

export const defaultCoreFns: CoreFns = {
	optimiseTree: realOptimiseTree,
	recommendTree: realRecommendTree,
};

export interface RunnerDeps {
	source: BridgeSource;
	core: CoreFns;
	getBuild(buildId: string): StoredBuild | undefined;
}

/** Drive `job` to a terminal state. Never throws; always emits `"settled"` exactly once. */
export async function runJob(job: JobState, deps: RunnerDeps): Promise<void> {
	job.status = "running";
	job.startedAt = Date.now();

	const build = deps.getBuild(job.buildId);
	if (!build) {
		job.error = { jobId: job.jobId, kind: "bad-request", message: `unknown buildId "${job.buildId}"` };
		job.status = "error";
		job.emitter.emit("settled");
		return;
	}

	const zeroDpsBuild = build.summary.notes.some((n) => n.includes("0 DPS"));
	let lease: BridgeLease | undefined;
	try {
		lease = await deps.source.acquire();
		await lease.call("load_build_xml", { xml: build.xml });
		await lease.call("reset_metrics");

		const onProgress = (ev: OptimiseProgress | RecommendProgress) => {
			if (job.abort.signal.aborted) return;
			const pe = normalizeProgress(ev, job.jobId, Date.now() - (job.startedAt ?? Date.now()));
			job.lastProgress = pe;
			job.emitter.emit("progress", pe);
		};

		if (job.kind === "optimise") {
			const opts: OptimiseTreeOptions = mapOptimiseRequestToOptions(job.request as OptimiseRequest, build.summary);
			opts.onProgress = onProgress;
			opts.shouldContinue = () => !job.abort.signal.aborted;
			const result = await deps.core.optimiseTree(lease, opts);
			if (!job.abort.signal.aborted) {
				job.result = toOptimiseResultDTO(result, build.xml);
			}
		} else {
			const opts: RecommendTreeOptions = mapRecommendRequestToOptions(job.request as RecommendRequest);
			opts.onProgress = onProgress;
			const nodes = await deps.core.recommendTree(lease, opts);
			if (!job.abort.signal.aborted) {
				job.result = toRecommendedNodeDTOs(nodes);
			}
		}

		if (job.abort.signal.aborted) {
			job.status = "cancelled";
			job.result = undefined; // discard the partial plan
		} else {
			job.status = "done";
		}
	} catch (err) {
		if (job.abort.signal.aborted) {
			job.status = "cancelled";
		} else {
			job.error = classifyError(err, job.jobId, { zeroDpsBuild });
			job.status = "error";
		}
	} finally {
		lease?.release();
		job.emitter.emit("settled");
	}
}
