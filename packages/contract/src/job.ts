// Job lifecycle: the reference the API returns on job creation, and the error payload.

import { z } from "zod";

export const JobStatus = z.enum(["queued", "running", "done", "error", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobRef = z.object({
  jobId: z.string(),
  status: JobStatus,
});
export type JobRef = z.infer<typeof JobRef>;

/** Failure category. `unscoreable-objective` / `zero-dps-build` come from core throwing on a
 * baseline the objective can't score; `bridge-crash` from a LuaJIT worker dying;
 * `bad-request` from schema validation; `internal` for everything else. */
export const JobErrorKind = z.enum([
  "unscoreable-objective",
  "zero-dps-build",
  "bridge-crash",
  "bad-request",
  "internal",
]);
export type JobErrorKind = z.infer<typeof JobErrorKind>;

export const JobError = z.object({
  jobId: z.string(),
  message: z.string(),
  kind: JobErrorKind,
});
export type JobError = z.infer<typeof JobError>;
