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

### Configure step: node freeze/unfreeze/anchor menu, constraint/objective metric pickers

Three backlog ideas bundled into one release: a right-click context menu on `TreeCanvas` nodes
(Freeze / Unfreeze / Anchor for rollback), a hybrid metric picker for `ConstraintsEditor` rows,
and a hybrid objective-metric picker in `ObjectiveBuilder` — replacing today's blind free-text
entry for all three.

- **Spec:** [`docs/prd/web-ui-configure-step-pickers.md`](prd/web-ui-configure-step-pickers.md) —
  PRD written, open questions resolved (2026-08-30), not built. Bundled per
  [ADR-0014](decisions/0014-bundle-configure-step-ui-ideas-into-one-feature-release.md).
- **Blocked on:** nothing — ready to build. Metric source is a vendored static list merged with
  live baseline stats; pickers stay hybrid (autocomplete + free text); freeze-list names resolve
  via the same node-data source `NodeDiff.tsx` uses.
- **Effort:** small-moderate — two component swaps (`ConstraintsEditor`, `ObjectiveBuilder`), a
  3-action context menu on `TreeCanvas`, and threading a node-name lookup into `RunConfig`.

### Bench sweep for a default `beamWidth > 1`

The optimiser ships with `beamWidth = 1` (pure greedy), proven sufficient on the 25-build corpus.
Open question: does a wider beam improve solution quality enough on larger builds to justify the
extra runtime?

- **Do:** run `npm run bench-tree-approaches` across a range of widths, compare lift % vs wall time.
- **Effort:** moderate — it is a measurement task, the beam already supports `W > 1`.
- **Blocked on:** nothing.

### RePoE-fork asset source

Bring passive-tree geometry, node art, and stat text in from a RePoE fork so the web canvas can
render real node artwork, gem icons in sockets, and per-node stat text.

- **Spec:** [`intake/web-ui/10-repoe-asset-source.md`](../intake/web-ui/10-repoe-asset-source.md) — written, not built.
- **Decided:** [ADR-0012](decisions/0012-repoe-fork-asset-source.md) — adopted 2026-08-29,
  superseding ADR-0010's "stylised only, no GGG art".
- **Blocked on:** nothing; the calc engine stays on PoB either way.

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
