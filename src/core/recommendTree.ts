// Greedy "best next points to allocate" passive-tree recommender: for every currently
// connectable, unallocated node, measure its real stat delta and point cost against the
// loaded build's own calc engine, then rank by delta-per-point. No search beyond one pass
// over the current candidate pool -- this is the mutation/measurement primitive a future
// full re-optimization search would reuse, not that search itself.

import { PobBridgeClient } from "@poe2/pob-bridge";
import { Objective } from "./objective";
import { asNumber, finiteNumber, StatSet } from "./stats";

export { asNumber, StatSet };

export interface TreeStatus {
	/**
	 * Normal passive points spent, mirroring PoB's own "X / Y" display:
	 * `treeNodesAllocated - min(weaponSet1PointsUsed, weaponSet2PointsUsed)`. Weapon-set-specific
	 * nodes draw on a separate budget and are excluded here (see `bridge.lua` get_tree_status).
	 */
	pointsUsed: number;
	pointsMax: number;
	ascendancyPointsUsed: number;
	ascendancyPointsMax: number;
	secondaryAscendancyPointsUsed: number;
	secondaryAscendancyPointsMax: number;
	/** Nodes allocated for weapon set 1 (allocMode 1). Drawn from `weaponSetPointsMax`, not `pointsMax`. */
	weaponSet1PointsUsed: number;
	/** Nodes allocated for weapon set 2 (allocMode 2). Drawn from `weaponSetPointsMax`, not `pointsMax`. */
	weaponSet2PointsUsed: number;
	/** Per-weapon-set point budget: `questPoints + PassivePointsToWeaponSetPoints`. */
	weaponSetPointsMax: number;
	/** Raw allocated regular-tree node count before the weapon-set correction (debugging/provenance). */
	treeNodesAllocated: number;
}

export interface AllocatableNode {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	ascendancyName?: string;
	/** #node.path: points AllocNode would spend to connect this node from the tree as currently
	 * allocated (the node itself plus every intermediate path node it drags in). 1 for a
	 * frontier-adjacent node, higher for a distant one. Used by beam search for proximity gating.
	 * Optional so the fake bridge in tests can omit it. */
	pathLength?: number;
}

interface CandidateResult {
	nodeId: number;
	pointsSpent: number;
	ascendancyPointsSpent: number;
	stats: StatSet;
}

/** A constrained metric this node would push the wrong way -- see RecommendTreeOptions.constraints.
 * `baseline`/`candidate` are the real measured mainOutput values before and after allocating the
 * node (plus any path nodes it drags in); `floor` is the threshold that was violated. */
export interface ConstraintViolation {
	metric: string;
	floor: number;
	baseline: number;
	candidate: number;
}

export interface RecommendedNode {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	ascendancyName?: string;
	pointsSpent: number;
	ascendancyPointsSpent: number;
	delta: number;
	deltaPerPoint: number;
	/** Only present when options.damageType was given: whether this node's own stat lines
	 * textually matched that damage type. Purely informational -- ranking is always by the
	 * real measured deltaPerPoint, never by this match, since a generic "increased damage"
	 * node can genuinely outscore an on-type one once measured. */
	damageTypeMatch?: boolean;
	/** Set only when the node violates a constraint AND options.dropViolating was false (a
	 * violating node is dropped from the results entirely by default). Lets a caller surface
	 * "this would be a great DPS node but it drops your fire res below cap" instead of a
	 * silently shorter list. */
	constraintViolation?: ConstraintViolation;
}

/** Resolves an explicit `constraints` map + a `preserveMetrics` list into one { metric: floor }
 * map (a preserveMetrics floor = that metric's baseline value; an explicit `constraints` entry
 * wins on collision). Exported so the beam driver builds its feasibility gate the same way. */
