import { describe, expect, it } from "vitest";
import { parseArgs } from "./optimiseCli";

const BUILD = "build.xml";

describe("optimise-tree CLI arg parsing", () => {
	it("defaults to extend mode with the point budget resolved from --extra-points later", () => {
		const { buildXmlPath, options, extraPoints, explicitBudget } = parseArgs([BUILD, "--extra-points", "8"]);
		expect(buildXmlPath).toBe(BUILD);
		expect(options.respecBudget).toBe(0);
		expect(options.pointBudget).toBeUndefined(); // resolved against pointsUsed in main()
		expect(extraPoints).toBe(8);
		expect(explicitBudget).toBe(true);
	});

	it("infers repair mode from --respec-budget", () => {
		const { options } = parseArgs([BUILD, "--respec-budget", "3"]);
		expect(options.respecBudget).toBe(3);
	});

	it("accepts --repair-nodes as an alias for --respec-budget", () => {
		const { options } = parseArgs([BUILD, "--repair-nodes", "5"]);
		expect(options.respecBudget).toBe(5);
	});

	it("--mode repair requires a positive respec budget", () => {
		expect(() => parseArgs([BUILD, "--mode", "repair"])).toThrow(/needs --respec-budget/);
		expect(() => parseArgs([BUILD, "--mode", "repair", "--respec-budget", "0"])).toThrow(/needs --respec-budget/);
	});

	it("--mode extend rejects a respec budget", () => {
		expect(() => parseArgs([BUILD, "--mode", "extend", "--respec-budget", "2"])).toThrow(/conflicts/);
	});

	it("rejects --point-budget together with --extra-points", () => {
		expect(() => parseArgs([BUILD, "--point-budget", "110", "--extra-points", "5"])).toThrow(/mutually exclusive/);
	});

	it("rejects --target together with --objective", () => {
		expect(() => parseArgs([BUILD, "--target", "TotalDPS", "--objective", "dps-ehp:0.5"])).toThrow(/mutually exclusive/);
	});

	it("passes a bare metric through --target and builds an objectiveFn from --objective", () => {
		expect(parseArgs([BUILD, "--target", "TotalEHP"]).options.targetMetric).toBe("TotalEHP");
		const withObjective = parseArgs([BUILD, "--objective", "dps-ehp:0.5"]);
		expect(typeof withObjective.options.objectiveFn).toBe("function");
	});

	it("expands --min-resist to the three elemental resists and merges --constraint", () => {
		const { options } = parseArgs([BUILD, "--min-resist", "75", "--constraint", "ChaosResist=30"]);
		expect(options.constraints).toEqual({
			FireResist: 75,
			ColdResist: 75,
			LightningResist: 75,
			ChaosResist: 30,
		});
	});

	it("parses list flags into trimmed entries", () => {
		const { options } = parseArgs([BUILD, "--node-types", "Notable, Keystone", "--keywords", "attack, physical"]);
		expect(options.nodeTypes).toEqual(["Notable", "Keystone"]);
		expect(options.keywords).toEqual(["attack", "physical"]);
	});

	it("rejects an unknown flag and a missing build path", () => {
		expect(() => parseArgs([BUILD, "--bogus"])).toThrow(/unknown flag/);
		expect(() => parseArgs(["--respec-budget", "2"])).toThrow(/usage/);
		expect(() => parseArgs([BUILD, "extra.xml"])).toThrow(/usage/);
	});

	it("rejects non-integer numeric flags", () => {
		expect(() => parseArgs([BUILD, "--proximity", "3.5"])).toThrow(/integer/);
		expect(() => parseArgs([BUILD, "--respec-budget", "x"])).toThrow(/integer/);
	});

	it("parses --beam-width and --beam-depth, and rejects out-of-range values", () => {
		const { options } = parseArgs([BUILD, "--beam-width", "3", "--beam-depth", "6"]);
		expect(options.beamWidth).toBe(3);
		expect(options.beamDepth).toBe(6);
		expect(() => parseArgs([BUILD, "--beam-width", "0"])).toThrow(/beam-width must be >= 1/);
		expect(() => parseArgs([BUILD, "--beam-depth", "0"])).toThrow(/beam-depth must be >= 1/);
	});

	it("parses --freeze into a list of node ids", () => {
		const { options } = parseArgs([BUILD, "--respec-budget", "3", "--freeze", "123, 456, 789"]);
		expect(options.freeze).toEqual([123, 456, 789]);
		expect(() => parseArgs([BUILD, "--freeze", "12x"])).toThrow(/integer/);
	});
});
