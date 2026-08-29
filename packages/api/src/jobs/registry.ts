// In-memory job registry: Map<jobId, JobState> + an EventEmitter per job, admission control, a
// FIFO queue, cancellation, and retention (finished jobs stay until restart). No job-queue lib
// -- single user, the only scheduling concern is not oversubscribing the LuaJIT pool.
//
// Admission: at most `maxActiveJobs` (default = pool size) run at once; extras sit "queued".
// With maxActiveJobs === POOL_SIZE a running job never waits inside pool.acquire().

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { JobError, OptimiseRequest, ProgressEvent, RecommendRequest, RecommendedNodeDTO } from "@poe2/contract";
import type { OptimiseResultDTO } from "@poe2/contract";
import type { BridgeSource, StoredBuild } from "../builds/store";
import { defaultCoreFns, runJob, type CoreFns } from "./runner";

/** Just the slice of BuildStore the registry needs -- lets the fast suite pass a plain object. */
export interface BuildLookup {
	get(buildId: string): StoredBuild | undefined;
}

export type JobKind = "optimise" | "recommend";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobState {
	jobId: string;
	kind: JobKind;
	buildId: string;
	request: OptimiseRequest | RecommendRequest;
	status: JobStatus;
	createdAt: number;
	startedAt?: number;
	/** "progress" (ProgressEvent) and "settled" (no payload). */
	emitter: EventEmitter;
	/** Replayed to a late SSE subscriber. */
	lastProgress?: ProgressEvent;
	result?: OptimiseResultDTO | RecommendedNodeDTO[];
	error?: JobError;
	/** cancel() aborts this; the runner passes `shouldContinue: () => !aborted` into core. */
	abort: AbortController;
}

export interface JobRegistryOptions {
	source: BridgeSource;
	builds: BuildLookup;
	maxActiveJobs: number;
	/** Injectable for the fast suite (stub core, no LuaJIT). Defaults to the real entry points. */
	core?: CoreFns;
}

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(["done", "error", "cancelled"]);
export const isTerminal = (s: JobStatus): boolean => TERMINAL.has(s);

export class JobRegistry {
	private readonly jobs = new Map<string, JobState>();
	private readonly queue: string[] = [];
	private readonly opts: JobRegistryOptions;
	private readonly core: CoreFns;

	constructor(opts: JobRegistryOptions) {
		this.opts = opts;
		this.core = opts.core ?? defaultCoreFns;
	}

	/** Register a job. Starts it immediately if a slot is free, else leaves it "queued". */
	create(kind: JobKind, buildId: string, request: OptimiseRequest | RecommendRequest): JobState {
		const emitter = new EventEmitter();
		emitter.setMaxListeners(64); // many SSE subscribers on one job is fine
		const job: JobState = {
			jobId: `j_${randomUUID().slice(0, 8)}`,
			kind,
			buildId,
			request,
			status: "queued",
			createdAt: Date.now(),
			emitter,
			abort: new AbortController(),
		};
		this.jobs.set(job.jobId, job);
		this.queue.push(job.jobId);
		// Defer so create() returns with status "queued" (the submit -> poll/stream contract) and
		// a caller can attach to the emitter / open the SSE stream before the run starts.
		queueMicrotask(() => this.pump());
		return job;
	}

	get(jobId: string): JobState | undefined {
		return this.jobs.get(jobId);
	}

	/** Cancel a queued or running job. No-op on an already-terminal one. Returns the job's
	 * (possibly unchanged) status, or undefined if the id is unknown. */
	cancel(jobId: string): JobStatus | undefined {
		const job = this.jobs.get(jobId);
		if (!job) return undefined;
		if (job.status === "queued") {
			const i = this.queue.indexOf(jobId);
			if (i >= 0) this.queue.splice(i, 1);
			job.status = "cancelled";
			job.emitter.emit("settled");
		} else if (job.status === "running") {
			// Flip now so GET /jobs/:id and this response both read "cancelled" immediately; the
			// runner also sees `abort.signal.aborted`, discards the partial plan, and emits "settled".
			job.abort.abort();
			job.status = "cancelled";
		}
		return job.status;
	}

	/** { active, total } for /api/health. */
	counts(): { active: number; total: number } {
		let active = 0;
		for (const j of this.jobs.values()) if (j.status === "running") active++;
		return { active, total: this.jobs.size };
	}

	private runningCount(): number {
		let n = 0;
		for (const j of this.jobs.values()) if (j.status === "running") n++;
		return n;
	}

	/** Start as many queued jobs as free slots allow. */
	private pump(): void {
		while (this.runningCount() < this.opts.maxActiveJobs && this.queue.length > 0) {
			const jobId = this.queue.shift()!;
			const job = this.jobs.get(jobId);
			if (!job || job.status !== "queued") continue;
			job.status = "running"; // reserve the slot synchronously
			job.emitter.once("settled", () => this.pump());
			void runJob(job, {
				source: this.opts.source,
				core: this.core,
				getBuild: (id) => this.opts.builds.get(id),
			});
		}
	}
}
