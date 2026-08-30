import { describe, expect, it } from "vitest";
import type { BuildSummary, OptimiseResultDTO } from "@poe2/contract";
import { initialState, reducer } from "./state";

const build: BuildSummary = {
  buildId: "b1",
  className: "Witch",
  ascendancy: "Infernalist",
  treeVersion: "0_5",
  level: 90,
  pointsUsed: 100,
  pointsMax: 112,
  weaponSet1PointsUsed: 0,
  weaponSet2PointsUsed: 0,
  allocatedNodeIds: [1, 2, 3],
  baseline: { TotalDPS: 100000 },
  notes: [],
};

const result = { updatedPobCode: "x" } as unknown as OptimiseResultDTO;

describe("reducer: syncStep", () => {
  it("sets the step directly when the target step's data is present", () => {
    const withBuild = reducer(initialState, { type: "buildLoaded", build });
    const next = reducer(withBuild, { type: "syncStep", step: "input" });
    expect(next.step).toBe("input");
    expect(next.build).toEqual(build); // no side effects -- data untouched
  });

  it("allows navigating to config once a build is loaded", () => {
    const withBuild = reducer(initialState, { type: "buildLoaded", build });
    const next = reducer(withBuild, { type: "syncStep", step: "config" });
    expect(next.step).toBe("config");
  });

  it("falls back to config when targeting results without a result", () => {
    const withBuild = reducer(initialState, { type: "buildLoaded", build });
    const next = reducer(withBuild, { type: "syncStep", step: "results" });
    expect(next.step).toBe("config");
  });

  it("falls back to input when targeting config without a build", () => {
    const next = reducer(initialState, { type: "syncStep", step: "config" });
    expect(next.step).toBe("input");
  });

  it("falls back to input when targeting results with neither build nor result", () => {
    const next = reducer(initialState, { type: "syncStep", step: "results" });
    expect(next.step).toBe("input");
  });

  it("allows navigating to results once a result is present", () => {
    const withBuild = reducer(initialState, { type: "buildLoaded", build });
    const withResult = reducer(withBuild, { type: "jobDone", result });
    const next = reducer(withResult, { type: "syncStep", step: "results" });
    expect(next.step).toBe("results");
  });

  it("clears any pending error", () => {
    const errored = reducer(initialState, { type: "jobError", message: "boom" });
    const next = reducer(errored, { type: "syncStep", step: "input" });
    expect(next.error).toBeUndefined();
  });
});
