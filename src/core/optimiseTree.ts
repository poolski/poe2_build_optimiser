// Multi-step passive-tree planner -- the successor to the single-pass greedy `recommendTree`.
// See docs/beam-search-design.md for the full design (greedy-seed + local beam repair).
//
// STATUS: extend mode + any-node (cascading) repair mode.
//
// Extend mode (respecBudget 0 / unset) = "start from the tree as loaded, tell me which nodes to
// allocate next, in order" -- a pure greedy walk outward from the current frontier, bounded by a
// point budget and a proximity radius.
//
// Repair mode (respecBudget > 0) = free some of the lowest-value *allocated regular nodes* and
// re-spend the points. Removing a node deallocs it plus everything only connected through it
// (`DeallocNode` cascades; verified in docs/gotchas.md), so one removal can free >1 point; a leaf
// frees exactly one. `respecBudget` is a ceiling on *points* relocated. Candidates are ranked by
// objective value lost, then a greedy knapsack in that order picks the set whose cumulative
// pointsFreed fits the budget; the driver then sweeps k = 1..N over that ranked set and keeps the
// best repaired plan, because committing the whole budget in one shot is non-monotonic (a bigger
// respec can yield a worse plan, especially now that one removal can cascade many points off).
// Re-spend uses the same add-loop as extend (greedy at `beamWidth` 1, a width-`W` beam above
// that), measured against the post-removal tree via the `removeIds` prologue on the eval RPCs.
// Returns whichever is better, the loaded tree or the best repaired one -- so it can always fall
// back to "change nothing". See the design doc's step 7.

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
	/** Absolute mainOutput floors; a step that would break one is skipped. In extend mode the "does
	 * this floor currently hold" reference is the loaded baseline; in repair mode it is the
	 * re-spend walk's running stats (so the walk may recover a deficit the removal opened), with a
	 * final check of the whole repaired plan against the loaded baseline. */
	constraints?: Record<string, number>;
	/** Each listed metric gets an implicit floor at its loaded-baseline value (no regression). */
	preserveMetrics?: string[];
	/** Total regular skill points the finished plan may occupy (already-allocated + newly added).
	 * The walk stops when this is reached. Default = the build's current `pointsUsed`, i.e. "I
	 * have no more points" -> extend mode returns nothing. Pass a larger value (or a level's worth)
	 * to plan ahead. In repair mode this caps the re-spend at `min(respecBudget-freed, headroom)`;
	 * the default (no headroom) still lets repair re-spend exactly what it freed. */
	pointBudget?: number;
	/** > 0 selects repair mode. A *ceiling* on the number of already-allocated points relocated:
	 * candidates (any regular node, leaf or interior) are ranked by objective value lost, a greedy
	 * knapsack in that order picks the set whose cascades fit the ceiling, and the driver sweeps
	 * k = 1..N over it, re-spending each prefix and keeping the best plan (ties to the smaller k).
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
	/** Beam width for the add-loop (extend walk / repair re-spend). 1 (default) = the original
	 * greedy walk: one best-`deltaPerPoint` pick per step. >1 keeps that many partial plans in
	 * parallel and returns whichever ends highest -- lets the search survive a step whose locally
	 * best move is a dead end. Each unit of width is ~one extra pool-list + eval batch per depth
	 * (the layer-5 memo dedups states that reconverge). */
	beamWidth?: number;
	/** Max number of add-steps the beam may take. Unset = bounded only by the point budget
	 * (`headroom`). Mainly a cost knob for wide beams. */
	beamDepth?: number;
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

/** An allocated node the repair pass deallocated to free its point(s). */
export interface RemovedNode {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	/** Points freed by removing this node: 1 for a leaf, more for an interior node whose
	 * downstream cascades off with it (`DeallocNode` semantics). */
	pointsFreed: number;
	/** Objective with just this node (and its cascade) removed from the loaded tree. */
	objectiveAfterRemoval: number;
	/** baselineObjective - objectiveAfterRemoval. Negative = removing it *helped* the objective. */
	valueLost: number;
}

