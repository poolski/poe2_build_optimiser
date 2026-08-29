import { describe, expect, it } from "vitest";
import { BuildInput, BuildSummary, CascadeResult } from "@poe2/contract";

describe("BuildInput", () => {
  it("accepts a pobCode body", () => {
    expect(BuildInput.parse({ kind: "pobCode", code: "eNpb..." })).toEqual({
      kind: "pobCode",
      code: "eNpb...",
    });
  });

  it("accepts an xml body", () => {
    const r = BuildInput.parse({ kind: "xml", xml: "<PathOfBuilding2/>" });
    expect(r).toEqual({ kind: "xml", xml: "<PathOfBuilding2/>" });
  });

  it("rejects an empty code with a min-length reason", () => {
    const r = BuildInput.safeParse({ kind: "pobCode", code: "" });
    expect(r.success).toBe(false);
    const issue = r.error!.issues[0];
    expect(issue.path).toEqual(["code"]);
    expect(issue.code).toBe("too_small");
  });

  it("rejects an unknown discriminator naming the bad field", () => {
    const r = BuildInput.safeParse({ kind: "url", url: "http://x" });
    expect(r.success).toBe(false);
    // discriminatedUnion -> a single issue about `kind`, not a merged dump of both branches
    expect(r.error!.issues[0].path).toEqual(["kind"]);
  });

  it("rejects a body missing its payload field", () => {
    const r = BuildInput.safeParse({ kind: "xml" });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path.includes("xml"))).toBe(true);
  });
});

describe("BuildSummary", () => {
  const ok = {
    buildId: "b_01",
    className: "Monk",
    ascendancy: null,
    treeVersion: "0_5",
    level: 84,
    pointsUsed: 107,
    pointsMax: 123,
    weaponSet1PointsUsed: 0,
    weaponSet2PointsUsed: 0,
    allocatedNodeIds: [101, 202, 303],
    baseline: { TotalDPS: 5513.5, Life: 3200, TotalEHP: 45000 },
    notes: [],
  };

  it("accepts a well-formed summary (nullable ascendancy)", () => {
    expect(BuildSummary.parse(ok)).toEqual(ok);
    expect(BuildSummary.parse({ ...ok, ascendancy: "Invoker" }).ascendancy).toBe("Invoker");
    // treeVersion is nullable for the same reason ascendancy is: the XML may not carry it.
    expect(BuildSummary.parse({ ...ok, treeVersion: null }).treeVersion).toBeNull();
    expect(BuildSummary.safeParse({ ...ok, treeVersion: undefined }).success).toBe(false);
  });

  it("rejects a non-finite value in baseline with a number-type reason", () => {
    const r = BuildSummary.safeParse({ ...ok, baseline: { TotalDPS: Number.POSITIVE_INFINITY } });
    expect(r.success).toBe(false);
    const issue = r.error!.issues[0];
    expect(issue.path).toEqual(["baseline", "TotalDPS"]);
    expect(issue.message.toLowerCase()).toContain("number");
  });

  it("rejects a JSON-serialised non-finite (null) in baseline", () => {
    // NaN / Infinity become null through JSON.stringify -- the API must strip these first.
    const wire = JSON.parse(JSON.stringify({ ...ok, baseline: { X: NaN } }));
    expect(BuildSummary.safeParse(wire).success).toBe(false);
  });

  it("rejects a fractional level", () => {
    const r = BuildSummary.safeParse({ ...ok, level: 84.5 });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["level"]);
  });

  it("rejects a non-integer allocated node id", () => {
    const r = BuildSummary.safeParse({ ...ok, allocatedNodeIds: [101, 2.5] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["allocatedNodeIds", 1]);
  });
});

describe("CascadeResult", () => {
  const ok = { anchorNodeId: 34015, freedNodeIds: [34015, 40001, 40002] };

  it("accepts a well-formed cascade", () => {
    expect(CascadeResult.parse(ok)).toEqual(ok);
  });

  it("accepts an empty freed set", () => {
    expect(CascadeResult.parse({ ...ok, freedNodeIds: [] }).freedNodeIds).toEqual([]);
  });

  it("rejects a missing anchor", () => {
    const { anchorNodeId, ...bad } = ok;
    void anchorNodeId;
    const r = CascadeResult.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["anchorNodeId"]);
  });

  it("rejects a non-integer freed id", () => {
    const r = CascadeResult.safeParse({ ...ok, freedNodeIds: [1.5] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["freedNodeIds", 0]);
  });
});
