// The Hono app factory. Wires the routes onto a BuildStore + JobRegistry over a bridge source
// (a PobBridgePool in production, a fake in the fast suite). No process bootstrap here -- that
// is server.ts, so tests can `createApp(...)` without binding a port.

import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
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
	/** Slots an "optimise" job leases (phase 1.5). Default: config.jobParallelism (env
	 *  JOB_PARALLELISM, itself defaulting to 1 -- i.e. off, byte-identical to pre-phase-1.5). */
	jobParallelism?: number;
	/** Injectable core entry points for the fast suite. */
	core?: CoreFns;
	/** Built-SPA root; false disables static serving outright (the fast suite). */
	webDist?: string | false;
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
		// deps.pool.stats().size is the actual pool the registry must never oversubscribe -- reads
		// straight from the same source (real PobBridgePool in prod, a fake in tests), never a
		// separately-configured number that could drift from it.
		poolSize: deps.pool.stats().size,
		maxActiveJobs: deps.maxActiveJobs ?? config.maxActiveJobs,
		jobParallelism: deps.jobParallelism ?? config.jobParallelism,
		core: deps.core,
	});

	const api = new Hono();
	api.route("/", healthRoutes({ pool: deps.pool, registry }));
	api.route("/builds", buildRoutes({ builds }));
	api.route("/jobs", jobRoutes({ builds, registry }));

	const app = new Hono();
	app.route("/api", api);

	// In production the same server serves the built SPA at "/". Mounted only when the bundle
	// is actually on disk: `packages/web/dist` appears after `npm run build:web`, and an
	// API-only run (or the fast suite) must not start 404ing every request through a static
	// handler that has no root. Dev never gets here -- Vite serves the SPA on :5173 and
	// proxies /api to this server.
	const webDist = deps.webDist === undefined ? config.webDist : deps.webDist;
	if (webDist !== false && existsSync(webDist)) {
		app.use("/*", serveStatic({ root: webDist }));
		// SPA fallback. The wizard has no router today, but a reload on any path (or a future
		// hash-free deep link) must return index.html rather than a 404.
		app.get("*", serveStatic({ path: `${webDist}/index.html` }));
	}

	return { app, builds, registry };
}
