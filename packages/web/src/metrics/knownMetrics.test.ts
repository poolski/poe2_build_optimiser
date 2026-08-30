import { describe, expect, it } from "vitest";
import { KNOWN_METRICS, mergeMetricOptions } from "./knownMetrics";

describe("KNOWN_METRICS (pure)", () => {
  it("is a small vendored list of real, already-referenced metric names", () => {
    // Sourced from names already used elsewhere in this repo (ObjectiveBuilder defaults,
    // ConstraintsEditor tests, docs/gotchas.md) -- not invented.
    expect(KNOWN_METRICS).toEqual([
      "TotalDPS",
      "TotalEHP",
      "Life",
      "Mana",
      "EnergyShield",
      "FireResist",
    ]);
  });
});

describe("mergeMetricOptions (pure)", () => {
  it("returns the static list alone when no build-specific keys are given", () => {
    expect(mergeMetricOptions()).toEqual(KNOWN_METRICS);
    expect(mergeMetricOptions([])).toEqual(KNOWN_METRICS);
  });

  it("appends build-specific keys not already in the static list, preserving order", () => {
    expect(mergeMetricOptions(["TotalDPS", "ColdResist", "PhysMaxHit"])).toEqual([
      ...KNOWN_METRICS,
      "ColdResist",
      "PhysMaxHit",
    ]);
  });

  it("dedups case-sensitively without reordering or duplicating", () => {
    expect(mergeMetricOptions(["Life", "Life", "Mana"])).toEqual(KNOWN_METRICS);
  });
});
