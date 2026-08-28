# Phase 2 — shared contract (`packages/contract`)

One package of **Zod schemas** and the TS types inferred from them, imported by both the API
(`04`) and the web app (`05`). The API validates every request body against these; the UI builds
its forms and result views against the inferred types. One definition, no drift.

Depends on phase 1 (workspaces). Blocks `04` and `05`.

```
packages/contract/
  package.json          # name "@poe2/contract", dep: zod
  src/
    index.ts            # re-exports everything
    build.ts            # BuildInput, BuildSummary
    optimise.ts         # OptimiseRequest, OptimiseResultDTO, RemovedNodeDTO, OptimiseStepDTO
    recommend.ts        # RecommendRequest, RecommendedNodeDTO
    progress.ts         # ProgressEvent (SSE payloads)
    job.ts              # JobRef, JobStatus, JobError
```

## Why Zod and not just `interface`s

- The API needs runtime validation of untrusted request bodies anyway; hand-written type guards
  for the objective spec / constraints map / freeze list would duplicate the schema.
- `z.infer<typeof OptimiseRequest>` gives the UI the exact same type the API accepts.
- The objective **grammar** (`dps-ehp:W` | `blend:A,B,W` | bare metric) is already parsed in
  `src/core/objective.ts:parseObjective`. The contract only validates the *string shape* with a
  regex and lets core do the real parse — do not reimplement the grammar here.

## Schemas

### `build.ts`

```ts
export const BuildInput = z.union([
  z.object({ kind: z.literal("pobCode"), code: z.string().min(1) }),
  z.object({ kind: z.literal("xml"),     xml:  z.string().min(1) }),
]);

export const BuildSummary = z.object({
  buildId: z.string(),                 // server-assigned, opaque
  className: z.string(),
  ascendancy: z.string().nullable(),
  level: z.number().int(),
  pointsUsed: z.number().int(),
  pointsMax: z.number().int(),
  weaponSet1PointsUsed: z.number().int(),
  weaponSet2PointsUsed: z.number().int(),
  baseline: z.record(z.string(), z.number()),   // the StatSet, JSON-safe (finite numbers only)
  notes: z.array(z.string()),          // e.g. "scores 0 DPS headless", "over-allocated by 2"
});
```

### `optimise.ts`

```ts
const METRIC = String.raw`[A-Za-z][A-Za-z0-9]*`;
const W = String.raw`\d+(?:\.\d+)?`;
export const ObjectiveSpec = z.string().regex(
  new RegExp(`^(?:dps-ehp:${W}|blend:${METRIC},${METRIC},${W}|${METRIC})$`),
  "expected 'dps-ehp:W', 'blend:A,B,W', or a bare metric name",
);
// One METRIC char-class for both the bare and blend forms — an earlier draft let bare metrics
// carry digits (TotalEHP-style) but not blend operands. Still only a shape check; the real
// grammar parse stays in src/core/objective.ts:parseObjective.

export const OptimiseRequest = z.object({
  buildId: z.string(),
  mode: z.enum(["extend", "repair", "rollback"]),   // rollback = repair + anchorNodeId
  objective: ObjectiveSpec.default("TotalDPS"),
  // budgets
  extraPoints: z.number().int().min(0).optional(),  // extend: pointsUsed + n
  pointBudget: z.number().int().min(0).optional(),  // absolute; xor with extraPoints
  respecBudget: z.number().int().min(0).optional(), // repair
  anchorNodeId: z.number().int().optional(),        // rollback (required when mode==="rollback")
  // scoring floors
  constraints: z.record(z.string(), z.number()).default({}),
  preserveMetrics: z.array(z.string()).default([]),
  minResist: z.number().optional(),                 // sugar → Fire/Cold/Lightning constraints
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
  .refine(r => !(r.extraPoints !== undefined && r.pointBudget !== undefined),
    "extraPoints and pointBudget are mutually exclusive")
  .refine(r => r.mode !== "rollback" || r.anchorNodeId !== undefined,
    "rollback mode requires anchorNodeId");
```

The API maps this to `OptimiseTreeOptions` 1:1 (`mode: "rollback"` just means "pass
`anchorNodeId`"; core has no separate mode — see `optimiseTree.ts` doc comment). Keep the mapper
in `04`, not here.

`OptimiseResultDTO` mirrors `OptimiseTreeResult` (`optimiseTree.ts:145`) field-for-field, with:

- `final.stats` kept as `z.record(z.string(), z.number())` (the `StatSet`).
- an added `updatedPobCode: z.string()` — the re-encoded build with the plan applied (`04`).
- `addedNodeIds`, `removed[].id`, `steps[].id` preserved so `06` (canvas) can highlight them.

### `recommend.ts`

`RecommendRequest` = a subset of `OptimiseRequest` (`buildId`, `objective`, `top`, `damageType`,
`constraints`, `preserveMetrics`, `keepViolating`, `nodeTypes`). `RecommendedNodeDTO` mirrors
`RecommendedNode` from `src/core/recommendTree.ts`.

### `progress.ts`

```ts
export const ProgressEvent = z.object({
  jobId: z.string(),
  phase: z.string(),                 // OptimiseProgress.phase, stringified
  buildOutputs: z.number().int(),
  estimatedTotal: z.number().int().optional(),
  bestObjective: z.number(),
  depth: z.number().int().optional(),
  k: z.number().int().optional(),
  kTotal: z.number().int().optional(),
  note: z.string().optional(),
  elapsedMs: z.number().int(),       // added by the API from job start
});
```

### `job.ts`

```ts
export const JobStatus = z.enum(["queued", "running", "done", "error", "cancelled"]);
export const JobRef = z.object({ jobId: z.string(), status: JobStatus });
export const JobError = z.object({ jobId: z.string(), message: z.string(), kind: z.enum([
  "unscoreable-objective", "zero-dps-build", "bridge-crash", "bad-request", "internal",
]) });
```

## Versioning

Single-user, both halves ship together from one repo — no wire-compat burden. If a schema
changes, the API and UI change in the same commit. Add a `CONTRACT_VERSION` const and echo it on
`/api/health` so a stale browser tab against a newer server shows a "reload" banner instead of
silently mis-parsing.
