// Build input + the server's summary of a loaded build.
//
// `BuildInput` is the untrusted request body for POST /api/builds; `BuildSummary` is what the
// server hands back once the bridge has parsed it (mirrors a curated subset of core's
// `TreeStatus` plus the class/level facts the wizard shows).

import { z } from "zod";

/**
 * A build to load: either a pasted PoB import code or an uploaded `.xml` body.
 *
 * Modelled as a discriminated union on `kind` (spec `03` wrote `z.union`; the discriminated
 * form infers to the identical type but gives a precise "which branch" error instead of a
 * merged dump of both branch failures -- the reject tests and `04`'s error surface both want
 * that).
 */
export const BuildInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pobCode"), code: z.string().min(1) }),
  z.object({ kind: z.literal("xml"), xml: z.string().min(1) }),
]);
export type BuildInput = z.infer<typeof BuildInput>;

/**
 * The server's summary of a parsed build. `baseline` is the loaded `mainOutput` StatSet.
 *
 * IMPORTANT for `04`: `z.number()` rejects `NaN` / `±Infinity` (zod 4), and those don't
 * survive `JSON.stringify` anyway (they become `null`). PoB's `mainOutput` can contain
 * non-finite values and the bridge passes them through untouched (`sanitizeForJson` only
 * drops non-scalars). The API mapper MUST strip non-finite entries from the StatSet before
 * validating / returning it -- hence "JSON-safe (finite numbers only)".
 */
export const BuildSummary = z.object({
  buildId: z.string(), // server-assigned, opaque
  className: z.string(),
  ascendancy: z.string().nullable(),
  level: z.number().int(),
  pointsUsed: z.number().int(),
  pointsMax: z.number().int(),
  weaponSet1PointsUsed: z.number().int(),
  weaponSet2PointsUsed: z.number().int(),
  /**
   * The `<Spec treeVersion>` of the build's active spec, e.g. "0_5". `null` when the XML
   * carries no such attribute. Read straight off the XML by the API -- `get_tree_status`
   * does NOT return it. `05`/`06` compare this against the shipped `tree-*.min.json` to
   * decide whether the canvas can render the build, falling back to the list diff when it
   * cannot. Added at integration (2026-08-29): both frontend docs specified that fallback,
   * but no field existed to implement it against.
   */
  treeVersion: z.string().nullable(),
  /**
   * The build's currently-allocated regular-node ids, ascending. Same node filter as the
   * bridge's `list_allocated_nodes` (class/ascendancy-start + item-granted nodes excluded), so
   * it mirrors `OptimiseResultDTO.allocatedNodeIds.before`. The Configure-step tree preview
   * (`09-rollback-tree-preview.md`) draws the current tree straight from this -- no extra call.
   */
  allocatedNodeIds: z.array(z.number().int()),
  baseline: z.record(z.string(), z.number()), // the StatSet, finite numbers only
  notes: z.array(z.string()), // e.g. "scores 0 DPS headless", "over-allocated by 2"
});
export type BuildSummary = z.infer<typeof BuildSummary>;

/**
 * Response of `POST /api/builds/:id/cascade` -- the downstream `DeallocNode` cascade that rolling
 * back to `anchorNodeId` would free. Node ids only (no "points freed" count: a true point count
 * has weapon-set subtleties, `PLAN.md` "Blocker (a)", not worth faking for a preview).
 * `freedNodeIds` is ascending and includes the anchor itself. Spec: `09-rollback-tree-preview.md`.
 */
export const CascadeResult = z.object({
  anchorNodeId: z.number().int(),
  freedNodeIds: z.array(z.number().int()),
});
export type CascadeResult = z.infer<typeof CascadeResult>;
