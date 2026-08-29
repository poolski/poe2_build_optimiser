import { Hono } from "hono";
import { config } from "../config";
import type { JobRegistry } from "../jobs/registry";

export interface PoolStatsSource {
	stats(): { size: number; busy: number; queued: number };
}

export function healthRoutes(deps: { pool: PoolStatsSource; registry: JobRegistry }): Hono {
	const app = new Hono();

	// GET /api/health
	app.get("/health", (c) =>
		c.json({
			ok: true,
			contractVersion: config.contractVersion,
			pool: deps.pool.stats(),
			jobs: deps.registry.counts(),
			// Phase 1.5: read-only visibility into the slots each new "optimise" job will request.
			// Not a per-request override (see intake/web-ui/01-bridge-service.md "Phase 1.5" for why
			// that was deliberately left out of this pass) -- just lets an operator/UI confirm
			// what JOB_PARALLELISM resolved to on this machine (it defaults to half the available
			// cores, so it is host-dependent and worth surfacing rather than assuming).
			jobParallelism: deps.registry.effectiveJobParallelism,
		}),
	);

	return app;
}
