// The request/result mappers between the wire contract (@poe2/contract) and core
// (src/core/optimiseTree + recommendTree). Everything here is pure.
//
// docs/web-ui/04-api-server.md §"Mapper obligations" enumerates the 8 things the contract
// CANNOT enforce and this file MUST do; each is tagged [obligation N] at its site.

import type {
	BuildSummary,
	JobError,
	OptimiseRequest,
	OptimiseResultDTO,
	ProgressEvent,
	RecommendRequest,
	RecommendedNodeDTO,
} from "@poe2/contract";
import {
	OptimiseResultDTO as OptimiseResultDTOSchema,
	RecommendedNodeDTO as RecommendedNodeDTOSchema,
} from "@poe2/contract";
import {
	parseObjective,
	type OptimiseProgress,
	type OptimiseTreeOptions,
	type OptimiseTreeResult,
	type RecommendProgress,
	type RecommendedNode,
	type RecommendTreeOptions,
	type StatSet,
} from "../core";
import { applyPlan } from "../pob/applyPlan";
import { encodePobCode } from "../pob/code";

/** `--min-resist` sugar expands to these three (chaos res is deliberately excluded -- mirrors
 * src/cliShared.ts ELEMENTAL_RESIST_METRICS). [obligation 6] */
const ELEMENTAL_RESIST_METRICS = ["FireResist", "ColdResist", "LightningResist"] as const;

function toFiniteOrNull(n: number): number | null {
	return Number.isFinite(n) ? n : null;
}

/** Drop every non-finite entry from a PoB stat set. `bridge.lua`'s sanitizeForJson passes
 * inf/nan straight through, and zod's `z.number()` rejects them, so this must run before the
 * StatSet reaches `BuildSummary.baseline` or `OptimiseResultDTO.final.stats`. [obligation 2] */
export function sanitizeStatSet(raw: StatSet): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
	}
	return out;
}

// --- request -> core options ----------------------------------------------------------------

/**
 * `OptimiseRequest` (contract, defaults already applied) -> `OptimiseTreeOptions` (core).
 *
 * Throws if `objective` fails `parseObjective` -- the contract's `ObjectiveSpec` only gates the
 * string SHAPE (`dps-ehp:5` passes the regex; core's parseWeight rejects it). [obligation 4]
 * Callers should surface that as a `bad-request` (route) / `unscoreable-objective` (runner).
 */
export function mapOptimiseRequestToOptions(req: OptimiseRequest, build: BuildSummary): OptimiseTreeOptions {
	const opts: OptimiseTreeOptions = {
		// parseObjective("TotalDPS") === metricObjective("TotalDPS"), so routing everything through
		// objectiveFn is identical to setting targetMetric and keeps one code path.
		objectiveFn: parseObjective(req.objective),
		includeAllNodeTypes: req.includeAllNodeTypes,
	};

	// mode cardinality: request is extend|repair|rollback, core has no `mode`. [obligation 7]
	if (req.mode === "rollback") {
		opts.anchorNodeId = req.anchorNodeId; // schema .refine guarantees it is set
		if (req.respecBudget !== undefined) opts.respecBudget = req.respecBudget; // extra survivors on top
	} else if (req.mode === "repair") {
		opts.respecBudget = req.respecBudget ?? 0;
	} else {
		// extend: no respec. `extraPoints` has no core equivalent -- resolve it here against the
		// stored build's pointsUsed. [obligation 5]
		if (req.extraPoints !== undefined) opts.pointBudget = build.pointsUsed + req.extraPoints;
		else if (req.pointBudget !== undefined) opts.pointBudget = req.pointBudget;
	}

	// constraints + minResist sugar. An explicit `constraints` entry wins over the sugar. [obligation 6]
	const constraints: Record<string, number> = { ...req.constraints };
	if (req.minResist !== undefined) {
		for (const m of ELEMENTAL_RESIST_METRICS) {
			if (!(m in constraints)) constraints[m] = req.minResist;
		}
	}
	if (Object.keys(constraints).length > 0) opts.constraints = constraints;
	if (req.preserveMetrics.length > 0) opts.preserveMetrics = req.preserveMetrics;

	if (req.proximity !== undefined) opts.proximity = req.proximity;
	if (req.nodeTypes !== undefined) opts.nodeTypes = req.nodeTypes;
	if (req.keywords !== undefined) opts.keywords = req.keywords;
	if (req.excludeKeywords !== undefined) opts.excludeKeywords = req.excludeKeywords;
	if (req.beamWidth !== undefined) opts.beamWidth = req.beamWidth;
	if (req.beamDepth !== undefined) opts.beamDepth = req.beamDepth;
	if (req.freeze.length > 0) opts.freeze = req.freeze;

	return opts;
}

