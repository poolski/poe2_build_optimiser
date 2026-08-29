// SSE payload streamed while an optimise / recommend job runs. One event shape covers both
// job types: the optimise fields (depth/k/kTotal) and the recommend fields
// (candidatesScored/candidatesTotal) are all optional.

import { z } from "zod";

export const ProgressEvent = z.object({
  jobId: z.string(),
  /** `OptimiseProgress.phase` / `RecommendProgress.phase`, stringified. Kept a bare string
   * (not an enum) so phase 1.5's parallel-eval phases don't force a contract bump. Known
   * values: optimise -> baseline | regret-probe | add-loop | k-sweep | finalising;
   * recommend -> scoring | finalising. */
  phase: z.string(),
  /** Real BuildOutput recomputes so far. Core's `OptimiseProgress` / `RecommendProgress` call
   * this `buildOutputs`; the BRIDGE's `get_metrics` calls the same count `buildOutputCount`.
   * Spec `03` keeps the progress name -- the `04` mapper bridges `buildOutputCount` ->
   * `buildOutputs` when it reads the bridge directly rather than the core progress object. */
  buildOutputs: z.number().int(),
  estimatedTotal: z.number().int().optional(),
  bestObjective: z.number(),
  // optimise add-loop / k-sweep
  depth: z.number().int().optional(),
  k: z.number().int().optional(),
  kTotal: z.number().int().optional(),
  // recommend scoring loop (core `RecommendProgress`; not in spec 03's field list, added here
  // so the same event can carry a recommend job's progress -- flagged in the handoff notes).
  candidatesScored: z.number().int().optional(),
  candidatesTotal: z.number().int().optional(),
  note: z.string().optional(),
  /** Added by the API from job start. */
  elapsedMs: z.number().int(),
});
export type ProgressEvent = z.infer<typeof ProgressEvent>;
