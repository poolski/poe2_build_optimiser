// The optimise job: request body, and the result DTO mirroring core's `OptimiseTreeResult`.
//
// See src/core/optimiseTree.ts for the shapes this mirrors and intake/web-ui/03-shared-contract.md
// for the spec. `04` maps `OptimiseRequest` -> `OptimiseTreeOptions` 1:1 (the mapper lives in the
// API, not here) and adds `updatedPobCode` + passes `allocatedNodeIds` straight through.

import { z } from "zod";

// --- objective spec (string shape only) --------------------------------------------------------
// The real grammar (`dps-ehp:W` | `blend:A,B,W` | bare metric) is parsed in
// src/core/objective.ts:parseObjective. Here we only gate the STRING SHAPE with a regex so a
// malformed spec is a 400, not a job that dies in core.
//
// One METRIC char-class for BOTH the bare and the blend-operand positions -- an earlier draft
// let bare metrics carry digits (`TotalEHP`) but not blend operands. Metric names must start
// with a letter and may then contain digits (`TotalEHP`, `Crit2Multi`).
const METRIC = String.raw`[A-Za-z][A-Za-z0-9]*`;
const WEIGHT = String.raw`\d+(?:\.\d+)?`;

/** Exported so `04`/`05` can reuse the exact shape check (e.g. inline form validation). */
export const OBJECTIVE_SPEC_RE = new RegExp(
  `^(?:dps-ehp:${WEIGHT}|blend:${METRIC},${METRIC},${WEIGHT}|${METRIC})$`,
);

export const ObjectiveSpec = z
  .string()
  .regex(OBJECTIVE_SPEC_RE, "expected 'dps-ehp:W', 'blend:A,B,W', or a bare metric name");
export type ObjectiveSpec = z.infer<typeof ObjectiveSpec>; // string

// NOTE (shape check only, deliberately looser than core):
//  - the weight is not range-checked here; `dps-ehp:5` passes the regex, core's parseWeight
//    then rejects it ([0,1]). `04` surfaces that as a `unscoreable-objective` / `bad-request`.
//  - the regex is case-sensitive; core matches `dps-ehp:` / `blend:` case-insensitively. The UI
//    only ever emits the lowercase forms, so this is not a real divergence, but a hand-typed
//    `DPS-EHP:0.5` would 400 here and pass core. Flagged in the handoff notes.

// --- request ---------------------------------------------------------------------------------

/** Request mode. `rollback` == `repair` + a required `anchorNodeId`; core has no separate
 * rollback mode (the result's `mode` is only `extend | repair`). */
export const OptimiseMode = z.enum(["extend", "repair", "rollback"]);
export type OptimiseMode = z.infer<typeof OptimiseMode>;

export const OptimiseRequest = z
  .object({
    buildId: z.string(),
    mode: OptimiseMode,
    objective: ObjectiveSpec.default("TotalDPS"),
    // budgets
    extraPoints: z.number().int().min(0).optional(), // extend: pointsUsed + n
    pointBudget: z.number().int().min(0).optional(), // absolute; xor with extraPoints
    respecBudget: z.number().int().min(0).optional(), // repair
    anchorNodeId: z.number().int().optional(), // rollback (required when mode === "rollback")
    // scoring floors
    constraints: z.record(z.string(), z.number()).default({}),
    preserveMetrics: z.array(z.string()).default([]),
    minResist: z.number().optional(), // sugar -> Fire/Cold/Lightning constraints, expanded in 04
    // search
    proximity: z.number().int().min(1).optional(),
    nodeTypes: z.array(z.string()).optional(),
    includeAllNodeTypes: z.boolean().default(false),
    keywords: z.array(z.string()).optional(),
    excludeKeywords: z.array(z.string()).optional(),
    beamWidth: z.number().int().min(1).optional(),
    beamDepth: z.number().int().min(1).optional(),
    freeze: z.array(z.number().int()).default([]),
  })
  .refine((r) => !(r.extraPoints !== undefined && r.pointBudget !== undefined), {
    message: "extraPoints and pointBudget are mutually exclusive",
  })
  .refine((r) => r.mode !== "rollback" || r.anchorNodeId !== undefined, {
    message: "rollback mode requires anchorNodeId",
  });

/** Parsed request (defaults applied) -- what `04` works with after `OptimiseRequest.parse`. */
export type OptimiseRequest = z.infer<typeof OptimiseRequest>;
/** Request body as the UI builds it -- defaulted fields (`objective`, `constraints`,
 * `preserveMetrics`, `includeAllNodeTypes`, `freeze`) are optional here. Use this for the
 * wizard's form state / fetch payload type. */
