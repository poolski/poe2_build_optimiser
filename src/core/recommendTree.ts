// Greedy "best next points to allocate" passive-tree recommender: for every currently
// connectable, unallocated node, measure its real stat delta and point cost against the
// loaded build's own calc engine, then rank by delta-per-point. No search beyond one pass
// over the current candidate pool -- this is the mutation/measurement primitive a future
// full re-optimization search would reuse, not that search itself.

import { PobBridgeClient } from "./bridge";

export type StatSet = Record<string, unknown>;

export interface TreeStatus {
	pointsUsed: number;
	pointsMax: number;
	ascendancyPointsUsed: number;
	ascendancyPointsMax: number;
	secondaryAscendancyPointsUsed: number;
	secondaryAscendancyPointsMax: number;
}

export interface AllocatableNode {
	id: number;
	name: string;
	type: string;
	statLines: string[];
	ascendancyName?: string;
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

/** null when both endpoints of a metric aren't finite numbers -- can't judge, so don't. */
function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Resolves options.constraints + options.preserveMetrics into one { metric: floor } map. */
function resolveFloors(baseline: StatSet, options: RecommendTreeOptions): Record<string, number> {
	const floors: Record<string, number> = {};
	for (const metric of options.preserveMetrics ?? []) {
		const base = finiteNumber(baseline[metric]);
		if (base !== null) floors[metric] = base;
	}
	// Explicit floors win over the preserveMetrics-derived ones.
	Object.assign(floors, options.constraints ?? {});
	return floors;
}

/** The first floor this candidate violates, or undefined. A candidate violates a floor when it
 * either breaks a cap that currently holds (baseline >= floor, candidate < floor) or worsens a
 * deficit that already exists (baseline < floor, candidate < baseline). */
function firstConstraintViolation(
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

export interface RecommendTreeOptions {
	/** mainOutput key to rank on, e.g. "TotalDPS" or "TotalEHP". */
	targetMetric?: string;
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
}

const DEFAULT_TARGET_METRIC = "TotalDPS";
const DEFAULT_TOP = 10;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_NODE_TYPES = ["Notable", "Keystone"];
const ELEMENTAL_DAMAGE_TYPES = new Set(["fire", "cold", "lightning"]);

export function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

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

	const baseline = await bridge.call<StatSet>("get_stats");
	const baselineValue = asNumber(baseline[targetMetric]);

	const floors = resolveFloors(baseline, options);
	const hasConstraints = Object.keys(floors).length > 0;
	const keepViolating = options.keepViolating ?? false;

	const status = await bridge.call<TreeStatus>("get_tree_status");
	const pointsAvailable = status.pointsMax - status.pointsUsed;
	const ascendancyPointsAvailable = status.ascendancyPointsMax - status.ascendancyPointsUsed;

	const { nodes: allNodes } = await bridge.call<{ nodes: AllocatableNode[] }>("list_allocatable_nodes");

	let candidates = allNodes;
	if (!options.includeAllNodeTypes) {
		const nodeTypes = options.nodeTypes ?? DEFAULT_NODE_TYPES;
		candidates = candidates.filter((node) => nodeTypes.includes(node.type));
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

	const recommendations: RecommendedNode[] = [];
	for (const batch of chunk(allocatable, batchSize)) {
		const { results } = await bridge.call<{ results: CandidateResult[] }>("evaluate_candidate_nodes", {
			nodeIds: batch.map((node) => node.id),
		});
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

			const delta = asNumber(result.stats[targetMetric]) - baselineValue;
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

	recommendations.sort((a, b) => b.deltaPerPoint - a.deltaPerPoint);
	return recommendations.slice(0, top);
}