/** `RecommendRequest` -> `RecommendTreeOptions`. `objective` is the SCORING spec -> `objectiveFn`,
 * NOT recommendTree's keyword-screen `objective` param (v1 does not expose that). */
export function mapRecommendRequestToOptions(req: RecommendRequest): RecommendTreeOptions {
	const opts: RecommendTreeOptions = {
		objectiveFn: parseObjective(req.objective),
		keepViolating: req.keepViolating,
	};
	if (req.top !== undefined) opts.top = req.top;
	if (req.damageType !== undefined) opts.damageType = req.damageType;
	if (req.nodeTypes !== undefined) opts.nodeTypes = req.nodeTypes;

	const constraints: Record<string, number> = { ...req.constraints };
	if (Object.keys(constraints).length > 0) opts.constraints = constraints;
	if (req.preserveMetrics.length > 0) opts.preserveMetrics = req.preserveMetrics;

	return opts;
}

// --- core result -> DTO --------------------------------------------------------------------

/**
 * `OptimiseTreeResult` (core) -> `OptimiseResultDTO` (contract). Adds `updatedPobCode`, coerces
 * the non-finite fields the schema forbids, and validates the whole thing so a mapper bug is a
 * classified error rather than a malformed 200 body.
 */
export function toOptimiseResultDTO(result: OptimiseTreeResult, originalXml: string): OptimiseResultDTO {
	const dto: OptimiseResultDTO = {
		mode: result.mode,
		baseline: result.baseline,
		pointBudget: result.pointBudget,
		respecBudget: result.respecBudget,
		anchorNodeId: result.anchorNodeId,
		beamWidth: result.beamWidth,
		removed: result.removed.map((r) => ({
			id: r.id,
			name: r.name,
			type: r.type,
			statLines: r.statLines,
			pointsFreed: r.pointsFreed,
			...(r.anchorCascade !== undefined ? { anchorCascade: r.anchorCascade } : {}),
			// Core assigns NaN / +Infinity when the removal makes the build unscorable (e.g. the
			// synthetic anchor entry on a nothing-removable return). [obligation 1]
			objectiveAfterRemoval: toFiniteOrNull(r.objectiveAfterRemoval),
			valueLost: toFiniteOrNull(r.valueLost),
		})),
		steps: result.steps.map((s) => ({
			id: s.id,
			name: s.name,
			type: s.type,
			statLines: s.statLines,
			pointsSpent: s.pointsSpent,
			...(s.pathLength !== undefined ? { pathLength: s.pathLength } : {}),
			objectiveBefore: s.objectiveBefore,
			objectiveAfter: s.objectiveAfter,
			delta: s.delta,
			deltaPerPoint: s.deltaPerPoint,
		})),
		addedNodeIds: result.addedNodeIds,
		allocatedNodeIds: result.allocatedNodeIds,
		pointsFreed: result.pointsFreed,
		pointsRespent: result.pointsRespent,
		final: {
			objective: result.final.objective,
			pointsSpent: result.final.pointsSpent,
			stats: sanitizeStatSet(result.final.stats), // [obligation 2]
		},
		stoppedBecause: result.stoppedBecause,
		buildOutputCount: result.buildOutputCount,
		buildOutputSeconds: result.buildOutputSeconds,
		cacheHitRate: result.cacheHitRate,
		// Straight string-replace of <Spec nodes> from the CONNECTED set. [obligation 3]
		updatedPobCode: encodePobCode(applyPlan(originalXml, result.allocatedNodeIds.after)),
	};

	return OptimiseResultDTOSchema.parse(dto);
}

