import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_SPEC_RE,
  ObjectiveSpec,
  OptimiseRequest,
  OptimiseResultDTO,
  RemovedNodeDTO,
  StoppedBecause,
} from "@poe2/contract";

// The REAL committed optimiser output (a `--respec-budget 3` repair run, 432 BuildOutputs).
// Loaded from disk rather than `import`ed so the package's own `tsc` (rootDir: src) doesn't
// choke on a JSON module outside src -- same pattern as src/core/optimiseTree.integration.test.ts.
const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../web/fixtures/canvas-diff.R_Thor-L84-weak.json"),
    "utf-8",
  ),
) as {
  baseline: { pointsUsed: number; pointsMax: number; objective: number };
  before: number[];
  afterConnected: number[];
  addedPickIds: number[];
  removed: { id: number; name: string; type: string; pointsFreed: number; valueLost: number; anchorCascade: boolean }[];
  steps: {
    id: number;
    name: string;
    type: string;
    pointsSpent: number;
    pathLength: number;
    objectiveBefore: number;
    objectiveAfter: number;
    statLines: string[];
  }[];
  result: {
    mode: "repair";
    respecBudget: number;
    stoppedBecause: string;
    pointsFreed: number;
    pointsRespent: number;
    finalObjective: number;
    netPointsSpent: number;
    buildOutputCount: number;
    cacheHitRate: number;
  };
};

describe("ObjectiveSpec", () => {
  const accept = [
    "TotalDPS",
    "TotalEHP", // bare metric with digits
    "Crit2Multi", // digits mid-name, bare position
    "dps-ehp:0.5",
    "dps-ehp:0", // integer weight
    "dps-ehp:1",
    "blend:TotalDPS,TotalEHP,0.5",
    "blend:Crit2,EHP9,0.25", // digits in BOTH blend operands
  ];
  for (const spec of accept) {
    it(`accepts ${JSON.stringify(spec)}`, () => {
      expect(ObjectiveSpec.parse(spec)).toBe(spec);
    });
  }

  const reject: [string, string][] = [
    ["dps-ehp:", "missing weight"],
    ["dps-ehp:abc", "non-numeric weight"],
    ["dps-ehp", "no colon/weight"],
    ["blend:TotalDPS,TotalEHP", "missing weight"],
    ["blend:TotalDPS,0.5", "only one operand"],
    ["blend:Total DPS,EHP,0.5", "space in operand"],
    ["blend:,EHP,0.5", "empty operand"],
    ["2DPS", "bare metric starting with a digit"],
    ["Total_DPS", "underscore not allowed"],
    ["Total-DPS", "hyphen not allowed"],
    ["", "empty string"],
    [" TotalDPS", "leading whitespace"],
  ];
  for (const [spec, why] of reject) {
    it(`rejects ${JSON.stringify(spec)} (${why})`, () => {
      const r = ObjectiveSpec.safeParse(spec);
      expect(r.success).toBe(false);
      expect(r.error!.issues[0].message).toContain("dps-ehp:W");
    });
  }

  it("the exported regex matches the schema's verdict", () => {
    expect(OBJECTIVE_SPEC_RE.test("blend:TotalDPS,TotalEHP,0.5")).toBe(true);
    expect(OBJECTIVE_SPEC_RE.test("blend:TotalDPS,TotalEHP")).toBe(false);
  });
});