export interface OptimiseTreeResult {
	mode: "extend" | "repair";
	baseline: { objective: number; pointsUsed: number; pointsMax: number };
	pointBudget: number;
	/** Present in repair mode: the respec budget the caller asked for. */
	respecBudget?: number;
	/** Echoed when a beam wider than 1 was used for the add-loop. */
	beamWidth?: number;
	/** Repair mode: the nodes freed, most-expendable first. Empty in extend mode. */
	removed: RemovedNode[];
	/** The nodes to allocate, in order (repair mode: the re-spend of the freed points). */
	steps: OptimiseStep[];
	/** Anchor node ids of `steps` (path nodes AllocNode adds are not listed individually). */
	addedNodeIds: number[];
	/** Repair mode: points freed by `removed`, and points the re-spend actually consumed. */
	pointsFreed: number;
	pointsRespent: number;
	/** `objective` is always the value of the plan this result recommends (the loaded baseline when
	 * the recommendation is "change nothing"). `pointsSpent` is the net point delta vs the loaded
	 * tree -- 0 or negative in repair mode, >= 0 in extend mode. */
	final: { objective: number; pointsSpent: number; stats: StatSet };
	/** Why the walk stopped / what the recommendation is. */
	stoppedBecause:
		| "budget-reached"
		| "no-positive-candidate"
		| "no-candidates"
		| "nothing-to-do"
		| "nothing-removable"
		| "repair-not-worthwhile";
	/** Populated when the bridge exposes get_metrics (real BuildOutput recomputes this run). */
	buildOutputCount?: number;
	/** Cumulative seconds the bridge spent inside recomputeBuild() this run (bridge-side os.clock,
	 * so free of transport / search-overhead noise). `buildOutputSeconds / buildOutputCount` is the
	 * per-recompute cost. Undefined against an older bridge without the timer. */
	buildOutputSeconds?: number;
	cacheHitRate: number;
}

interface DeallocResult {
	nodeId: number;
	pointsFreed: number;
	ascendancyPointsFreed: number;
	stats: StatSet;
}

interface AllocatedNode {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	ascendancyName?: string;
}

interface AddLoopParams {
	bridge: PobBridgeClient;
	memo: MemoEvaluator;
	score: Objective;
	floors: Record<string, number>;
	/** Reference for "does this floor currently hold" -- see OptimiseTreeOptions.constraints. */
	constraintReference: "loaded" | "walk-state";
	loadedBaseline: StatSet;
	nodeTypeFilter: Set<string> | undefined;
	keywords: string[] | undefined;
	excludeKeywords: string[] | undefined;
	proximity: number;
	maxCandidatesPerStep: number | undefined;
	/** Partial plans kept in parallel. 1 = the original greedy walk. */
	beamWidth: number;
	/** Hard cap on add-steps; undefined = bounded only by `headroom`. */
	beamDepth: number | undefined;
	/** Points the walk may spend. */
	headroom: number;
	/** Nodes deallocated before measuring (repair mode); [] in extend mode. Each may cascade
	 * downstream, so this is not necessarily the count of points freed. */
	removeIds: number[];
	startObjective: number;
	startStats: StatSet;
}

interface AddLoopOutcome {
	steps: OptimiseStep[];
	added: number[];
	spent: number;
	finalObjective: number;
	finalStats: StatSet;
	stoppedBecause: "budget-reached" | "no-positive-candidate" | "no-candidates";
}