export function resolveFloors(
	baseline: StatSet,
	opts: { constraints?: Record<string, number>; preserveMetrics?: string[] },
): Record<string, number> {
	const floors: Record<string, number> = {};
	for (const metric of opts.preserveMetrics ?? []) {
		const base = finiteNumber(baseline[metric]);
		if (base !== null) floors[metric] = base;
	}
	// Explicit floors win over the preserveMetrics-derived ones.
	Object.assign(floors, opts.constraints ?? {});
	return floors;
}

/** The first floor this candidate violates, or undefined. A candidate violates a floor when it
 * either breaks a cap that currently holds (baseline >= floor, candidate < floor) or worsens a
 * deficit that already exists (baseline < floor, candidate < baseline). Exported for the beam
 * driver, which gates each repair candidate against its beam node's own measured stats. */
export function firstConstraintViolation(
	floors: Record<string, number>,
	baseline: StatSet,
	candidateStats: StatSet,
): ConstraintViolation | undefined {
	for (const [metric, floor] of Object.entries(floors)) {
		const base = finiteNumber(baseline[metric]);
		const cand = finiteNumber(candidateStats[metric]);
		if (base === null || cand === null) continue;
		const brokeCap = base >= floor && cand < floor;
		const worsenedDeficit = base < floor && cand < base;
		if (brokeCap || worsenedDeficit) {
			return { metric, floor, baseline: base, candidate: cand };
		}
	}
	return undefined;
}

/** A keyword screen applied to the candidate pool *before* it is evaluated (each evaluation is a
 * real recompute, so cutting the pool cheaply up front is the main lever on cost). Matching is
 * case-insensitive substring against a node's joined stat lines -- the same text `damageType`
 * uses. `damageType`, if also set, still runs afterward and is the primary sort key. */
export interface ObjectiveSpec {
	/** A node must contain at least one of these to be considered on-objective. */
	keywords: string[];
	/** Nodes containing any of these are treated as off-objective even if they matched a keyword
	 * (e.g. drop a "Mana Regeneration" node that also happens to say "Damage"). */
	exclude?: string[];
	/** `filter` drops off-objective candidates entirely; `prioritize` only stable-sorts them
	 * behind the on-objective ones (so a `maxCandidates` cut keeps the relevant slice), leaving
	 * the pool otherwise intact -- same treatment `damageType` gets today. */
	mode: "prioritize" | "filter";
}

/** Named `objective` presets. `physical-defence`: physical/attack damage plus life & the
 * mitigation layers, dropping the obviously-irrelevant clusters. The include list does the real
 * work; `exclude` is a short guard against nodes that keyword-match incidentally. "Ailment-only"
 * damage nodes are not perfectly excludable by keyword alone -- accepted approximation for v1. */
const OBJECTIVE_PRESETS: Record<string, ObjectiveSpec> = {
	"physical-defence": {
		mode: "filter",
		keywords: [
			"Physical",
			"Attack",
			"Damage",
			"Life",
			"Armour",
			"Evasion",
			"Resistance",
			"Resist",
			"Block",
			"Strength",
			"Dexterity",
		],
		exclude: ["Mana Regeneration", "Cast Speed", "Minion", "Curse", "Totem", "Brand"],
	},
};

function resolveObjective(objective: string | ObjectiveSpec | undefined): ObjectiveSpec | undefined {
	if (objective === undefined) return undefined;
	if (typeof objective === "string") {
		const preset = OBJECTIVE_PRESETS[objective];
		if (!preset) {
			throw new Error(
				`unknown objective preset "${objective}" (known: ${Object.keys(OBJECTIVE_PRESETS).join(", ")})`,
			);
		}
		return preset;
	}
	return objective;
}

