import { describe, expect, it } from "vitest";
import { BuildStore, buildNotes, parseAscendancy, parseTreeVersion } from "./store";
import { encodePobCode } from "../pob/code";
import { fakeBridgeSource, SAMPLE_XML } from "../testkit";
import type { TreeStatus } from "../core";

const STATUS: TreeStatus = {
	pointsUsed: 107,
	pointsMax: 123,
	ascendancyPointsUsed: 6,
	ascendancyPointsMax: 8,
	secondaryAscendancyPointsUsed: 0,
	secondaryAscendancyPointsMax: 8,
	weaponSet1PointsUsed: 2,
	weaponSet2PointsUsed: 0,
	weaponSetPointsMax: 24,
	treeNodesAllocated: 109,
};

const okHandlers = {
	load_build_xml: { ok: true, className: "Warrior", level: 84 },
	reset_metrics: { ok: true },
	get_stats: { TotalDPS: 5513.53, Life: 3200, TotalEHP: 45000, BadInf: Infinity, BadNaN: NaN },
	get_tree_status: STATUS,
	get_item_slots: { "Weapon 1": "Some Axe", Helmet: "Some Hat" },
	list_allocated_nodes: { nodes: [{ id: 30 }, { id: 10 }, { id: 40 }, { id: 20 }] },
};

describe("parseAscendancy", () => {
	it("reads ascendClassName from <Build>", () => {
		expect(parseAscendancy(SAMPLE_XML)).toBe("Smith of Kitava");
	});
	it("maps empty / sentinel values to null", () => {
		expect(parseAscendancy('<Build className="Warrior" ascendClassName=""/>')).toBeNull();
		expect(parseAscendancy('<Build className="Warrior" ascendClassName="None"/>')).toBeNull();
		expect(parseAscendancy('<Build className="Warrior"/>')).toBeNull();
	});
});

describe("parseTreeVersion", () => {
	it("reads treeVersion off the first <Spec>", () => {
		expect(parseTreeVersion(SAMPLE_XML)).toBe("0_5");
	});
	it("is null when the attribute is absent or empty", () => {
		expect(parseTreeVersion('<Tree><Spec classId="1" nodes=""/></Tree>')).toBeNull();
		expect(parseTreeVersion('<Tree><Spec treeVersion="" nodes=""/></Tree>')).toBeNull();
		expect(parseTreeVersion("<Build/>")).toBeNull();
	});
	it("takes the FIRST spec, matching the one applyPlan edits", () => {
		const xml =
			'<Tree activeSpec="1">' +
			'<Spec treeVersion="0_5" nodes="1"/>' +
			'<Spec treeVersion="0_2" nodes="2"/>' +
			"</Tree>";
		expect(parseTreeVersion(xml)).toBe("0_5");
	});
});

describe("buildNotes", () => {
	it("flags a 0-DPS build", () => {
		expect(buildNotes({ TotalDPS: 0 }, STATUS, null)).toContain("scores 0 DPS headless");
		expect(buildNotes({}, STATUS, null)).toContain("scores 0 DPS headless");
	});
	it("flags over-allocation with the delta", () => {
		const notes = buildNotes({ TotalDPS: 1 }, { ...STATUS, pointsUsed: 125, pointsMax: 123 }, null);
		expect(notes).toContain("over-allocated by 2 point(s)");
	});
	it("flags an empty active weapon set only when slot data is present", () => {
		expect(buildNotes({ TotalDPS: 1 }, STATUS, { Helmet: "Hat" })).toContain(
			"no weapon in the active set (Weapon 1 empty)",
		);
		expect(buildNotes({ TotalDPS: 1 }, STATUS, null)).toEqual([]);
		expect(buildNotes({ TotalDPS: 1 }, STATUS, { "Weapon 1": "Axe" })).toEqual([]);
	});
});

