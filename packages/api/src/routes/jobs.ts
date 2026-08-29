import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { OptimiseRequest, RecommendRequest } from "@poe2/contract";
import type { BuildStore } from "../builds/store";
import { parseObjective } from "../core";
import type { JobRegistry, JobState } from "../jobs/registry";
import { isTerminal } from "../jobs/registry";
import { badRequest, formatZodIssues } from "./errors";

const HEARTBEAT_MS = 15_000;

/** The one SSE terminal frame for a settled job: `done` (result) / `error` (JobError) /
 * `cancelled` (a bare JobRef -- the partial plan was discarded). */
function terminalFrame(job: JobState): { event: string; data: string } {
	if (job.status === "done") return { event: "done", data: JSON.stringify(job.result ?? null) };
	if (job.status === "error") return { event: "error", data: JSON.stringify(job.error ?? null) };
	return { event: "cancelled", data: JSON.stringify({ jobId: job.jobId, status: job.status }) };
}

export function jobRoutes(deps: { builds: BuildStore; registry: JobRegistry }): Hono {
	const app = new Hono();

	// POST /api/jobs -- body discriminated by `kind: "optimise" | "recommend"` (the contract
	// schemas themselves carry no discriminator; it is an API-layer envelope field).
	app.post("/", async (c) => {
		let body: Record<string, unknown>;
		try {
			body = (await c.req.json()) as Record<string, unknown>;
		} catch {
			return badRequest(c, "request body is not valid JSON");
		}

		const kind = body.kind;
		if (kind !== "optimise" && kind !== "recommend") {
			return badRequest(c, 'body.kind must be "optimise" or "recommend"');
		}

		// unknown keys (incl. the envelope `kind`) are stripped by z.object parse.
		const parsed =
			kind === "optimise" ? OptimiseRequest.safeParse(body) : RecommendRequest.safeParse(body);
		if (!parsed.success) return badRequest(c, formatZodIssues(parsed.error));
		const request = parsed.data;

		// The contract's ObjectiveSpec only gates string SHAPE; core's parseObjective range-checks
		// the weight (`dps-ehp:5` passes the regex, fails here). Catch it before creating a job.
		try {
			parseObjective(request.objective);
		} catch (err) {
			return badRequest(c, err instanceof Error ? err.message : "invalid objective");
		}

		if (kind === "optimise") {
			const opt = request as OptimiseRequest;
			if (opt.mode === "repair" && (opt.respecBudget ?? 0) <= 0) {
				return badRequest(c, "repair mode requires respecBudget > 0 (or use mode: rollback)");
			}
		}

		if (!deps.builds.has(request.buildId)) {
			return badRequest(c, `unknown buildId "${request.buildId}" -- POST /api/builds first`);
		}

		const job = deps.registry.create(kind, request.buildId, request);
		return c.json({ jobId: job.jobId, status: job.status }, 201);
	});

	// GET /api/jobs/:id -> JobRef + result? / error?
	app.get("/:id", (c) => {
		const job = deps.registry.get(c.req.param("id"));
		if (!job) return c.json({ kind: "not-found", message: "no such job" }, 404);
		return c.json({
			jobId: job.jobId,
			status: job.status,
			...(job.result !== undefined ? { result: job.result } : {}),
			...(job.error !== undefined ? { error: job.error } : {}),
		});
	});

	// POST /api/jobs/:id/cancel -> JobRef
	app.post("/:id/cancel", (c) => {
		const status = deps.registry.cancel(c.req.param("id"));
		if (status === undefined) return c.json({ kind: "not-found", message: "no such job" }, 404);
		return c.json({ jobId: c.req.param("id"), status });
	});

	// GET /api/jobs/:id/events -- SSE: `progress`* then exactly one of `done` | `error` |
	// `cancelled`, then the stream closes. A late subscriber gets `lastProgress` replayed and,
	// if the job already settled, the terminal frame immediately.
	app.get("/:id/events", (c) => {
		const job = deps.registry.get(c.req.param("id"));
		if (!job) return c.json({ kind: "not-found", message: "no such job" }, 404);

		return streamSSE(c, async (stream) => {
			if (job.lastProgress) {
				await stream.writeSSE({ event: "progress", data: JSON.stringify(job.lastProgress) });
			}
			if (isTerminal(job.status)) {
				await stream.writeSSE(terminalFrame(job));
				return;
			}

			let done!: () => void;
			const finished = new Promise<void>((resolve) => {
				done = resolve;
			});

			const onProgress = (pe: unknown) => {
				void stream.writeSSE({ event: "progress", data: JSON.stringify(pe) }).catch(() => undefined);
			};
			const onSettled = () => {
				void stream
					.writeSSE(terminalFrame(job))
					.catch(() => undefined)
					.finally(done);
			};

			job.emitter.on("progress", onProgress);
			job.emitter.once("settled", onSettled);
			// Race guard: the job may have settled between the isTerminal() check and here.
			if (isTerminal(job.status)) {
				job.emitter.off("settled", onSettled);
				await stream.writeSSE(terminalFrame(job));
				job.emitter.off("progress", onProgress);
				return;
			}

			const heartbeat = setInterval(() => {
				void stream.write(": keep-alive\n\n").catch(() => undefined);
			}, HEARTBEAT_MS);

			stream.onAbort(() => {
				job.emitter.off("progress", onProgress);
				job.emitter.off("settled", onSettled);
				clearInterval(heartbeat);
				done();
			});

			await finished;
			clearInterval(heartbeat);
			job.emitter.off("progress", onProgress);
		});
	});

	return app;
}