export interface RecommendTreeOptions {
	/** mainOutput key to rank on, e.g. "TotalDPS" or "TotalEHP". Ignored when `objectiveFn` is set. */
	targetMetric?: string;
	/** A scoring function over the measured stats (see `./objective`), used instead of
	 * `targetMetric` when present -- e.g. a DPS/EHP log blend. A candidate whose stats the
	 * objective can't score (returns undefined) is dropped from the results; if the *baseline*
	 * can't be scored, recommendTree throws (nothing to rank against). */
	objectiveFn?: Objective;
	/** How many top-ranked nodes to return. */
	top?: number;
	/** How many candidates to send per evaluate_candidate_nodes round trip. */
	batchSize?: number;
	/** Caps the candidate pool before evaluating (each candidate costs a real recompute --
	 * useful while developing/testing against a full tree of thousands of reachable nodes, and
	 * to bound cost on a full endgame tree even in normal use). Unset evaluates every candidate
	 * left after the nodeTypes/damageType filtering below. */
	maxCandidates?: number;
	/** Node types to consider at all. Defaults to Notable+Keystone (see DEFAULT_NODE_TYPES) --
	 * a real tree can have 3000+ reachable small stat nodes, each costing a real recompute to
	 * evaluate, and they rarely rank highly anyway. Pass includeAllNodeTypes to opt back in. */
	nodeTypes?: string[];
	/** Evaluate every reachable node regardless of type, ignoring nodeTypes/its default. */
	includeAllNodeTypes?: boolean;
	/** e.g. "Lightning" -- when set, candidates whose stat lines textually mention this damage
	 * type (or "Elemental", for Fire/Cold/Lightning) are moved to the front of the candidate
	 * pool *before* maxCandidates truncates it, so a capped run still evaluates the nodes
	 * relevant to this build's damage type instead of an arbitrary slice of the tree. Does NOT
	 * change the final ranking itself -- that's still real measured deltaPerPoint, never a
	 * text-match guess (see damageTypeMatch on the result). */
	damageType?: string;
	/** Absolute floors on mainOutput metrics, e.g. { FireResist: 75, ColdResist: 75,
	 * LightningResist: 75, TotalEHP: 500000 }. A candidate is rejected when, for any listed
	 * metric, it either takes that metric from at-or-above its floor (at baseline) to below it,
	 * or drags a metric that is already below its floor even lower. A metric absent (or
	 * non-finite) from either the baseline or a candidate's measured stats is skipped for that
	 * comparison rather than treated as zero -- constraints only bite on numbers actually
	 * reported by both. Ranking of the surviving candidates is otherwise untouched (still real
	 * measured deltaPerPoint). */
	constraints?: Record<string, number>;
	/** Shorthand: each listed metric gets an implicit constraints floor equal to the current
	 * build's own baseline value for it, i.e. "recommend nothing that regresses this stat at
	 * all". An explicit `constraints` entry for the same metric wins. Metrics missing from the
	 * baseline stats are ignored. */
	preserveMetrics?: string[];
	/** When true, a constraint-violating candidate is kept in the ranked results with its
	 * `constraintViolation` field set, instead of being dropped. Default false (drop them). */
	keepViolating?: boolean;
	/** Keyword screen on the candidate pool before evaluation: an `ObjectiveSpec`, or the name of
	 * a built-in preset (currently `"physical-defence"`). Unset = no screen (the escape hatch --
	 * every node that survived the nodeTypes filter is evaluated). Applied after nodeTypes and
	 * before `damageType`; in `filter` mode it shrinks the pool, in `prioritize` mode it only
	 * reorders it ahead of a `maxCandidates` cut. */
	objective?: string | ObjectiveSpec;
	/** Called once per evaluated batch and once at the end. Must not throw; never affects the
	 * ranking or which candidates are evaluated. Undefined = no callback (CLI default). */
	onProgress?: (ev: RecommendProgress) => void;
	/** Proximity gate: drop candidates whose `pathLength` (points AllocNode would spend to connect
	 * them from the current tree) exceeds this. Caps path-node drag-in and keeps the pool local --
	 * the beam repair loop expands locally anyway. Nodes with no `pathLength` are kept (the gate
	 * can't judge them). Unset = no proximity gate. */
	maxPathLength?: number;
}

/** Coarse progress signal for a recommend pass. A single fast batch loop, so a per-batch
 * "scored X / Y" tick is enough. Fire-and-forget: never affects the ranking. */