describe("BuildStore.ingest", () => {
	it("summarises a pasted pobCode and strips non-finite baseline keys", async () => {
		const src = fakeBridgeSource(okHandlers);
		const store = new BuildStore(src);
		const summary = await store.ingest({ kind: "pobCode", code: encodePobCode(SAMPLE_XML) });

		expect(summary).toMatchObject({
			className: "Warrior",
			ascendancy: "Smith of Kitava",
			level: 84,
			pointsUsed: 107,
			pointsMax: 123,
			weaponSet1PointsUsed: 2,
			notes: [],
		});
		expect(summary.baseline).toEqual({ TotalDPS: 5513.53, Life: 3200, TotalEHP: 45000 });
		expect(summary.allocatedNodeIds).toEqual([10, 20, 30, 40]);
		expect(summary.buildId).toMatch(/^b_/);
		expect(src.acquired).toBe(1);
		expect(src.released).toBe(1);
		expect(store.get(summary.buildId)?.xml).toBe(SAMPLE_XML);
	});

	it("accepts raw xml input", async () => {
		const store = new BuildStore(fakeBridgeSource(okHandlers));
		const summary = await store.ingest({ kind: "xml", xml: SAMPLE_XML });
		expect(summary.level).toBe(84);
	});

	it("carries the 0-DPS note through", async () => {
		const store = new BuildStore(fakeBridgeSource({ ...okHandlers, get_stats: { TotalDPS: 0 } }));
		const summary = await store.ingest({ kind: "xml", xml: SAMPLE_XML });
		expect(summary.notes).toContain("scores 0 DPS headless");
	});

	it("still summarises when get_item_slots is unavailable", async () => {
		const handlers = { ...okHandlers } as Record<string, unknown>;
		delete handlers.get_item_slots;
		const store = new BuildStore(fakeBridgeSource(handlers));
		const summary = await store.ingest({ kind: "xml", xml: SAMPLE_XML });
		expect(summary.notes).toEqual([]); // no weapon note without slot data
	});

	it("releases the bridge even when the parse throws", async () => {
		const src = fakeBridgeSource({
			load_build_xml: () => {
				throw new Error("build failed to load (invalid XML?)");
			},
		});
		const store = new BuildStore(src);
		await expect(store.ingest({ kind: "xml", xml: "<bad/>" })).rejects.toThrow(/invalid XML/);
		expect(src.released).toBe(1);
	});

	it("propagates a decode failure from a bad code", async () => {
		const store = new BuildStore(fakeBridgeSource(okHandlers));
		await expect(store.ingest({ kind: "pobCode", code: "not-valid-zlib" })).rejects.toThrow();
	});
});

describe("BuildStore.cascade", () => {
	// A bridge whose list_allocated_nodes drops [anchor, anchor+1] when asked to remove the anchor,
	// modelling the DeallocNode cascade freeing the anchor plus a dependant.
	const cascadeHandlers = {
		...okHandlers,
		list_allocated_nodes: (_m: string, params?: Record<string, unknown>) => {
			const remove = (params?.removeIds as number[] | undefined) ?? [];
			const all = [10, 20, 30, 31, 40]; // 31 depends on 30
			const dropped = new Set<number>();
			for (const id of remove) {
				dropped.add(id);
				dropped.add(id + 1); // its dependant cascades off too
			}
			return { nodes: all.filter((id) => !dropped.has(id)).map((id) => ({ id })) };
		},
	};

	async function stored() {
		const src = fakeBridgeSource(cascadeHandlers);
		const store = new BuildStore(src);
		const summary = await store.ingest({ kind: "xml", xml: SAMPLE_XML });
		return { store, src, buildId: summary.buildId };
	}

	it("returns the freed cascade for an allocated anchor, ascending, including the anchor", async () => {
		const { store, buildId } = await stored();
		const r = await store.cascade(buildId, 30);
		expect(r).toEqual({ anchorNodeId: 30, freedNodeIds: [30, 31] });
	});

	it("throws unknown-build for an unknown id", async () => {
		const { store } = await stored();
		await expect(store.cascade("b_nope", 30)).rejects.toThrow(/unknown-build/);
	});

	it("throws anchor-not-allocated when the anchor is not in the allocated set", async () => {
		const { store, buildId } = await stored();
		await expect(store.cascade(buildId, 999)).rejects.toThrow(/anchor-not-allocated/);
	});

	it("releases the bridge after computing a cascade", async () => {
		const { store, src, buildId } = await stored();
		await store.cascade(buildId, 30);
		// one acquire+release for ingest, one for the cascade
		expect(src.released).toBe(src.acquired);
		expect(src.acquired).toBe(2);
	});
});
