// In-memory store of ingested builds. A build is loaded once (bridge parse -> summary), kept for
// the life of the process (single user, restart clears them), and is independent of any job --
// one build, many jobs.

import { randomUUID } from "node:crypto";
import type { BuildInput, BuildSummary, CascadeResult } from "@poe2/contract";
import { BuildSummary as BuildSummarySchema } from "@poe2/contract";
import type { PobBridgeClient } from "@poe2/pob-bridge";
import type { StatSet, TreeStatus } from "../core";
import { decodePobCode } from "../pob/code";
import { sanitizeStatSet } from "../jobs/mappers";

/** Just the slice of the pool the store needs -- lets tests pass a fake. */
export interface BridgeLease {
	call: PobBridgeClient["call"];
	release(): void;
}
export interface BridgeSource {
	acquire(): Promise<BridgeLease>;
}

export interface StoredBuild {
	buildId: string;
	xml: string;
	summary: BuildSummary;
}

interface LoadBuildResult {
	className: string;
	level: number;
}

const NO_ASCENDANCY = new Set(["", "none", "nil", "null"]);

/** `<Build ... ascendClassName="X">` -> `X`, or null when absent / a "no ascendancy" sentinel. */
export function parseAscendancy(xml: string): string | null {
	const m = xml.match(/<Build\b[^>]*\bascendClassName="([^"]*)"/);
	if (!m) return null;
	const v = m[1].trim();
	return NO_ASCENDANCY.has(v.toLowerCase()) ? null : v;
}

/**
 * `<Spec treeVersion="0_5">` -> `"0_5"`, or null when absent.
 *
 * Reads the FIRST <Spec>, deliberately matching `applyPlan`'s target -- the version we report
 * must describe the spec we actually edit, not some other weapon-set spec. `get_tree_status`
 * does not expose this, so it comes off the XML.
 */
export function parseTreeVersion(xml: string): string | null {
	const m = xml.match(/<Spec\b[^>]*\btreeVersion="([^"]*)"/);
	if (!m) return null;
	const v = m[1].trim();
	return v === "" ? null : v;
}

/** Assemble the human-facing `notes` list: the error surfaces 04 wants kept first-class. */
export function buildNotes(stats: StatSet, status: TreeStatus, weaponSlots: Record<string, string> | null): string[] {
	const notes: string[] = [];

	const dps = stats.TotalDPS;
	if (typeof dps !== "number" || !Number.isFinite(dps) || dps === 0) {
		notes.push("scores 0 DPS headless");
	}
	if (status.pointsUsed > status.pointsMax) {
		notes.push(`over-allocated by ${status.pointsUsed - status.pointsMax} point(s)`);
	}
	if (weaponSlots && Object.keys(weaponSlots).length > 0 && !weaponSlots["Weapon 1"]) {
		notes.push("no weapon in the active set (Weapon 1 empty)");
	}
	return notes;
}

export class BuildStore {
	private readonly builds = new Map<string, StoredBuild>();

	constructor(private readonly source: BridgeSource) {}

	/** Decode/accept the XML, parse it on a bridge, store and return the summary.
	 * Throws (bad code / unparseable XML) for the route to turn into a 400. */
	async ingest(input: BuildInput): Promise<BuildSummary> {
		const xml = input.kind === "xml" ? input.xml : decodePobCode(input.code);
		const buildId = `b_${randomUUID().slice(0, 8)}`;

		const bridge = await this.source.acquire();
		try {
			const loaded = await bridge.call<LoadBuildResult>("load_build_xml", { xml });
			await bridge.call("reset_metrics");
			const stats = await bridge.call<StatSet>("get_stats");
			const status = await bridge.call<TreeStatus>("get_tree_status");

			let weaponSlots: Record<string, string> | null = null;
			try {
				weaponSlots = await bridge.call<Record<string, string>>("get_item_slots");
			} catch {
				// older bridge / method unavailable -- skip the weapon note, not fatal.
			}

			// The current allocated set, for the Configure-step tree preview. No-arg
			// `list_allocated_nodes` reads the loaded tree and adds zero BuildOutputs (no recompute).
			// It returns `{ nodes: [{ id, ... }] }` (same shape core consumes); we keep the ids only.
			const { nodes } = await bridge.call<{ nodes: { id: number }[] }>("list_allocated_nodes");
			const allocatedNodeIds = nodes.map((n) => n.id).sort((a, b) => a - b);

			const summary = BuildSummarySchema.parse({
				buildId,
				className: loaded.className,
				ascendancy: parseAscendancy(xml),
				treeVersion: parseTreeVersion(xml),
				level: loaded.level,
				pointsUsed: status.pointsUsed,
				pointsMax: status.pointsMax,
				weaponSet1PointsUsed: status.weaponSet1PointsUsed,
				weaponSet2PointsUsed: status.weaponSet2PointsUsed,
				allocatedNodeIds,
				baseline: sanitizeStatSet(stats),
				notes: buildNotes(stats, status, weaponSlots),
			});

			const stored: StoredBuild = { buildId, xml, summary };
			this.builds.set(buildId, stored);
			return summary;
		} finally {
			bridge.release();
		}
	}

	/**
	 * The downstream `DeallocNode` cascade that rolling back to `anchorNodeId` would free, for the
	 * Configure-step preview. Stateless: re-parses the stored XML on a fresh lease (parse only, no
	 * recompute) and diffs the allocated set with/without the anchor's subtree.
	 *
	 * Throws `unknown-build` (route -> 404) for an unknown id and `anchor-not-allocated`
	 * (route -> 400) when the anchor is not currently allocated. Deeper validity (ascendancy /
	 * too-near-start) is left to the run-time rejection in `optimiseTree`.
	 */
	async cascade(buildId: string, anchorNodeId: number): Promise<CascadeResult> {
		const stored = this.builds.get(buildId);
		if (!stored) throw new Error("unknown-build");

		const bridge = await this.source.acquire();
		try {
			await bridge.call("load_build_xml", { xml: stored.xml });
			const { nodes: beforeNodes } = await bridge.call<{ nodes: { id: number }[] }>(
				"list_allocated_nodes",
			);
			const before = beforeNodes.map((n) => n.id);
			if (!before.includes(anchorNodeId)) throw new Error("anchor-not-allocated");
			const { nodes: afterNodes } = await bridge.call<{ nodes: { id: number }[] }>(
				"list_allocated_nodes",
				{ removeIds: [anchorNodeId] },
			);
			const afterSet = new Set(afterNodes.map((n) => n.id));
			const freedNodeIds = before.filter((id) => !afterSet.has(id)).sort((a, b) => a - b);
			return { anchorNodeId, freedNodeIds };
		} finally {
			bridge.release();
		}
	}

	get(buildId: string): StoredBuild | undefined {
		return this.builds.get(buildId);
	}

	has(buildId: string): boolean {
		return this.builds.has(buildId);
	}
}
