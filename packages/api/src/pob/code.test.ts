import { describe, expect, it } from "vitest";
import { decodePobCode, encodePobCode } from "./code";
import { SAMPLE_XML } from "../testkit";

describe("PoB code round-trip", () => {
	it("encode -> decode returns the original XML", () => {
		expect(decodePobCode(encodePobCode(SAMPLE_XML))).toBe(SAMPLE_XML);
	});

	it("emits the url-safe base64 alphabet (no + or /)", () => {
		const code = encodePobCode(SAMPLE_XML.repeat(20)); // enough entropy to hit both chars
		expect(code).not.toMatch(/[+/]/);
	});

	it("tolerates surrounding whitespace / newlines on decode", () => {
		const code = encodePobCode(SAMPLE_XML);
		expect(decodePobCode(`\n  ${code}\t\n`)).toBe(SAMPLE_XML);
	});

	it("accepts a standard-alphabet code too (- / _ mapping is additive)", () => {
		const std = Buffer.from(require("node:zlib").deflateSync(Buffer.from(SAMPLE_XML))).toString("base64");
		expect(decodePobCode(std)).toBe(SAMPLE_XML);
	});

	it("throws on an empty code", () => {
		expect(() => decodePobCode("   ")).toThrow(/empty/i);
	});

	it("throws on a non-zlib payload", () => {
		expect(() => decodePobCode("bm90LXpsaWI")).toThrow();
	});
});
