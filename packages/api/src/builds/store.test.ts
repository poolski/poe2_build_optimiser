import { describe, expect, it } from "vitest";
import { BuildStore, buildNotes, parseAscendancy } from "./store";
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
