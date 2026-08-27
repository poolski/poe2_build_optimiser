// Multi-step passive-tree planner -- the successor to the single-pass greedy `recommendTree`.
// See docs/beam-search-design.md for the full design (greedy-seed + local beam repair).
//
// STATUS: extend mode only. Extend mode = "start from the tree as loaded, tell me which nodes to
// allocate next, in order" -- a pure greedy walk outward from the current frontier, bounded by a
// point budget and a proximity radius. It needs no new bridge RPCs beyond those already shipped
// (list_allocatable_nodes_from, evaluate_candidate_nodes_from). Repair mode (respecBudget > 0 --
// free the lowest-value allocated points and beam-search replacements) is not implemented here
// yet; it needs a dealloc-measurement RPC and an arbitrary-allocation evaluation RPC, plus two
// PoB-internal behaviours verified (see the design doc's step 7 and open questions). optimiseTree
// throws if asked for it.

import { PobBridgeClient } from "./bridge";
import { MemoEvaluator } from "./evaluator";
import { metricObjective, Objective } from "./objective";
import {
	AllocatableNode,
	ConstraintViolation,
	filterByProximity,
	firstConstraintViolation,
	resolveFloors,
	TreeStatus,
} from "./recommendTree";
import { StatSet } from "./stats";

const DEFAULT_TARGET_METRIC = "TotalDPS";
const DEFAULT_PROXIMITY = 3;
const DEFAULT_NODE_TYPES = ["Notable", "Keystone"];

export interface OptimiseTreeOptions {
	/** mainOutput key to score on. Ignored when `objectiveFn` is given. Default "TotalDPS". */
	targetMetric?: string;
	/** A scoring function over measured stats (see `./objective`) -- e.g. a DPS/EHP log blend.
	 * Takes precedence over `targetMetric`. If it can't score the baseline, optimiseTree throws. */
	objectiveFn?: Objective;
	/** Node types eligible for allocation. Default Notable+Keystone. */
	nodeTypes?: string[];
	/** Evaluate every node type (ignores `nodeTypes`). */
	includeAllNodeTypes?: boolean;
	/** Absolute mainOutput floors; a step that would break one (per `firstConstraintViolation`,
	 * judged against the *loaded baseline*) is skipped. */
	constraints?: Record<string, number>;
	/** Each listed metric gets an implicit floor at its loaded-baseline value (no regression). */
	preserveMetrics?: string[];
	/** Total regular skill points the finished plan may occupy (already-allocated + newly added).
	 * The walk stops when this is reached. Default = the build's current `pointsUsed`, i.e. "I
	 * have no more points" -> extend mode returns nothing. Pass a larger value (or a level's worth)
	 * to plan ahead. */
	pointBudget?: number;
	/** Reserved: > 0 selects repair mode, which is not implemented yet (optimiseTree throws).
	 * 0 / unset = extend mode. */
	respecBudget?: number;
	/** Max `pathLength` for a node to be considered at each step -- keeps the walk local and caps
	 * path-node drag-in. Default 3. */
	proximity?: number;
	/** Per-step candidate cap after the keyword/proximity screens (dev knob; each candidate is a
	 * real recompute). Unset = evaluate all that survive the screens. */
	maxCandidatesPerStep?: number;
	/** Objective keyword screen on the per-step candidate pool: keep only nodes whose stat lines
	 * mention one of these (case-insensitive substring). Mirrors recommendTree's `objective`
	 * filter mode; omit for no screen. */
	keywords?: string[];
	/** Nodes containing any of these are dropped even if they matched `keywords`. */
	excludeKeywords?: string[];
}

export interface OptimiseStep {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	/** Points this step actually cost (the node + any path nodes AllocNode dragged in). */
	pointsSpent: number;
	pathLength?: number;
	/** Objective value of the plan-so-far before and after this step. */
	objectiveBefore: number;
	objectiveAfter: number;
	delta: number;
	deltaPerPoint: number;
}

export interface OptimiseTreeResult {
	mode: "extend";
	baseline: { objective: number; pointsUsed: number; pointsMax: number };
	pointBudget: number;
	/** The nodes to allocate, in order. */
	steps: OptimiseStep[];
	/** Anchor node ids of `steps` (path nodes AllocNode adds are not listed individually). */
	addedNodeIds: number[];
	final: { objective: number; pointsSpent: number; stats: StatSet };
	/** Why the walk stopped. */
	stoppedBecause: "budget-reached" | "no-positive-candidate" | "no-candidates" | "nothing-to-do";
	/** Populated when the bridge exposes get_metrics (real BuildOutput recomputes this run). */
	buildOutputCount?: number;
	cacheHitRate: number;
}

