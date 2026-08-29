// @poe2/api -- thin Hono server over src/core (optimiseTree / recommendTree) backed by a
// PobBridgePool, with an in-memory job registry and an SSE progress stream.
//
// Local-first, single-user, binds 127.0.0.1, no auth. Do not deploy this.
// Spec: intake/web-ui/04-api-server.md. Run it via `npm start` (repo root).

export const API_PACKAGE = "@poe2/api";

export { createApp, type CreateAppDeps, type CreatedApp } from "./app";
export { config, type ApiConfig } from "./config";
export {
	BuildStore,
	parseAscendancy,
	buildNotes,
	type StoredBuild,
	type BridgeSource,
	type BridgeLease,
} from "./builds/store";
export { JobRegistry, isTerminal, type JobState, type JobKind, type JobStatus } from "./jobs/registry";
export { runJob, defaultCoreFns, type CoreFns, type RunnerDeps } from "./jobs/runner";
export {
	mapOptimiseRequestToOptions,
	mapRecommendRequestToOptions,
	toOptimiseResultDTO,
	toRecommendedNodeDTOs,
	normalizeProgress,
	classifyError,
	sanitizeStatSet,
} from "./jobs/mappers";
export { decodePobCode, encodePobCode } from "./pob/code";
export { applyPlan } from "./pob/applyPlan";
