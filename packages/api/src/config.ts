// Runtime configuration, all env-overridable. Local-first: the server binds 127.0.0.1 only and
// is never meant to be exposed (no auth, single user). See docs/web-ui/04-api-server.md §Config.

import { CONTRACT_VERSION } from "@poe2/contract";

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

const poolSize = envInt("POOL_SIZE", 2);

export interface ApiConfig {
	host: string;
	port: number;
	/** undefined -> PobBridge's own default (POB_LUAJIT_PATH env, else the msys64 path). */
	luajitPath: string | undefined;
	poolSize: number;
	/** Kept <= poolSize so a running job never blocks inside pool.acquire(). */
	maxActiveJobs: number;
	contractVersion: string;
}

export const config: ApiConfig = {
	host: "127.0.0.1",
	port: envInt("PORT", 8787),
	luajitPath: process.env.POB_LUAJIT_PATH || undefined,
	poolSize,
	maxActiveJobs: Math.min(poolSize, envInt("MAX_ACTIVE_JOBS", poolSize)),
	contractVersion: CONTRACT_VERSION,
};
