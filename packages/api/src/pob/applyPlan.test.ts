import { describe, expect, it } from "vitest";
import { applyPlan } from "./applyPlan";
import { SAMPLE_XML } from "../testkit";

describe("applyPlan", () => {
	it("rewrites the base <Spec> nodes list", () => {
		const out = applyPlan(SAMPLE_XML, [40, 30, 20, 10, 55]);
		expect(out).toContain('nodes="40,30,20,10,55"');
		expect(out).not.toContain('nodes="10,20,30,40"');
	});

	it("leaves <WeaponSet1> / <WeaponSet2> nodes untouched", () => {
		const out = applyPlan(SAMPLE_XML, [1, 2, 3]);
		expect(out).toContain('<WeaponSet1 nodes="10,20,99"/>');
		expect(out).toContain('<WeaponSet2 nodes="10,20"/>');
	});

	it("changes nothing else in the document", () => {
		const out = applyPlan(SAMPLE_XML, [10, 20, 30, 40]); // same set
		expect(out).toBe(SAMPLE_XML);
	});

	it("is idempotent under a second apply of the same set", () => {
		const once = applyPlan(SAMPLE_XML, [7, 8, 9]);
		expect(applyPlan(once, [7, 8, 9])).toBe(once);
	});

	it("throws when there is no <Spec> element", () => {
		expect(() => applyPlan("<PathOfBuilding2></PathOfBuilding2>", [1])).toThrow(/no <Spec>/);
	});

	it("adds a nodes attribute when the <Spec> has none", () => {
		const xml = `<PathOfBuilding2><Spec classId="6" treeVersion="0_5"/></PathOfBuilding2>`;
		const out = applyPlan(xml, [11, 22]);
		expect(out).toContain('nodes="11,22"');
		expect(out).toContain("classId=\"6\"");
	});
});
