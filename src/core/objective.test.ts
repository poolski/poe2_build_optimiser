import { describe, expect, it } from "vitest";
import { logBlend, metricObjective, parseObjective } from "./objective";

describe("metricObjective", () => {
	it("returns the metric's value", () => {
		expect(metricObjective("TotalDPS")({ TotalDPS: 1234 })).toBe(1234);
	});

	it("returns undefined for an absent or non-finite metric", () => {
		expect(metricObjective("TotalDPS")({})).toBeUndefined();
		expect(metricObjective("TotalDPS")({ TotalDPS: "n/a" })).toBeUndefined();
		expect(metricObjective("TotalDPS")({ TotalDPS: Infinity })).toBeUndefined();
	});
});

describe("logBlend", () => {
	it("computes w*ln(a) + (1-w)*ln(b)", () => {
		const obj = logBlend("TotalDPS", "TotalEHP", 0.75);
		const expected = 0.75 * Math.log(1000) + 0.25 * Math.log(50000);
		expect(obj({ TotalDPS: 1000, TotalEHP: 50000 })).toBeCloseTo(expected, 10);
	});

	it("is undefined when either metric is absent, non-finite, or <= 0", () => {
		const obj = logBlend("TotalDPS", "TotalEHP", 0.5);
		expect(obj({ TotalDPS: 1000 })).toBeUndefined();
		expect(obj({ TotalDPS: 1000, TotalEHP: 0 })).toBeUndefined();
		expect(obj({ TotalDPS: 1000, TotalEHP: -5 })).toBeUndefined();
		expect(obj({ TotalDPS: NaN, TotalEHP: 5 })).toBeUndefined();
	});

	it("rejects a weight outside [0, 1]", () => {
		expect(() => logBlend("A", "B", 1.5)).toThrow(/weight/);
		expect(() => logBlend("A", "B", -0.1)).toThrow(/weight/);
	});
});

describe("parseObjective", () => {
	it("parses a bare metric name", () => {
		expect(parseObjective("TotalDPS")({ TotalDPS: 42 })).toBe(42);
	});

	it("parses the dps-ehp shorthand (weight on DPS)", () => {
		const obj = parseObjective("dps-ehp:0.7");
		const expected = 0.7 * Math.log(100) + 0.3 * Math.log(200);
		expect(obj({ TotalDPS: 100, TotalEHP: 200 })).toBeCloseTo(expected, 10);
	});

	it("parses the generic blend form", () => {
		const obj = parseObjective("blend:Life,TotalEHP,0.5");
		const expected = 0.5 * Math.log(10) + 0.5 * Math.log(90);
		expect(obj({ Life: 10, TotalEHP: 90 })).toBeCloseTo(expected, 10);
	});

	it("rejects malformed specs", () => {
		expect(() => parseObjective("dps-ehp:2")).toThrow(/weight/);
		expect(() => parseObjective("blend:OnlyOne,0.5")).toThrow(/blend/);
		expect(() => parseObjective("has spaces")).toThrow(/unrecognised/);
	});
});