export async function optimiseTree(
	bridge: PobBridgeClient,
	options: OptimiseTreeOptions = {},
): Promise<OptimiseTreeResult> {
	const score: Objective = options.objectiveFn ?? metricObjective(options.targetMetric ?? DEFAULT_TARGET_METRIC);
	const proximity = options.proximity ?? DEFAULT_PROXIMITY;
	const respecBudget = Math.max(0, Math.trunc(options.respecBudget ?? 0));

	const baseline = await bridge.call<StatSet>("get_stats");
	const baselineObjective = score(baseline);
	if (baselineObjective === undefined) {
		throw new Error("optimiseTree: the objective cannot score the loaded build's baseline stats");
	}

	const status = await bridge.call<TreeStatus>("get_tree_status");
	const pointBudget = options.pointBudget ?? status.pointsUsed;
	const extendHeadroom = pointBudget - status.pointsUsed;

	const floors = resolveFloors(baseline, options);

	const nodeTypeFilter = options.includeAllNodeTypes ? undefined : new Set(options.nodeTypes ?? DEFAULT_NODE_TYPES);

	const beamWidth = Math.max(1, Math.trunc(options.beamWidth ?? 1));

	const memo = new MemoEvaluator(bridge);
	const skeleton = {
		baseline: { objective: baselineObjective, pointsUsed: status.pointsUsed, pointsMax: status.pointsMax },
		pointBudget,
		beamWidth: beamWidth > 1 ? beamWidth : undefined,
		removed: [] as RemovedNode[],
		steps: [] as OptimiseStep[],
		addedNodeIds: [] as number[],
		pointsFreed: 0,
		pointsRespent: 0,
		cacheHitRate: 0,
	};

	const commonLoopParams = {
		bridge,
		memo,
		score,
		floors,
		loadedBaseline: baseline,
		nodeTypeFilter,
		keywords: options.keywords,
		excludeKeywords: options.excludeKeywords,
		proximity,
		maxCandidatesPerStep: options.maxCandidatesPerStep,
		beamWidth,
		beamDepth: options.beamDepth !== undefined ? Math.max(1, Math.trunc(options.beamDepth)) : undefined,
	};

	if (respecBudget === 0) {
		// ---- extend mode ----
		if (extendHeadroom <= 0) {
			return withMetrics(bridge, memo, {
				...skeleton,
				mode: "extend",
				final: { objective: baselineObjective, pointsSpent: 0, stats: baseline },
				stoppedBecause: "nothing-to-do",
			});
		}
		const loop = await beamAddLoop({
			...commonLoopParams,
			constraintReference: "loaded",
			headroom: extendHeadroom,
			removeIds: [],
			startObjective: baselineObjective,
			startStats: baseline,
		});
		const stoppedBecause =
			loop.steps.length === 0
				? loop.stoppedBecause === "budget-reached"
					? "nothing-to-do"
					: loop.stoppedBecause
				: loop.stoppedBecause;
		return withMetrics(bridge, memo, {
			...skeleton,
			mode: "extend",
			steps: loop.steps,
			addedNodeIds: loop.added,
			final: { objective: loop.finalObjective, pointsSpent: loop.spent, stats: loop.finalStats },
			stoppedBecause,
		});
	}

	// ---- repair mode (any allocated regular node; removal cascades) ----
	const noChange = (
		reason: OptimiseTreeResult["stoppedBecause"],
		removed: RemovedNode[] = [],
	): Promise<OptimiseTreeResult> =>
		withMetrics(bridge, memo, {
			...skeleton,
			mode: "repair",
			respecBudget,
			removed,
			final: { objective: baselineObjective, pointsSpent: 0, stats: baseline },
			stoppedBecause: reason,
		});

	const { nodes: allocated } = await bridge.call<{ nodes: AllocatedNode[] }>("list_allocated_nodes");
	const regularIds = allocated.filter((n) => !n.ascendancyName).map((n) => n.id);
	if (regularIds.length === 0) {
		return noChange("nothing-removable");
	}

	const { results: deallocs } = await bridge.call<{ results: DeallocResult[] }>("evaluate_dealloc_candidates", {
		nodeIds: regularIds,
	});
	const nodeById = new Map(allocated.map((n) => [n.id, n]));

	// Every removable regular node (leaf or interior). `pointsFreed` is the whole cascade: the node
	// plus everything only connected to the tree through it (DeallocNode semantics, docs/gotchas.md).
	const candidates: RemovedNode[] = [];
	for (const d of deallocs) {
		if (d.ascendancyPointsFreed !== 0 || d.pointsFreed < 1) continue; // repair stays on the regular pool
		const meta = nodeById.get(d.nodeId);
		if (!meta) continue;
		const objAfter = score(d.stats);
		// A node whose removal makes the build unscorable (e.g. drops DPS to 0) is never expendable.
		const valueLost = objAfter === undefined ? Number.POSITIVE_INFINITY : baselineObjective - objAfter;
		candidates.push({
			id: d.nodeId,
			name: meta.name,
			type: meta.type,
			statLines: meta.statLines,
			pointsFreed: d.pointsFreed,
			objectiveAfterRemoval: objAfter ?? Number.NaN,
			valueLost,
		});
	}

	// Least value lost first (negative = removing it helps); id tie-break for determinism. Then a
	// greedy knapsack in that order: take a candidate if its whole cascade still fits under the
	// `respecBudget` points ceiling, else skip it and keep scanning for a smaller one that fits.
	// (For an all-leaves tree this is exactly the old "first `respecBudget` leaves".)
	candidates.sort((a, b) => a.valueLost - b.valueLost || a.id - b.id);
	const dropped: RemovedNode[] = [];
	let droppedPoints = 0;
	for (const c of candidates) {
		if (!Number.isFinite(c.valueLost)) continue;
		if (droppedPoints + c.pointsFreed > respecBudget) continue;
		dropped.push(c);
		droppedPoints += c.pointsFreed;
	}
	if (dropped.length === 0) {
		return noChange("nothing-removable");
	}

	// Sweep k = 1..dropped.length and keep the best repaired plan. Committing the whole budget in
	// one shot is non-monotonic: the deepest few in the value-lost ranking may not really be
	// expendable (the ranking scores each removal in isolation, and the proximity-bounded re-spend
	// can't always path back to a good replacement), so a bigger respec can yield a worse -- or
	// sub-baseline, hence no-change -- plan than a smaller one. This is sharper now that one interior
	// removal can cascade many points off in a single sweep step. `respecBudget` is a ceiling, not a
	// target. Cost: up to `dropped.length` re-spend walks; the one-time dealloc probe above is
	// shared. Ties go to the smaller k (less respec currency spent) via the strict `>` + ascending k.
	const extendHeadroomPos = Math.max(0, extendHeadroom);
	let bestK = 0;
	let bestLoop: AddLoopOutcome | undefined;
	let bestFreed = 0;
	for (let k = 1; k <= dropped.length; k++) {
		const kDropped = dropped.slice(0, k);
		const kDroppedIds = kDropped.map((l) => l.id);
		const kPointsFreed = kDropped.reduce((s, l) => s + l.pointsFreed, 0);
		const kPostRemoval = await memo.statsFrom([], kDroppedIds);
		const kPostRemovalObjective = score(kPostRemoval.stats);
		if (kPostRemovalObjective === undefined) continue; // removing these k makes the build unscorable

		const kLoop = await beamAddLoop({
			...commonLoopParams,
			constraintReference: "walk-state",
			headroom: kPointsFreed + extendHeadroomPos,
			removeIds: kDroppedIds,
			startObjective: kPostRemovalObjective,
			startStats: kPostRemoval.stats,
		});

		// Whole-plan gate vs the loaded baseline: a preserved metric must not end up regressed, even
		// though the walk was allowed to dip below it mid-way.
		if (Object.keys(floors).length > 0 && firstConstraintViolation(floors, baseline, kLoop.finalStats)) {
			continue;
		}
		// Only a plan that beats the loaded tree outright and actually allocated something counts.
		if (kLoop.finalObjective <= baselineObjective || kLoop.steps.length === 0) continue;

		if (!bestLoop || kLoop.finalObjective > bestLoop.finalObjective) {
			bestK = k;
			bestLoop = kLoop;
			bestFreed = kPointsFreed;
		}
	}

	if (!bestLoop) {
		return noChange("repair-not-worthwhile", dropped);
	}

	const usedRemovals = dropped.slice(0, bestK);
	return withMetrics(bridge, memo, {
		...skeleton,
		mode: "repair",
		respecBudget,
		removed: usedRemovals,
		steps: bestLoop.steps,
		addedNodeIds: bestLoop.added,
		pointsFreed: bestFreed,
		pointsRespent: bestLoop.spent,
		final: {
			objective: bestLoop.finalObjective,
			pointsSpent: bestLoop.spent - bestFreed,
			stats: bestLoop.finalStats,
		},
		stoppedBecause: bestLoop.stoppedBecause,
	});
}