export async function optimiseTree(
	bridge: PobBridgeClient,
	options: OptimiseTreeOptions = {},
): Promise<OptimiseTreeResult> {
	if ((options.respecBudget ?? 0) > 0) {
		throw new Error(
			"optimiseTree: repair mode (respecBudget > 0) is not implemented yet -- see docs/beam-search-design.md step 7. Use respecBudget 0 (extend mode).",
		);
	}

	const score: Objective = options.objectiveFn ?? metricObjective(options.targetMetric ?? DEFAULT_TARGET_METRIC);
	const proximity = options.proximity ?? DEFAULT_PROXIMITY;

	const baseline = await bridge.call<StatSet>("get_stats");
	const baselineObjective = score(baseline);
	if (baselineObjective === undefined) {
		throw new Error("optimiseTree: the objective cannot score the loaded build's baseline stats");
	}

	const status = await bridge.call<TreeStatus>("get_tree_status");
	const pointBudget = options.pointBudget ?? status.pointsUsed;
	const headroom = pointBudget - status.pointsUsed;

	const floors = resolveFloors(baseline, options);
	const hasConstraints = Object.keys(floors).length > 0;

	const nodeTypeFilter = options.includeAllNodeTypes
		? undefined
		: new Set(options.nodeTypes ?? DEFAULT_NODE_TYPES);
	const keywords = options.keywords;
	const excludeKeywords = options.excludeKeywords;

	const memo = new MemoEvaluator(bridge);
	const baseResult: OptimiseTreeResult = {
		mode: "extend",
		baseline: { objective: baselineObjective, pointsUsed: status.pointsUsed, pointsMax: status.pointsMax },
		pointBudget,
		steps: [],
		addedNodeIds: [],
		final: { objective: baselineObjective, pointsSpent: 0, stats: baseline },
		stoppedBecause: "nothing-to-do",
		cacheHitRate: 0,
	};
	if (headroom <= 0) {
		return withMetrics(bridge, memo, baseResult);
	}

	const added: number[] = [];
	const steps: OptimiseStep[] = [];
	let currentObjective = baselineObjective;
	let currentStats = baseline;
	let spent = 0;
	let stoppedBecause: OptimiseTreeResult["stoppedBecause"] = "budget-reached";

	while (spent < headroom) {
		const remaining = headroom - spent;
		const { nodes: rawPool } = await bridge.call<{ nodes: AllocatableNode[] }>("list_allocatable_nodes_from", {
			allocSet: added,
			maxPathLength: proximity,
			types: nodeTypeFilter ? [...nodeTypeFilter] : undefined,
		});

		let pool = [...rawPool].sort((a, b) => a.id - b.id);
		pool = filterByProximity(pool, proximity); // server already gates, but be robust to older bridges
		if (keywords && keywords.length > 0) {
			pool = pool.filter(
				(n) =>
					matchesAny(n.statLines, keywords) &&
					!(excludeKeywords && excludeKeywords.length > 0 && matchesAny(n.statLines, excludeKeywords)),
			);
		}
		if (options.maxCandidatesPerStep !== undefined) {
			pool = pool.slice(0, options.maxCandidatesPerStep);
		}
		if (pool.length === 0) {
			stoppedBecause = steps.length === 0 ? "no-candidates" : "no-positive-candidate";
			break;
		}

		const evals = await memo.evaluateFrom(
			added,
			pool.map((n) => n.id),
		);
		const poolById = new Map(pool.map((n) => [n.id, n]));

		let best:
			| { node: AllocatableNode; pointsSpent: number; stats: StatSet; objective: number; deltaPerPoint: number }
			| undefined;
		for (const ev of evals) {
			if (ev.pointsSpent <= 0 || ev.pointsSpent > remaining) continue;
			if (ev.ascendancyPointsSpent > 0) continue; // extend mode plans regular points only
			if (hasConstraints && firstConstraintViolation(floors, baseline, ev.stats)) continue;
			const objective = score(ev.stats);
			if (objective === undefined) continue;
			const deltaPerPoint = (objective - currentObjective) / ev.pointsSpent;
			const node = poolById.get(ev.nodeId);
			if (!node) continue;
			if (
				!best ||
				deltaPerPoint > best.deltaPerPoint ||
				(deltaPerPoint === best.deltaPerPoint && node.id < best.node.id)
			) {
				best = { node, pointsSpent: ev.pointsSpent, stats: ev.stats, objective, deltaPerPoint };
			}
		}

		if (!best || best.objective - currentObjective <= 0) {
			stoppedBecause = "no-positive-candidate";
			break;
		}

		steps.push({
			id: best.node.id,
			name: best.node.name,
			type: best.node.type,
			statLines: best.node.statLines,
			pointsSpent: best.pointsSpent,
			pathLength: best.node.pathLength,
			objectiveBefore: currentObjective,
			objectiveAfter: best.objective,
			delta: best.objective - currentObjective,
			deltaPerPoint: best.deltaPerPoint,
		});
		added.push(best.node.id);
		spent += best.pointsSpent;
		currentObjective = best.objective;
		currentStats = best.stats;
	}

	return withMetrics(bridge, memo, {
		...baseResult,
		steps,
		addedNodeIds: added,
		final: { objective: currentObjective, pointsSpent: spent, stats: currentStats },
		stoppedBecause: steps.length === 0 ? (stoppedBecause === "budget-reached" ? "nothing-to-do" : stoppedBecause) : stoppedBecause,
	});
}

function matchesAny(statLines: string[], keywords: string[]): boolean {
	const text = statLines.join(" ").toLowerCase();
	return keywords.some((k) => text.includes(k.toLowerCase()));
}

async function withMetrics(
	bridge: PobBridgeClient,
	memo: MemoEvaluator,
	result: OptimiseTreeResult,
): Promise<OptimiseTreeResult> {
	result.cacheHitRate = memo.hitRate;
	try {
		const metrics = await bridge.call<{ buildOutputCount: number }>("get_metrics");
		result.buildOutputCount = metrics.buildOutputCount;
	} catch {
		// older bridge without the counter -- leave buildOutputCount undefined
	}
	return result;
}

export type { ConstraintViolation };
