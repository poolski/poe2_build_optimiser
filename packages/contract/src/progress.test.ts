import { describe, expect, it } from "vitest";
import { ProgressEvent } from "@poe2/contract";

describe("ProgressEvent", () => {
  it("accepts an optimise add-loop tick", () => {
    const r = ProgressEvent.parse({
      jobId: "j1",
      phase: "add-loop",
      buildOutputs: 128,
      bestObjective: 10441.94,
      depth: 3,
      elapsedMs: 21000,
    });
    expect(r.phase).toBe("add-loop");
    expect(r.k).toBeUndefined();
  });

  it("accepts a k-sweep tick with k / kTotal", () => {
    const r = ProgressEvent.parse({
      jobId: "j1",
      phase: "k-sweep",
      buildOutputs: 300,
      bestObjective: 10647.9,
      k: 2,
      kTotal: 3,
      note: "sweeping freed prefixes",
      elapsedMs: 41000,
    });
    expect(r.k).toBe(2);
  });

  it("accepts a recommend scoring tick (candidatesScored / candidatesTotal)", () => {
    const r = ProgressEvent.parse({
      jobId: "j2",
      phase: "scoring",
      buildOutputs: 50,
      bestObjective: 5513.5,
      candidatesScored: 50,
      candidatesTotal: 220,
      elapsedMs: 8000,
    });
    expect(r.candidatesTotal).toBe(220);
  });

  it("rejects a missing elapsedMs (API-added) with its path", () => {
    const r = ProgressEvent.safeParse({
      jobId: "j1",
      phase: "baseline",
      buildOutputs: 0,
      bestObjective: 5513.5,
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["elapsedMs"]);
  });

  it("round-trips optional workers[] (shard progress) and topNodes[] (ranked candidates)", () => {
    const input = {
      jobId: "j1",
      phase: "add-loop",
      buildOutputs: 128,
      bestObjective: 10441.94,
      depth: 3,
      elapsedMs: 21000,
      workers: [
        { slot: 0, done: 12, total: 40 },
        { slot: 1, done: 8, total: 40 },
      ],
      topNodes: [{ id: "n1", name: "Iron Reflexes", scoreDelta: 42.5 }],
    };
    const r = ProgressEvent.parse(input);
    expect((r as unknown as typeof input).workers).toEqual(input.workers);
    expect((r as unknown as typeof input).topNodes).toEqual(input.topNodes);
  });

  it("still parses an event with no workers/topNodes (pre-change producer)", () => {
    const r = ProgressEvent.parse({
      jobId: "j1",
      phase: "add-loop",
      buildOutputs: 128,
      bestObjective: 10441.94,
      elapsedMs: 21000,
    });
    expect((r as unknown as { workers?: unknown }).workers).toBeUndefined();
  });

  it("rejects a fractional buildOutputs with a reason", () => {
    const r = ProgressEvent.safeParse({
      jobId: "j1",
      phase: "baseline",
      buildOutputs: 1.5,
      bestObjective: 5513.5,
      elapsedMs: 10,
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["buildOutputs"]);
  });
});