/** One partial plan the beam is carrying. */
interface BeamState {
	added: number[];
	steps: OptimiseStep[];
	spent: number;
	objective: number;
	stats: StatSet;
}

/** A candidate one-step extension of a `BeamState`. */
interface Expansion {
	parent: BeamState;
	node: AllocatableNode;
	pointsSpent: number;
	stats: StatSet;
	objective: number;
	deltaPerPoint: number;
}

/** Lexicographic compare of two ascending int arrays -- a deterministic total order over states. */
function cmpIntArray(a: number[], b: number[]): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return a.length - b.length;
}

/** All improving one-step extensions of `state`, ranked exactly as the old greedy picked its single
 * best: `deltaPerPoint` desc, then node id asc. `stopReason` is set when there are none. */
async function expandState(
	p: AddLoopParams,
	state: BeamState,
	hasConstraints: boolean,
): Promise<{ expansions: Expansion[]; stopReason?: AddLoopOutcome["stoppedBecause"] }> {
	const remaining = p.headroom - state.spent;
	const listParams: Record<string, unknown> = {
		allocSet: state.added,
		maxPathLength: p.proximity,
		types: p.nodeTypeFilter ? [...p.nodeTypeFilter] : undefined,
	};
	if (p.removeIds.length > 0) listParams.removeIds = p.removeIds;
	const { nodes: rawPool } = await p.bridge.call<{ nodes: AllocatableNode[] }>("list_allocatable_nodes_from", listParams);

	let pool = [...rawPool].sort((a, b) => a.id - b.id);
	pool = filterByProximity(pool, p.proximity); // server already gates, but be robust to older bridges
	if (p.keywords && p.keywords.length > 0) {
		pool = pool.filter(
			(n) =>
				matchesAny(n.statLines, p.keywords!) &&
				!(p.excludeKeywords && p.excludeKeywords.length > 0 && matchesAny(n.statLines, p.excludeKeywords)),
		);
	}
	if (p.maxCandidatesPerStep !== undefined) {
		pool = pool.slice(0, p.maxCandidatesPerStep);
	}
	if (pool.length === 0) {
		return { expansions: [], stopReason: state.steps.length === 0 ? "no-candidates" : "no-positive-candidate" };
	}

	const evals = await p.memo.evaluateFrom(
		state.added,
		pool.map((n) => n.id),
		p.removeIds,
	);
	const poolById = new Map(pool.map((n) => [n.id, n]));
	const constraintRef = p.constraintReference === "walk-state" ? state.stats : p.loadedBaseline;

	const expansions: Expansion[] = [];
	for (const ev of evals) {
		if (ev.pointsSpent <= 0 || ev.pointsSpent > remaining) continue;
		if (ev.ascendancyPointsSpent > 0) continue; // regular points only
		if (hasConstraints && firstConstraintViolation(p.floors, constraintRef, ev.stats)) continue;
		const objective = p.score(ev.stats);
		if (objective === undefined) continue;
		if (objective - state.objective <= 0) continue; // only improving moves, same as the old greedy
		const node = poolById.get(ev.nodeId);
		if (!node) continue;
		expansions.push({
			parent: state,
			node,
			pointsSpent: ev.pointsSpent,
			stats: ev.stats,
			objective,
			deltaPerPoint: (objective - state.objective) / ev.pointsSpent,
		});
	}
	expansions.sort((a, b) => b.deltaPerPoint - a.deltaPerPoint || a.node.id - b.node.id);
	return { expansions, stopReason: expansions.length === 0 ? "no-positive-candidate" : undefined };
}