export type OptimiseRequestInput = z.input<typeof OptimiseRequest>;

// --- result DTO (mirrors src/core/optimiseTree.ts:OptimiseTreeResult) ----------------------

/** An allocated node the repair pass deallocated. Mirrors `RemovedNode`. */
export const RemovedNodeDTO = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  statLines: z.array(z.string()),
  /** 1 for a leaf; more for an interior node whose downstream cascaded off with it. */
  pointsFreed: z.number().int(),
  /** True on the synthetic entry for a `--rollback-to` anchor. */
  anchorCascade: z.boolean().optional(),
  // Core types these `number`, but assigns `Number.NaN` / `Number.POSITIVE_INFINITY` when the
  // removal makes the build unscorable (e.g. the anchor entry on a `nothing-removable` return),
  // and neither survives JSON. Modelled nullable; the API mapper coerces non-finite -> null.
  objectiveAfterRemoval: z.number().nullable(),
  /** baseline objective - objectiveAfterRemoval. Negative = removing it *helped*. null =
   * unscorable after removal. */
  valueLost: z.number().nullable(),
});
export type RemovedNodeDTO = z.infer<typeof RemovedNodeDTO>;

/** A node to allocate, in order. Mirrors `OptimiseStep`. */
export const OptimiseStepDTO = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  statLines: z.array(z.string()),
  pointsSpent: z.number().int(),
  pathLength: z.number().int().optional(),
  objectiveBefore: z.number(),
  objectiveAfter: z.number(),
  delta: z.number(),
  deltaPerPoint: z.number(),
});
export type OptimiseStepDTO = z.infer<typeof OptimiseStepDTO>;

/** Why the walk stopped / what the recommendation is. Mirrors `OptimiseTreeResult["stoppedBecause"]`,
 * including `"cancelled"` (the `shouldContinue` early return). */
export const StoppedBecause = z.enum([
  "budget-reached",
  "no-positive-candidate",
  "no-candidates",
  "nothing-to-do",
  "nothing-removable",
  "repair-not-worthwhile",
  "cancelled",
]);
export type StoppedBecause = z.infer<typeof StoppedBecause>;

export const OptimiseResultDTO = z.object({
  /** Core result mode is `extend | repair` only -- a `rollback` request collapses to `repair`. */
  mode: z.enum(["extend", "repair"]),
  baseline: z.object({
    objective: z.number(),
    pointsUsed: z.number().int(),
    pointsMax: z.number().int(),
  }),
  pointBudget: z.number().int(),
  respecBudget: z.number().int().optional(),
  anchorNodeId: z.number().int().optional(),
  beamWidth: z.number().int().optional(),
  removed: z.array(RemovedNodeDTO),
  steps: z.array(OptimiseStepDTO),
  /** Picks only (path nodes `AllocNode` drags in are not listed individually). */
  addedNodeIds: z.array(z.number().int()),
  /** Connected allocated regular-node id sets before/after the plan, each ascending by id.
   * `after` is read back from the bridge (removeIds + allocSet), so it INCLUDES path nodes and
   * is what `04` writes into `<Spec nodes>` and `06` renders the diff from. `after === before`
   * when `steps` is empty. (Resolved 2026-08-29, `3b7dcf6`.) */
  allocatedNodeIds: z.object({
    before: z.array(z.number().int()),
    after: z.array(z.number().int()),
  }),
  pointsFreed: z.number().int(),
  pointsRespent: z.number().int(),
  final: z.object({
    objective: z.number(),
    /** Net point delta vs the loaded tree: 0 or negative in repair, >= 0 in extend. */
    pointsSpent: z.number().int(),
    /** The measured StatSet of the recommended plan. Finite numbers only -- same API-mapper
     * sanitisation duty as `BuildSummary.baseline`. */
    stats: z.record(z.string(), z.number()),
  }),
  stoppedBecause: StoppedBecause,
  /** Real BuildOutput recomputes this run (absent against an older bridge). */
  buildOutputCount: z.number().int().optional(),
  /** Cumulative bridge-side recompute seconds this run (absent against an older bridge). */
  buildOutputSeconds: z.number().optional(),
  cacheHitRate: z.number(),
  /** Added by `04`: the re-encoded build with the plan applied. Built by string-replacing
   * `<Spec nodes>` from `allocatedNodeIds.after` -- NOT rebuilt from `removed` + `addedNodeIds`
   * (those are picks-only and would emit a disconnected tree). */
  updatedPobCode: z.string(),
});
export type OptimiseResultDTO = z.infer<typeof OptimiseResultDTO>;
