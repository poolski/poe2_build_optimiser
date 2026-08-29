// Runtime configuration, all env-overridable. Local-first: the server binds 127.0.0.1 only and
// is never meant to be exposed (no auth, single user). See docs/web-ui/04-api-server.md §Config.

import { CONTRACT_VERSION } from "@poe2/contract";
import { defaultPoolSize } from "@poe2/pob-bridge";

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

// Both default to half the machine's available parallelism (see defaultPoolSize) so one optimise
// job fans its candidate batch across every warm slot out of the box -- phase 1.5's whole point.
// They are separate knobs only so a RAM-tight machine can shrink the pool (POOL_SIZE) or a busy
// one can trade single-run speed for job concurrency (JOB_PARALLELISM below poolSize).
const poolSize = envInt("POOL_SIZE", defaultPoolSize());

export interface ApiConfig {
	host: string;
	port: number;
	/** undefined -> PobBridge's own default (POB_LUAJIT_PATH env, else the per-OS default:
	 *  msys64 on Windows, `luajit` from PATH on macOS/Linux). */
	luajitPath: string | undefined;
	poolSize: number;
	/** Kept <= poolSize so a running job never blocks inside pool.acquire(). */
	maxActiveJobs: number;
	/**
	 * Phase 1.5: pool slots each "optimise" job leases (see JobRegistry's admission rewrite,
	 * packages/api/src/jobs/registry.ts). Defaults to `defaultPoolSize()` -- the same value
	 * poolSize defaults to -- so a single optimise job uses the whole warm pool, which is the
	 * only configuration where phase 1.5 actually cuts the wall time the user waits on. Each
	 * committed slot is another ~700 MB-resident LuaJIT child that must be FREE before the job
	 * can start, so at the default a second concurrent optimise job simply queues (strict FIFO)
	 * rather than running at half speed -- the right trade for a single-user local tool.
	 *
	 * Set JOB_PARALLELISM below poolSize to trade single-run speed for job concurrency, or to 1
	 * for pre-phase-1.5 behaviour. Clamped to <= poolSize here (JobRegistry throws at
	 * construction otherwise -- a config that could never admit an optimise job is a startup
	 * error, not a per-job condition).
	 *
	 * Note this changes `buildOutputCount` for a given run: sharding a candidate batch across N
	 * slots costs N-1 extra tail recomputes per add-step (see docs/web-ui/01-bridge-service.md
	 * "Phase 1.5"). The PLAN is unaffected -- byte-identical at any N.
	 */
	jobParallelism: number;
	contractVersion: string;
	/**
	 * Root of the built SPA, relative to the process cwd (the repo root -- `npm start` runs
	 * from there). Absent until `npm run build:web` has emitted it; the server then just
	 * serves the API. Dev doesn't use this at all: Vite serves the SPA on :5173 and proxies
	 * /api here.
	 */
	webDist: string;
}

export const config: ApiConfig = {
	host: "127.0.0.1",
	port: envInt("PORT", 8787),
	luajitPath: process.env.POB_LUAJIT_PATH || undefined,
	poolSize,
	maxActiveJobs: Math.min(poolSize, envInt("MAX_ACTIVE_JOBS", poolSize)),
	jobParallelism: Math.min(poolSize, envInt("JOB_PARALLELISM", defaultPoolSize())),
	contractVersion: CONTRACT_VERSION,
	webDist: process.env.WEB_DIST || "packages/web/dist",
};