/** Beam add-loop shared by extend and repair. Keeps `p.beamWidth` partial plans in parallel; each
 * depth, every live plan proposes its improving extensions, all proposals are pooled, de-duplicated
 * by resulting allocation set, and the top `beamWidth` (by `deltaPerPoint`, id tie-break) carry
 * forward. Returns whichever plan -- terminal or survivor -- ends with the highest objective (ties:
 * fewer points spent, then fewer steps, then lexicographic node ids). `beamWidth === 1` reduces to
 * the original greedy walk exactly. `removeIds` (repair) is threaded through every bridge call so
 * measurements are against "loaded minus those nodes (and their cascades)". */
async function beamAddLoop(p: AddLoopParams): Promise<AddLoopOutcome> {
	const hasConstraints = Object.keys(p.floors).length > 0;
	const width = Math.max(1, p.beamWidth);
	const maxDepth = p.beamDepth ?? p.headroom;

	const initial: BeamState = {
		added: [],
		steps: [],
		spent: 0,
		objective: p.startObjective,
		stats: p.startStats,
	};

	// Prefer a higher objective; break ties deterministically so the result never depends on beam
	// iteration order.
	const better = (a: BeamState, b: BeamState): boolean => {
		if (a.objective !== b.objective) return a.objective > b.objective;
		if (a.spent !== b.spent) return a.spent < b.spent;
		if (a.steps.length !== b.steps.length) return a.steps.length < b.steps.length;
		return cmpIntArray([...a.added].sort((x, y) => x - y), [...b.added].sort((x, y) => x - y)) < 0;
	};

	let beam: BeamState[] = [initial];
	let best = initial;
	let bestStop: AddLoopOutcome["stoppedBecause"] = "budget-reached";
	const consider = (state: BeamState, stop: AddLoopOutcome["stoppedBecause"]) => {
		if (better(state, best)) {
			best = state;
			bestStop = stop;
		}
	};

	for (let depth = 0; depth < maxDepth && beam.length > 0; depth++) {
		const proposals: Expansion[] = [];
		for (const state of beam) {
			if (state.spent >= p.headroom) {
				consider(state, "budget-reached");
				continue;
			}
			const { expansions, stopReason } = await expandState(p, state, hasConstraints);
			if (expansions.length === 0) {
				consider(state, stopReason ?? "no-positive-candidate");
				continue;
			}
			proposals.push(...expansions);
		}
		if (proposals.length === 0) break; // every live plan is terminal

		proposals.sort(
			(a, b) =>
				b.deltaPerPoint - a.deltaPerPoint ||
				a.node.id - b.node.id ||
				cmpIntArray(a.parent.added, b.parent.added),
		);

		const seen = new Set<string>();
		const nextBeam: BeamState[] = [];
		for (const e of proposals) {
			const key = [...e.parent.added, e.node.id].sort((x, y) => x - y).join(",");
			if (seen.has(key)) continue;
			seen.add(key);
			nextBeam.push({
				added: [...e.parent.added, e.node.id],
				steps: [
					...e.parent.steps,
					{
						id: e.node.id,
						name: e.node.name,
						type: e.node.type,
						statLines: e.node.statLines,
						pointsSpent: e.pointsSpent,
						pathLength: e.node.pathLength,
						objectiveBefore: e.parent.objective,
						objectiveAfter: e.objective,
						delta: e.objective - e.parent.objective,
						deltaPerPoint: e.deltaPerPoint,
					},
				],
				spent: e.parent.spent + e.pointsSpent,
				objective: e.objective,
				stats: e.stats,
			});
			if (nextBeam.length === width) break;
		}
		beam = nextBeam;
	}

	// Whatever is still alive at the depth / loop limit is also a candidate final plan.
	for (const state of beam) consider(state, "budget-reached");

	return {
		steps: best.steps,
		added: best.added,
		spent: best.spent,
		finalObjective: best.objective,
		finalStats: best.stats,
		stoppedBecause: bestStop,
	};
}

function matchesAny(statLines: string[], keywords: string[]): boolean {
	const text = statLines.join(" ").toLowerCase();
	return keywords.some((k) => text.includes(k.toLowerCase()));
}

async function withMetrics(
	bridge: PobBridgeClient,
	memo: MemoEvaluator,
	result: Omit<OptimiseTreeResult, "cacheHitRate" | "buildOutputCount" | "buildOutputSeconds"> & {
		cacheHitRate?: number;
	},
): Promise<OptimiseTreeResult> {
	const out = result as OptimiseTreeResult;
	out.cacheHitRate = memo.hitRate;
	try {
		const metrics = await bridge.call<{ buildOutputCount: number; buildOutputSeconds?: number }>("get_metrics");
		out.buildOutputCount = metrics.buildOutputCount;
		out.buildOutputSeconds = metrics.buildOutputSeconds;
	} catch {
		// older bridge without the counter -- leave buildOutputCount / buildOutputSeconds undefined
	}
	return out;
}

export type { ConstraintViolation };