describe("OptimiseRequest", () => {
  it("applies defaults for a minimal extend request", () => {
    const r = OptimiseRequest.parse({ buildId: "b1", mode: "extend" });
    expect(r).toMatchObject({
      buildId: "b1",
      mode: "extend",
      objective: "TotalDPS",
      constraints: {},
      preserveMetrics: [],
      includeAllNodeTypes: false,
      freeze: [],
    });
  });

  it("accepts a full rollback request", () => {
    const r = OptimiseRequest.parse({
      buildId: "b1",
      mode: "rollback",
      anchorNodeId: 34015,
      objective: "dps-ehp:0.5",
      respecBudget: 3,
      constraints: { FireResist: 75 },
      preserveMetrics: ["TotalEHP"],
      beamWidth: 2,
      beamDepth: 8,
      freeze: [1, 2, 3],
    });
    expect(r.anchorNodeId).toBe(34015);
    expect(r.beamWidth).toBe(2);
  });

  it("rejects extraPoints + pointBudget together, with the xor reason", () => {
    const r = OptimiseRequest.safeParse({
      buildId: "b1",
      mode: "extend",
      extraPoints: 5,
      pointBudget: 120,
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe("extraPoints and pointBudget are mutually exclusive");
  });

  it("rejects rollback mode without anchorNodeId, with the reason", () => {
    const r = OptimiseRequest.safeParse({ buildId: "b1", mode: "rollback" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe("rollback mode requires anchorNodeId");
  });

  it("rejects a bad objective spec (delegated to ObjectiveSpec)", () => {
    const r = OptimiseRequest.safeParse({ buildId: "b1", mode: "extend", objective: "dps-ehp:" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["objective"]);
  });

  it("rejects a negative respecBudget", () => {
    const r = OptimiseRequest.safeParse({ buildId: "b1", mode: "repair", respecBudget: -1 });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["respecBudget"]);
  });
});

describe("RemovedNodeDTO", () => {
  it("accepts a normal removal", () => {
    expect(
      RemovedNodeDTO.parse({
        id: 2511,
        name: "Sundering",
        type: "Notable",
        statLines: ["25% increased Critical Damage Bonus for Attack Damage"],
        pointsFreed: 1,
        anchorCascade: false,
        objectiveAfterRemoval: 5513.53,
        valueLost: 0,
      }).id,
    ).toBe(2511);
  });

  it("accepts a null objectiveAfterRemoval / valueLost (unscorable-after-removal anchor)", () => {
    const r = RemovedNodeDTO.parse({
      id: 999,
      name: "Anchor",
      type: "Notable",
      statLines: [],
      pointsFreed: 6,
      anchorCascade: true,
      objectiveAfterRemoval: null,
      valueLost: null,
    });
    expect(r.valueLost).toBeNull();
  });

  it("rejects a missing statLines with a reason", () => {
    const r = RemovedNodeDTO.safeParse({
      id: 1,
      name: "x",
      type: "Notable",
      pointsFreed: 1,
      objectiveAfterRemoval: 0,
      valueLost: 0,
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["statLines"]);
  });
});

describe("StoppedBecause", () => {
  it("accepts cancelled (the shouldContinue early return)", () => {
    expect(StoppedBecause.parse("cancelled")).toBe("cancelled");
  });
  it("rejects an unknown reason", () => {
    const r = StoppedBecause.safeParse("exploded");
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].code).toBe("invalid_value");
  });
});

describe("OptimiseResultDTO round-trip", () => {
  // Build a full result DTO from the REAL optimiser fixture. The committed fixture is a trimmed
  // canvas projection (steps lack delta/deltaPerPoint, removed lack statLines/objectiveAfterRemoval,
  // the top-level `result` is reduced), so we reconstitute the field-for-field mirror of
  // OptimiseTreeResult from its parts + the derivable values.
  const dto = {
    mode: fixture.result.mode as "repair",
    baseline: {
      objective: fixture.baseline.objective,
      pointsUsed: fixture.baseline.pointsUsed,
      pointsMax: fixture.baseline.pointsMax,
    },
    pointBudget: fixture.baseline.pointsUsed, // repair: pointBudget defaults to pointsUsed
    respecBudget: fixture.result.respecBudget,
    removed: fixture.removed.map((rm) => ({
      id: rm.id,
      name: rm.name,
      type: rm.type,
      statLines: [] as string[],
      pointsFreed: rm.pointsFreed,
      anchorCascade: rm.anchorCascade,
      objectiveAfterRemoval: fixture.baseline.objective - rm.valueLost,
      valueLost: rm.valueLost,
    })),
    steps: fixture.steps.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      statLines: s.statLines,
      pointsSpent: s.pointsSpent,
      pathLength: s.pathLength,
      objectiveBefore: s.objectiveBefore,
      objectiveAfter: s.objectiveAfter,
      delta: s.objectiveAfter - s.objectiveBefore,
      deltaPerPoint: (s.objectiveAfter - s.objectiveBefore) / s.pointsSpent,
    })),
    addedNodeIds: fixture.addedPickIds,
    allocatedNodeIds: { before: fixture.before, after: fixture.afterConnected },
    pointsFreed: fixture.result.pointsFreed,
    pointsRespent: fixture.result.pointsRespent,
    final: {
      objective: fixture.result.finalObjective,
      pointsSpent: fixture.result.netPointsSpent,
      stats: { TotalDPS: 10647.93, Life: 3200, TotalEHP: 45000 },
    },
    stoppedBecause: fixture.result.stoppedBecause,
    buildOutputCount: fixture.result.buildOutputCount,
    cacheHitRate: fixture.result.cacheHitRate,
    updatedPobCode: "eJ_placeholder_04_produces_this",
  };

  it("parses clean and preserves structure through parse", () => {
    const parsed = OptimiseResultDTO.parse(dto);
    expect(parsed.mode).toBe("repair");
    expect(parsed.allocatedNodeIds.after).toEqual(fixture.afterConnected);
    expect(parsed.removed[0].valueLost).toBeCloseTo(-3593.0253, 3);
    expect(parsed.steps).toHaveLength(2);
    // full JSON round-trip is idempotent
    expect(OptimiseResultDTO.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects a disconnected-looking result missing allocatedNodeIds", () => {
    const { allocatedNodeIds, ...bad } = dto;
    void allocatedNodeIds;
    const r = OptimiseResultDTO.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["allocatedNodeIds"]);
  });

  it("rejects a result whose stoppedBecause is unknown", () => {
    const r = OptimiseResultDTO.safeParse({ ...dto, stoppedBecause: "kaboom" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["stoppedBecause"]);
  });
});
