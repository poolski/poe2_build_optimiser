// The Hono app factory. Wires the routes onto a BuildStore + JobRegistry over a bridge source
// (a PobBridgePool in production, a fake in the fast suite). No process bootstrap here -- that
// is server.ts, so tests can `createApp(...)` without binding a port.

import { Hono } from "hono";
import type { BridgeSource } from "./builds/store";
import { BuildStore } from "./builds/store";
import { config } from "./config";
import type { CoreFns } from "./jobs/runner";
import { JobRegistry } from "./jobs/registry";
import { buildRoutes } from "./routes/builds";
import { healthRoutes, type PoolStatsSource } from "./routes/health";
import { jobRoutes } from "./routes/jobs";

export interface CreateAppDeps {
	/** Production: a PobBridgePool. Satisfies both BridgeSource (acquire) and PoolStatsSource (stats). */
	pool: BridgeSource & PoolStatsSource;
	maxActiveJobs?: number;
	/** Injectable core entry points for the fast suite. */
	core?: CoreFns;
}

export interface CreatedApp {
	app: Hono;
	builds: BuildStore;
	registry: JobRegistry;
}

export function createApp(deps: CreateAppDeps): CreatedApp {
	const builds = new BuildStore(deps.pool);
	const registry = new JobRegistry({
		source: deps.pool,
		builds,
		maxActiveJobs: deps.maxActiveJobs ?? config.maxActiveJobs,
		core: deps.core,
	});

	const api = new Hono();
	api.route("/", healthRoutes({ pool: deps.pool, registry }));
	api.route("/builds", buildRoutes({ builds }));
	api.route("/jobs", jobRoutes({ builds, registry }));

	const app = new Hono();
	app.route("/api", api);

	// In production the same server also serveStatic()s packages/web/dist at "/". The SPA does
	// not exist yet (phase 3); wiring it here is that phase's one-liner.

	return { app, builds, registry };
}