/** `RecommendedNode[]` (core) -> `RecommendedNodeDTO[]` (contract). Near 1:1; validated. */
export function toRecommendedNodeDTOs(nodes: RecommendedNode[]): RecommendedNodeDTO[] {
	return nodes.map((n) =>
		RecommendedNodeDTOSchema.parse({
			id: n.id,
			name: n.name,
			type: n.type,
			statLines: n.statLines,
			...(n.ascendancyName !== undefined ? { ascendancyName: n.ascendancyName } : {}),
			pointsSpent: n.pointsSpent,
			ascendancyPointsSpent: n.ascendancyPointsSpent,
			delta: n.delta,
			deltaPerPoint: n.deltaPerPoint,
			...(n.damageTypeMatch !== undefined ? { damageTypeMatch: n.damageTypeMatch } : {}),
			...(n.constraintViolation !== undefined ? { constraintViolation: n.constraintViolation } : {}),
		}),
	);
}

// --- progress -----------------------------------------------------------------------------

/**
 * Core progress object -> `ProgressEvent` (contract). Core's `OptimiseProgress` /
 * `RecommendProgress` already call the count `buildOutputs` (not the bridge's
 * `buildOutputCount`) -- [obligation 8]. `jobId` and `elapsedMs` are API-added.
 *
 * `RecommendProgress` carries no `bestObjective`; the contract requires the field, so recommend
 * ticks report 0. (Flagged in the handoff notes -- see the report.)
 */
export function normalizeProgress(
	ev: OptimiseProgress | RecommendProgress,
	jobId: string,
	elapsedMs: number,
): ProgressEvent {
	const anyEv = ev as OptimiseProgress & RecommendProgress;
	const pe: ProgressEvent = {
		jobId,
		phase: String(ev.phase),
		buildOutputs: ev.buildOutputs,
		bestObjective:
			typeof anyEv.bestObjective === "number" && Number.isFinite(anyEv.bestObjective) ? anyEv.bestObjective : 0,
		elapsedMs: Math.max(0, Math.round(elapsedMs)),
	};
	if (anyEv.estimatedTotal !== undefined) pe.estimatedTotal = anyEv.estimatedTotal;
	if (anyEv.depth !== undefined) pe.depth = anyEv.depth;
	if (anyEv.k !== undefined) pe.k = anyEv.k;
	if (anyEv.kTotal !== undefined) pe.kTotal = anyEv.kTotal;
	if (anyEv.candidatesScored !== undefined) pe.candidatesScored = anyEv.candidatesScored;
	if (anyEv.candidatesTotal !== undefined) pe.candidatesTotal = anyEv.candidatesTotal;
	if (anyEv.note !== undefined) pe.note = anyEv.note;
	return pe;
}

// --- error classification ---------------------------------------------------------------------

/**
 * Bucket a thrown error into a `JobError.kind`. `zeroDpsBuild` is the caller's own read of the
 * loaded build (from its summary notes) -- core throws the same "cannot score the baseline"
 * message whether the objective is broken or the build simply does 0 DPS.
 */
export function classifyError(err: unknown, jobId: string, opts: { zeroDpsBuild?: boolean } = {}): JobError {
	const message = err instanceof Error ? err.message : String(err);

	if (/bridge process (exited|error)|before responding/i.test(message)) {
		return { jobId, kind: "bridge-crash", message };
	}
	if (/cannot score the (loaded )?build|could not score the build's baseline|no finite ".*" to rank/i.test(message)) {
		return { jobId, kind: opts.zeroDpsBuild ? "zero-dps-build" : "unscoreable-objective", message };
	}
	if (/objective weight must be|unrecognised objective spec|objective "blend/i.test(message)) {
		return { jobId, kind: "unscoreable-objective", message };
	}
	return { jobId, kind: "internal", message };
}
