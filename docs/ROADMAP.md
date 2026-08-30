<!-- generated-by: groundrules v1.10.0 -->
# Roadmap

Future-looking only. What exists today and the completed milestones live in
[`PLAN.md`](../PLAN.md) — this file does not repeat them.

Nothing below is in progress. These are the candidates for the next piece of work, in rough
priority order, with the bar each one has to clear.

## Next up

### Progress view extras: sparkline, canvas highlight, e2e check

Per-shard worker rows and the top-N promising-nodes list shipped (`PLAN.md`, 2026-08-30). Three
follow-ons remain: a `bestObjective` sparkline, highlighting the top-N nodes on the shipped `06`
canvas, and a real-bridge end-to-end validation run.

- **Spec:** [`docs/prd/web-ui-progress-view-extras.md`](prd/web-ui-progress-view-extras.md) — PRD
  written (draft), not built. Split from the now-closed
  [`web-ui-live-progress-view.md`](prd/web-ui-live-progress-view.md) per
  [ADR-0013](decisions/0013-close-out-live-progress-view-prd-defer-remaining-scope.md).
- **Blocked on:** the PRD's open questions — sparkline state ownership (component-local vs. a new
  prop) and a concrete acceptance test for the canvas highlight (currently only "visual check").
- **Effort:** small-moderate — `RunProgress.tsx` sparkline, an additive canvas layer, and a
  manual e2e pass.

### Configure step: manual end-to-end check

The whole PRD is now built (`PLAN.md`, 2026-08-30): the metric-picker half (shared known-metrics
module backing a hybrid `<datalist>` picker in `ConstraintsEditor` and `ObjectiveBuilder`) and
the `TreeCanvas` right-click context menu (Freeze / Unfreeze / Anchor for rollback) with the
`RunConfig` wiring + clickable freeze-list name resolution behind it. Only the manual
Configure-step walkthrough (pick metrics, freeze/unfreeze/anchor, confirm the request payload,
screenshot in the PR) remains, tracked `[supervised]` in `PLAN.md`.

- **Spec:** [`docs/prd/web-ui-configure-step-pickers.md`](prd/web-ui-configure-step-pickers.md) —
  all build steps done except the manual check. Bundled per
  [ADR-0014](decisions/0014-bundle-configure-step-ui-ideas-into-one-feature-release.md).
- **Blocked on:** nothing — manual by nature, no automated stop condition.
- **Effort:** small — a single browser walkthrough.

### Bench sweep for a default `beamWidth > 1`

The optimiser ships with `beamWidth = 1` (pure greedy), proven sufficient on the 25-build corpus.
Open question: does a wider beam improve solution quality enough on larger builds to justify the
extra runtime?

- **Do:** run `npm run bench-tree-approaches` across a range of widths, compare lift % vs wall time.
- **Effort:** moderate — it is a measurement task, the beam already supports `W > 1`.
- **Blocked on:** nothing.

### RePoE-fork asset source (phase 4: gem data + icons)

Phases 1-3 shipped 2026-08-30: `fetch-tree.mjs` replaces `gen-min-tree.mjs` (tree data, stat
text, `iconIdx`), `fetch-icons.mjs` fetches + commits the ~578 unique node PNGs (577/578 — one
upstream asset, `Storm Weaver.dds`, 500s on the image host regardless of encoding; the node
renders via the dot fallback until that's fixed upstream), and the canvas now draws real node art
at icon/full LOD (`iconCache.ts`, `draw.ts`) with the stylised dot as the low-LOD tier and
unloaded-image fallback. Remaining: the gem data + icon asset layer (`fetch-gems.mjs`), data +
icons only, no gem UI.

- **Spec:** [`intake/web-ui/10-repoe-asset-source.md`](../intake/web-ui/10-repoe-asset-source.md)
  — phases 1-3 built, phase 4 not started.
- **Decided:** [ADR-0012](decisions/0012-repoe-fork-asset-source.md).
- **Blocked on:** nothing.

## Deferred — pick up only on demand

### Candidate-pruning layers 3 / 4 / 6

The beam-search design sketched three pruning layers to contain candidate explosion. Greedy
re-spend has been fast enough without them. Revisit only if a real run gets too slow.

### `--target-level` — derive the point budget from a character level

Let the user pass a level instead of `--extra-points`, and compute the available passive points.

- **Blocked on:** a verified quest→passive-point mapping, checked against vendored PoE2 data (the
  same discipline as [`docs/gotchas.md`](gotchas.md)).

### From-scratch mode — infinite budget, bare tree

Optimise a completely empty tree. Needs the add-loop to spend zero-delta pathing steps toward a
distant payoff — a generalisation of the current greedy add. Also the blocker for rollback with an
anchor near the class start.

- **Value:** theory-crafting. Not needed for the core respec use case.

### Untrimmed `OptimiseTreeResult` fixture for the canvas contract test

`spike/genCanvasFixture.ts` writes only a trimmed canvas projection. The contract tests
reconstitute a full `OptimiseResultDTO` before parsing, so the fixture test never exercises the
nullable `objectiveAfterRemoval` branch (a dedicated unit test does).

- **Do:** dump an untrimmed `OptimiseTreeResult` blob alongside the projection so the fixture
  test covers the nullable branch end-to-end.
- **Effort:** small — spike script plus fixture regen.
- **Blocked on:** nothing.

## Out of scope

### Skill / support-gem optimisation

Skill and support gems are immutable calculation inputs. The optimiser never edits gem links,
levels, or qualities (ADR-0002). Gems have their own balance mechanics (drop rates, level gates,
family uniqueness, socket colours) and are a separate problem. The design sketch is kept in
[`intake/skill-optimiser-design.md`](../intake/skill-optimiser-design.md) in case scope reopens.

---

**Last updated:** 2026-08-29
