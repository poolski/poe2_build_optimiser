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
		}),
	);

	return app;
}
