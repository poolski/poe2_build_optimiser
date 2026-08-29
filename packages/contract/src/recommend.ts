// The recommend job: a lighter request than optimise, plus the ranked-node DTO mirroring
// core's `RecommendedNode` (src/core/recommendTree.ts).

import { z } from "zod";
import { ObjectiveSpec } from "./optimise";

/**
 * Subset of `OptimiseRequest` sufficient for the greedy recommender.
 *
 * `objective` here is the SCORING spec (bare metric / blend), mapped to
 * `RecommendTreeOptions.targetMetric` or `objectiveFn` in `04` -- NOT recommendTree's
 * keyword-screen `objective` preset param, which v1 does not expose. Also not exposed:
 * `maxPathLength`, `batchSize`, `maxCandidates`, `includeAllNodeTypes` (widen via `nodeTypes`).
 */
export const RecommendRequest = z.object({
  buildId: z.string(),
  objective: ObjectiveSpec.default("TotalDPS"),
  top: z.number().int().min(1).optional(),
  damageType: z.string().optional(),
  constraints: z.record(z.string(), z.number()).default({}),
  preserveMetrics: z.array(z.string()).default([]),
  keepViolating: z.boolean().default(false),
  nodeTypes: z.array(z.string()).optional(),
});
export type RecommendRequest = z.infer<typeof RecommendRequest>;
/** Form-state / payload type: defaulted fields optional. See `OptimiseRequestInput`. */
export type RecommendRequestInput = z.input<typeof RecommendRequest>;

/** A constrained metric a node would push the wrong way. Mirrors `ConstraintViolation`. */
export const ConstraintViolationDTO = z.object({
  metric: z.string(),
  floor: z.number(),
  baseline: z.number(),
  candidate: z.number(),
});
export type ConstraintViolationDTO = z.infer<typeof ConstraintViolationDTO>;

/** A ranked next-node suggestion. Mirrors `RecommendedNode`. */
export const RecommendedNodeDTO = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  statLines: z.array(z.string()),
  ascendancyName: z.string().optional(),
  pointsSpent: z.number().int(),
  ascendancyPointsSpent: z.number().int(),
  delta: z.number(),
  deltaPerPoint: z.number(),
  /** Only present when `damageType` was given. Informational -- ranking is by measured
   * `deltaPerPoint`, never this flag. */
  damageTypeMatch: z.boolean().optional(),
  /** Set only when the node violates a constraint AND `keepViolating` was true. */
  constraintViolation: ConstraintViolationDTO.optional(),
});
export type RecommendedNodeDTO = z.infer<typeof RecommendedNodeDTO>;