export interface RecommendProgress {
	phase: "scoring" | "finalising";
	/** Real BuildOutput recomputes so far, from the bridge's get_metrics (0 against an older
	 * bridge without the counter). */
	buildOutputs: number;
	candidatesTotal: number;
	candidatesScored: number;
}

/** Keep only nodes within `k` path-points of the current tree. A node with no `pathLength` is
 * kept -- the gate has nothing to test it against. Exported for the beam driver, which gates
 * every expansion step this way. */
export function filterByProximity<T extends { pathLength?: number }>(nodes: T[], k: number): T[] {
	return nodes.filter((node) => node.pathLength === undefined || node.pathLength <= k);
}

const DEFAULT_TARGET_METRIC = "TotalDPS";
const DEFAULT_TOP = 10;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_NODE_TYPES = ["Notable", "Keystone"];
const ELEMENTAL_DAMAGE_TYPES = new Set(["fire", "cold", "lightning"]);

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

function keywordsForDamageType(damageType: string): string[] {
	const keywords = [damageType];
	if (ELEMENTAL_DAMAGE_TYPES.has(damageType.toLowerCase())) {
		keywords.push("Elemental");
	}
	return keywords;
}

function matchesKeywords(node: AllocatableNode, keywords: string[]): boolean {
	const text = node.statLines.join(" ").toLowerCase();
	return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

// Assumes the build is already loaded into `bridge` (via loadBuildFromFile/load_build_xml).
export async function recommendTree(
	bridge: PobBridgeClient,
	options: RecommendTreeOptions = {},
): Promise<RecommendedNode[]> {
	const targetMetric = options.targetMetric ?? DEFAULT_TARGET_METRIC;
	const top = options.top ?? DEFAULT_TOP;
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

	const score = options.objectiveFn ?? ((stats: StatSet) => finiteNumber(stats[targetMetric]) ?? undefined);

	const baseline = await bridge.call<StatSet>("get_stats");
	const baselineValue = score(baseline);
	if (baselineValue === undefined) {
		throw new Error(
			options.objectiveFn
				? "objectiveFn could not score the build's baseline stats (a required metric is absent or out of range)"
				: `baseline stats have no finite "${targetMetric}" to rank against`,
		);
	}

	const floors = resolveFloors(baseline, options);
	const hasConstraints = Object.keys(floors).length > 0;
	const keepViolating = options.keepViolating ?? false;

	const status = await bridge.call<TreeStatus>("get_tree_status");
	const pointsAvailable = status.pointsMax - status.pointsUsed;
	const ascendancyPointsAvailable = status.ascendancyPointsMax - status.ascendancyPointsUsed;

	const { nodes: unorderedNodes } = await bridge.call<{ nodes: AllocatableNode[] }>("list_allocatable_nodes");
	// list_allocatable_nodes yields nodes in Lua pairs() order over spec.nodes -- a sparse
	// integer-keyed table, whose iteration order the Lua spec does not fix. Sort by id up front
	// so every order-sensitive step downstream (the stable damageType/objective prioritize sorts,
	// a maxCandidates cut, and the tie-broken final ranking) is reproducible run-to-run. Combined
	// with the id tiebreak on the ranking sort below, this makes the recommender's output one
	// deterministic value per (build, options) -- which the beam-search benchmark relies on.
	const allNodes = [...unorderedNodes].sort((a, b) => a.id - b.id);

	let candidates = allNodes;
	if (!options.includeAllNodeTypes) {
		const nodeTypes = options.nodeTypes ?? DEFAULT_NODE_TYPES;
		candidates = candidates.filter((node) => nodeTypes.includes(node.type));
	}

	if (options.maxPathLength !== undefined) {
		candidates = filterByProximity(candidates, options.maxPathLength);
	}

	const objective = resolveObjective(options.objective);
	if (objective) {
		const onObjective = (node: AllocatableNode) =>
			matchesKeywords(node, objective.keywords) &&
			!(objective.exclude && objective.exclude.length > 0 && matchesKeywords(node, objective.exclude));
		if (objective.mode === "filter") {
			candidates = candidates.filter(onObjective);
		} else {
			// Stable sort: on-objective first, order within each group otherwise untouched.
			candidates = [...candidates].sort((a, b) => Number(onObjective(b)) - Number(onObjective(a)));
		}
	}

	const damageKeywords = options.damageType ? keywordsForDamageType(options.damageType) : undefined;
	if (damageKeywords) {
		// Stable sort: on-type matches first, but relative order within each group (and thus
		// which nodes survive a maxCandidates cut) is otherwise untouched.
		candidates = [...candidates].sort(
			(a, b) => Number(matchesKeywords(b, damageKeywords)) - Number(matchesKeywords(a, damageKeywords)),
		);
	}

	const allocatable = options.maxCandidates !== undefined ? candidates.slice(0, options.maxCandidates) : candidates;

	// Progress is opt-in and side-effect-free. `buildOutputs` comes from the bridge's own counter
	// (no new RPC -- get_metrics already exists); an older bridge without it just reports 0.
	const emitProgress = async (phase: RecommendProgress["phase"], scored: number): Promise<void> => {
		if (!options.onProgress) return;
		let buildOutputs = 0;
		try {
			buildOutputs = (await bridge.call<{ buildOutputCount?: number }>("get_metrics")).buildOutputCount ?? 0;
		} catch {
			/* older bridge -- leave 0 */
		}
		try {
			options.onProgress({ phase, buildOutputs, candidatesTotal: allocatable.length, candidatesScored: scored });
		} catch {
			/* a broken UI callback must not fail the pass */
		}
	};

	const recommendations: RecommendedNode[] = [];
	let scored = 0;
	for (const batch of chunk(allocatable, batchSize)) {
		const { results } = await bridge.call<{ results: CandidateResult[] }>("evaluate_candidate_nodes", {
			nodeIds: batch.map((node) => node.id),
		});
		scored += batch.length;
		await emitProgress("scoring", scored);
		const byId = new Map(batch.map((node) => [node.id, node]));
		for (const result of results) {
			// A candidate's true point cost includes every path node AllocNode had to pull in to
			// connect it, not just itself -- pointsSpent/ascendancyPointsSpent are that real count.
			if (result.pointsSpent <= 0 && result.ascendancyPointsSpent <= 0) continue;
			if (result.pointsSpent > pointsAvailable) continue;
			if (result.ascendancyPointsSpent > ascendancyPointsAvailable) continue;

			const node = byId.get(result.nodeId);
			if (!node) continue;

			const violation = hasConstraints
				? firstConstraintViolation(floors, baseline, result.stats)
				: undefined;
			if (violation && !keepViolating) continue;

			const candidateScore = score(result.stats);
			if (candidateScore === undefined) continue; // objective can't score this candidate -- drop it

			const delta = candidateScore - baselineValue;
			const totalPointsSpent = result.pointsSpent + result.ascendancyPointsSpent;
			recommendations.push({
				id: node.id,
				name: node.name,
				type: node.type,
				statLines: node.statLines,
				ascendancyName: node.ascendancyName,
				pointsSpent: result.pointsSpent,
				ascendancyPointsSpent: result.ascendancyPointsSpent,
				delta,
				deltaPerPoint: delta / totalPointsSpent,
				damageTypeMatch: damageKeywords ? matchesKeywords(node, damageKeywords) : undefined,
				constraintViolation: violation,
			});
		}
	}

	// Tie-break by node id: deltaPerPoint ties are real and common (a keystone and its path
	// corridor all report the same bundled delta -- see docs/gotchas.md), and V8's sort is only
	// stable, not total, so without this the top-N slice could vary with input order.
	recommendations.sort((a, b) => b.deltaPerPoint - a.deltaPerPoint || a.id - b.id);
	await emitProgress("finalising", scored);
	return recommendations.slice(0, top);
}
