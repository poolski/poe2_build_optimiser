import { describe, expect, it } from "vitest";
import * as contract from "@poe2/contract";
import { CONTRACT_VERSION } from "@poe2/contract";

describe("@poe2/contract", () => {
  it("exports a semver-ish version string", () => {
    expect(typeof CONTRACT_VERSION).toBe("string");
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("re-exports every schema from the barrel", () => {
    const bag: Record<string, unknown> = { ...contract };
    for (const name of [
      "BuildInput",
      "BuildSummary",
      "ObjectiveSpec",
      "OptimiseRequest",
      "OptimiseResultDTO",
      "RemovedNodeDTO",
      "OptimiseStepDTO",
      "StoppedBecause",
      "RecommendRequest",
      "RecommendedNodeDTO",
      "ConstraintViolationDTO",
      "ProgressEvent",
      "JobStatus",
      "JobRef",
      "JobError",
      "JobErrorKind",
      "OptimiseMode",
    ]) {
      expect(bag, name).toHaveProperty(name);
      // every schema is a zod schema -> has .parse / .safeParse
      expect(typeof (bag[name] as { safeParse?: unknown }).safeParse).toBe("function");
    }
  });
});
