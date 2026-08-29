import { describe, expect, it } from "vitest";
import { JobError, JobRef, JobStatus } from "@poe2/contract";

describe("JobStatus / JobRef", () => {
  it("accepts each documented status", () => {
    for (const s of ["queued", "running", "done", "error", "cancelled"] as const) {
      expect(JobStatus.parse(s)).toBe(s);
    }
  });

  it("accepts a job ref", () => {
    expect(JobRef.parse({ jobId: "j1", status: "running" })).toEqual({
      jobId: "j1",
      status: "running",
    });
  });

  it("rejects an unknown status with an enum reason", () => {
    const r = JobRef.safeParse({ jobId: "j1", status: "paused" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].code).toBe("invalid_value");
    expect(r.error!.issues[0].path).toEqual(["status"]);
  });
});

describe("JobError", () => {
  it("accepts each error kind", () => {
    for (const kind of [
      "unscoreable-objective",
      "zero-dps-build",
      "bridge-crash",
      "bad-request",
      "internal",
    ] as const) {
      expect(JobError.parse({ jobId: "j1", message: "x", kind }).kind).toBe(kind);
    }
  });

  it("rejects an unknown error kind with its path", () => {
    const r = JobError.safeParse({ jobId: "j1", message: "x", kind: "oom" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["kind"]);
  });

  it("rejects a missing message", () => {
    const r = JobError.safeParse({ jobId: "j1", kind: "internal" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["message"]);
  });
});
