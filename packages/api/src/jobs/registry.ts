// In-memory job registry: Map<jobId, JobState> + an EventEmitter per job, admission control, a
// FIFO queue, cancellation, and retention (finished jobs stay until restart). No job-queue lib
// -- single user, the only scheduling concern is not oversubscribing the LuaJIT pool.
//
// Admission (phase 1.5 rewrite -- see intake/web-ui/01-bridge-service.md "Phase 1.5" for the design
// history): SLOT-based, not job-count-based. Each job is assigned a `parallelism` (how many pool
// slots it will lease) once, at creation, before it is ever queued. A queued job is admitted only
// when `(slots committed by every currently-running job) + job.parallelism <= poolSize`. That is
// the generalisation of the old rule -- back when every job leased exactly 1 slot, "admit at most
// poolSize jobs" and "admit while committed slots + 1 <= poolSize" were the same statement.
// Sticking to job-COUNT admission after phase 1.5 let jobs lease more than 1 slot each without
// checking against the pool total, which broke the invariant this comment used to state ("a
// running job never waits inside pool.acquire()") -- a job leasing N slots can genuinely block
// inside PobBridgePool.lease() waiting for slots two *other* admitted jobs are sitting on. This
// rewrite restores the invariant by construction: a job is never admitted unless its full slot
// requirement is available, so `lease()`/`acquireParallel()` never has to wait once called.
//
// `maxActiveJobs` is kept as a SEPARATE, independent ceiling on the number of simultaneously
// RUNNING jobs (not slots) -- useful on its own even when every job requests 1 slot (e.g. a wide
// pool but a deliberately low job-count cap), and orthogonal to the slot check: both must pass.
//
// Admission is strict FIFO: only the job at the head of the queue is ever considered. If it does
// not fit (not enough free slots, or the running-job-count ceiling is hit), pump() stops -- it
// never skips ahead to start a smaller job further back in the queue. This is deliberately the
// simple, no-starvation-by-construction choice over a bin-packing scheduler: a single-user local
// tool does not need one, and skipping the head would let an endless stream of small jobs starve
// a large one indefinitely.
//
// A job whose OWN requested parallelism exceeds poolSize is rejected synchronously by create() --
// never queued, because it could never be admitted (see create()'s guard, mirroring
// PobBridgePool.lease()'s own synchronous-reject for the same case).

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
	/** Pool slots this job will lease, decided once in create() and immutable after -- see the
	 *  file header. runJob() uses this to pick acquire() (1) vs acquireParallel(n) (> 1). */
	parallelism: number;
}

export interface JobRegistryOptions {
	source: BridgeSource;
	builds: BuildLookup;
	/** Total slots in the pool `source` draws from. The authority admission checks jobs against --
	 *  must match the real pool's size (or the fake's, in tests), or the "never blocks in
	 *  acquire()" invariant is only as true as this number is accurate. */
	poolSize: number;
	/** Independent ceiling on simultaneously RUNNING jobs, regardless of their slot cost. Both
	 *  this and the slot check must pass for a job to be admitted. */
	maxActiveJobs: number;
	/** Slots an "optimise" job requests (phase 1.5). "recommend" jobs always request 1 -- their
	 *  bridge calls (evaluate_candidate_nodes, not the _from batch form used in a beam loop
	 *  step) aren't sharded by ParallelBridge in a way that pays for a wider lease. Clamped to
	 *  `poolSize`; default 1 (byte-identical to pre-phase-1.5 behaviour: every job leases exactly
	 *  one slot, admission is exactly the old job-count rule). Raising this trades pool headroom
	 *  for wall-clock: each additional slot committed per job is another ~700 MB-resident LuaJIT
	 *  child that must be free before that job (or any job needing that many slots) can start. */
	jobParallelism?: number;
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
	private readonly poolSize: number;
	private readonly jobParallelism: number;

	constructor(opts: JobRegistryOptions) {
		this.opts = opts;
		this.core = opts.core ?? defaultCoreFns;
		this.poolSize = Math.max(1, Math.trunc(opts.poolSize));
		this.jobParallelism = Math.max(1, Math.trunc(opts.jobParallelism ?? 1));
		// A registry-wide setting that would make every "optimise" job unadmittable is a
		// configuration error, not a per-job runtime condition -- reject it once, up front, rather
		// than accepting jobs that could then never leave the queue. Mirrors
		// PobBridgePool.lease()'s own synchronous reject for the same shape of mistake.
		if (this.jobParallelism > this.poolSize) {
			throw new Error(
				`JobRegistry: jobParallelism (${this.jobParallelism}) exceeds poolSize (${this.poolSize}) -- ` +
					`an optimise job would never be admittable`,
			);
		}
	}

	/** Register a job. Starts it immediately if enough slots + an active-job slot are free, else
	 *  leaves it "queued" (see the file header for the admission rule). */
	create(kind: JobKind, buildId: string, request: OptimiseRequest | RecommendRequest): JobState {
		const emitter = new EventEmitter();
		emitter.setMaxListeners(64); // many SSE subscribers on one job is fine
		// "recommend" always requests 1 slot -- see JobRegistryOptions.jobParallelism's doc comment.
		const parallelism = kind === "optimise" ? this.jobParallelism : 1;
		const job: JobState = {
			jobId: `j_${randomUUID().slice(0, 8)}`,
			kind,
			buildId,
			request,
			status: "queued",
			createdAt: Date.now(),
			emitter,
			abort: new AbortController(),
			parallelism,
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
	/** Slots a new "optimise" job will actually lease -- the EFFECTIVE value after createApp's
	 *  clamp to the real pool, which is not necessarily `config.jobParallelism`. /api/health
	 *  reports this rather than the global config so an operator sees what jobs really get. */
	get effectiveJobParallelism(): number {
		return this.jobParallelism;
	}

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

	/** Pool slots committed by every currently-running job (sum of their `parallelism`). The
	 *  slot-based half of admission -- see the file header. */
	private slotsCommitted(): number {
		let n = 0;
		for (const j of this.jobs.values()) if (j.status === "running") n += j.parallelism;
		return n;
	}

	/** Start queued jobs while both the running-job-count ceiling and the pool's slot budget allow
	 *  it. Strict FIFO: stops at the first queued job that doesn't fit rather than skipping ahead
	 *  to a smaller one behind it (see the file header for why). A stale queue entry (job already
	 *  cancelled while queued -- cancel() splices it out itself, so this is defensive, not the
	 *  normal path) is dropped and scanning continues from the new head. */
	private pump(): void {
		for (;;) {
			const jobId = this.queue[0];
			if (jobId === undefined) return;
			const job = this.jobs.get(jobId);
			if (!job || job.status !== "queued") {
				this.queue.shift();
				continue;
			}
			if (this.runningCount() >= this.opts.maxActiveJobs) return;
			if (this.slotsCommitted() + job.parallelism > this.poolSize) return; // head doesn't fit -- wait
			this.queue.shift();
			job.status = "running"; // reserve the slot(s) synchronously
			job.emitter.once("settled", () => this.pump());
			void runJob(job, {
				source: this.opts.source,
				core: this.core,
				getBuild: (id) => this.opts.builds.get(id),
			});
		}
	}
}
