import { describe, expect, it } from "vitest";
import { ConstraintViolationDTO, RecommendedNodeDTO, RecommendRequest } from "@poe2/contract";

describe("RecommendRequest", () => {
  it("applies defaults for a minimal request", () => {
    const r = RecommendRequest.parse({ buildId: "b1" });
    expect(r).toMatchObject({
      buildId: "b1",
      objective: "TotalDPS",
      constraints: {},
      preserveMetrics: [],
      keepViolating: false,
    });
  });

  it("accepts the full documented subset", () => {
    const r = RecommendRequest.parse({
      buildId: "b1",
      objective: "blend:TotalDPS,TotalEHP,0.6",
      top: 15,
      damageType: "Lightning",
      constraints: { LightningResist: 75 },
      preserveMetrics: ["Life"],
      keepViolating: true,
      nodeTypes: ["Notable", "Keystone", "Normal"],
    });
    expect(r.top).toBe(15);
    expect(r.damageType).toBe("Lightning");
  });

  it("rejects a non-positive top with a reason", () => {
    const r = RecommendRequest.safeParse({ buildId: "b1", top: 0 });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["top"]);
    expect(r.error!.issues[0].code).toBe("too_small");
  });

  it("rejects a bad objective spec", () => {
    const r = RecommendRequest.safeParse({ buildId: "b1", objective: "blend:A,B" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["objective"]);
  });
});

describe("RecommendedNodeDTO", () => {
  const base = {
    id: 12345,
    name: "Overheating Blow",
    type: "Notable",
    statLines: ["Gain 25% of Physical Damage as Extra Fire Damage"],
    pointsSpent: 2,
    ascendancyPointsSpent: 0,
    delta: 1335.38,
    deltaPerPoint: 667.69,
  };

  it("accepts a plain ranked node", () => {
    expect(RecommendedNodeDTO.parse(base).id).toBe(12345);
  });

  it("accepts a node carrying a constraintViolation + damageTypeMatch", () => {
    const r = RecommendedNodeDTO.parse({
      ...base,
      damageTypeMatch: true,
      constraintViolation: { metric: "FireResist", floor: 75, baseline: 76, candidate: 71 },
    });
    expect(r.constraintViolation?.metric).toBe("FireResist");
  });

  it("rejects a fractional id with a reason", () => {
    const r = RecommendedNodeDTO.safeParse({ ...base, id: 1.5 });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["id"]);
  });
});

describe("ConstraintViolationDTO", () => {
  it("accepts a full violation", () => {
    expect(
      ConstraintViolationDTO.parse({ metric: "ColdResist", floor: 75, baseline: 75, candidate: 70 }),
    ).toEqual({ metric: "ColdResist", floor: 75, baseline: 75, candidate: 70 });
  });

  it("rejects a missing field with its path", () => {
    const r = ConstraintViolationDTO.safeParse({ metric: "ColdResist", floor: 75, baseline: 75 });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["candidate"]);
  });
});
